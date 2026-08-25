/**
 * dsh-devpanel host half of the usage panel: one TypertRemoteService that
 * merges TWO usage dimensions into a single "how much did I actually work"
 * view.
 *
 * - AI dimension: folds the `session/event` firehose (the same stream
 *   dsh-usage-stats reads) into per-chat-session activity records — human
 *   messages, assistant calls with token accounting, response duration and
 *   reasoning effort.
 * - Terminal dimension: folds terminal events emitted by TerminalPanelService
 *   (spawn / command / exit / dispose) into per-terminal-session records —
 *   sessions, submitted commands and wall time. Only dsh-devpanel can see
 *   this dimension, because it owns the PTY terminal panel.
 *
 * The service persists a debounced index cache under DSH_HOME, replays
 * historical chat sessions best-effort through `ctx.sessionQuery`, and serves
 * aggregated snapshots, call/terminal detail pages and CSV/JSON exports over
 * the `usagePanel` Remote namespace. The Gateway auto-discovers it through its
 * `typertRemote` binding, so the client calls `usagePanel/*` with no harness
 * changes.
 * @module dsh-devpanel/usage
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// Import session types from the `/types` subpath, NOT the package root: the
// root module carries a `declare module '@deepseek-ai/cordis'` merge that
// types `ctx.sessions` as the host SessionStore. This plugin compiles its
// host AND client halves in ONE tsc program (see tsconfig.json), so dragging
// that merge in would override the client's `ctx.sessions: ISessions` and
// break the client slots — the same reason the harness splits host/client
// programs. The `/types` subpath is pure data and stays out of the way.
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type {
  UsageAiActivity,
  UsageCallRecord,
  UsageCallsPage,
  UsageCallsQuery,
  UsageDayStats,
  UsageIndexCache,
  UsageModelStats,
  UsageQuery,
  UsageSessionSummary,
  UsageSnapshot,
  UsageTerminalRecord,
  UsageTerminalsPage,
  UsageTerminalsQuery,
  UsageTerminalSession,
  UsageTokens,
  UsageToolStats,
  UsageTotals,
  UsageWorkspace,
} from './usage-types.ts'

/** Debounce window for index writes (ms). */
const DEFAULT_CACHE_WRITE_DELAY_MS = 1_000

/** Historical replay concurrency (mirrors dsh-usage-stats' default). */
const REPLAY_CONCURRENCY = 2

/** Soft cap on retained terminal session records (drop the oldest first). */
const MAX_TERMINAL_SESSIONS = 10_000

/** Zero token accounting (the "nothing reported" sentinel). */
const ZERO_TOKENS = (): UsageTokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })

/** Billed (provider-counted) tokens: uncached + cached input plus output. */
function billedTokens(tokens: UsageTokens): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

/** Sanitize a possibly-absent/negative/NaN token count to a non-negative integer. */
function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Per-session in-memory state for pairing step timing and reasoning effort. */
interface CollectState {
  openStep: { turn: number; step: number; time: number } | null
  currentEffort: string | undefined
}

function newCollectState(): CollectState {
  return { openStep: null, currentEffort: undefined }
}

/**
 * Fold one session event into an AI activity record (or `null` for events
 * that only maintain state). Mirrors the reference dsh-usage-stats collector:
 * `step/start` opens the timing window, `request/header` captures the
 * reasoning effort, `user/message` (direct human source) is a human activity,
 * and `assistant/message` is an assistant activity carrying token accounting.
 */
export function activityFromEvent(event: SessionEvent, state: CollectState = newCollectState()): UsageAiActivity | null {
  if (event.type === 'step/start') {
    state.openStep = { turn: event.data.turn, step: event.data.step, time: event.time }
    return null
  }
  if (event.type === 'request/header') {
    const effort = event.data.header?.config?.reasoningEffort
    if (typeof effort === 'string' && effort.length > 0) state.currentEffort = effort
    return null
  }
  if (event.type === 'step/end' || event.type === 'turn/end') {
    state.openStep = null
    return null
  }
  if (event.type === 'user/message' && event.data.source.kind === 'user') {
    return { seq: event.seq, time: event.time, kind: 'human' }
  }
  if (event.type !== 'assistant/message') return null
  const usage = event.data.usage
  let durationMs: number | undefined
  if (state.openStep !== null && state.openStep.turn === event.data.turn && state.openStep.step === event.data.step) {
    durationMs = Math.max(0, event.time - state.openStep.time)
    state.openStep = null
  }
  const activity: UsageAiActivity = {
    seq: event.seq,
    time: event.time,
    kind: 'assistant',
    provider: event.data.message.source.provider,
    model: event.data.message.source.model,
    tokens: {
      input: finiteCount(usage?.inputTokens),
      output: finiteCount(usage?.outputTokens),
      cacheRead: finiteCount(usage?.cacheReadTokens),
      cacheWrite: finiteCount(usage?.cacheWriteTokens),
      reasoning: finiteCount(usage?.reasoningTokens),
    },
  }
  if (durationMs !== undefined) activity.durationMs = durationMs
  if (state.currentEffort !== undefined) activity.effort = state.currentEffort
  return activity
}

/**
 * Summarize a full session log into an AI-side summary. A forked child stores
 * the parent's copied prefix in its own log; the durable fork boundary is
 * `header.seedLength`, so events before it belong to the parent and are
 * skipped (they would otherwise double-count inherited context).
 */
export function summarizeSession(header: SessionHeader, events: readonly SessionEvent[], indexedAt = Date.now()): UsageSessionSummary {
  const firstOwnSeq = header.parentSession !== undefined ? (header.seedLength ?? 0) : 0
  const activities: UsageAiActivity[] = []
  const state = newCollectState()
  for (const event of events) {
    if (event.seq < firstOwnSeq) continue
    const activity = activityFromEvent(event, state)
    if (activity !== null) activities.push(activity)
  }
  const summary: UsageSessionSummary = {
    id: String(header.id),
    createdAt: header.createdAt,
    lastSeq: events.at(-1)?.seq ?? -1,
    indexedAt,
    activities,
  }
  if (header.cwd !== undefined) summary.cwd = header.cwd
  if (header.parentSession !== undefined) summary.parentSession = String(header.parentSession)
  return summary
}

/** Append one live event to a summary; returns false when it is a replay/dup. */
function appendActivity(
  summary: UsageSessionSummary,
  event: SessionEvent,
  indexedAt = Date.now(),
  state?: CollectState,
): boolean {
  if (event.seq <= summary.lastSeq) return false
  summary.lastSeq = event.seq
  summary.indexedAt = indexedAt
  const activity = activityFromEvent(event, state ?? newCollectState())
  if (activity !== null) summary.activities.push(activity)
  return true
}

/** Day formatter for one IANA time zone (falls back to UTC on bad input). */
function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  }
}

/** `YYYY-MM-DD` key for a timestamp in the formatter's time zone. */
function dateKey(value: number, format: Intl.DateTimeFormat): string {
  const parts = format.formatToParts(value)
  const year = parts.find(part => part.type === 'year')?.value ?? '1970'
  const month = parts.find(part => part.type === 'month')?.value ?? '01'
  const day = parts.find(part => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

/** Inclusive ascending `YYYY-MM-DD` keys between two bounds (capped at 10 years). */
function datesBetween(from: string, to: string): string[] {
  const days: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end && days.length < 3660) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

/** One empty day row. */
function newDay(date: string): UsageDayStats {
  return { date, aiTokens: 0, aiCalls: 0, aiMessages: 0, aiSessions: 0, terminalSessions: 0, commands: 0, terminalMs: 0 }
}

/** Lineage/workspace scope filter shared by AI and terminal aggregation. */
function inScope(session: { cwd?: string; parentSession?: string }, query: UsageQuery): boolean {
  if (query.workspace !== undefined && session.cwd !== query.workspace) return false
  if (query.scope === 'main' && session.parentSession !== undefined) return false
  if (query.scope === 'subtasks' && session.parentSession === undefined) return false
  return true
}

/**
 * Aggregate both dimensions into one snapshot. AI figures come from the
 * per-session activity records; terminal figures come from the terminal
 * session records (sessions bucketed by start day, commands by their own
 * time, wall time by end day). Both respect the same workspace/scope filter.
 */
export function aggregateStats(
  aiSessions: Iterable<UsageSessionSummary>,
  terminalSessions: Iterable<UsageTerminalSession>,
  query: UsageQuery,
): UsageSnapshot {
  const allSessions = [...aiSessions]
  const allTerminals = [...terminalSessions]
  const format = formatter(query.timeZone)
  const days = datesBetween(query.from, query.to).map(newDay)
  const byDate = new Map(days.map(day => [day.date, day]))
  const aiActiveSessionsByDay = new Map<string, Set<string>>()
  const models = new Map<string, UsageModelStats>()
  const aiSessionIds = new Set<string>()
  const aiActiveDates = new Set<string>()
  const terminalActiveDates = new Set<string>()
  const totals: UsageTotals = {
    aiTokens: 0,
    aiCalls: 0,
    aiMessages: 0,
    aiSessions: 0,
    aiActiveDays: 0,
    aiCurrentStreak: 0,
    terminalSessions: 0,
    commands: 0,
    terminalMs: 0,
    terminalActiveDays: 0,
  }

  // AI dimension.
  for (const session of allSessions) {
    if (!inScope(session, query)) continue
    let sessionActive = false
    for (const activity of session.activities) {
      const dayKey = dateKey(activity.time, format)
      const day = byDate.get(dayKey)
      if (day === undefined) continue
      day.aiMessages += 1
      totals.aiMessages += 1
      sessionActive = true
      aiActiveDates.add(dayKey)
      let daySessions = aiActiveSessionsByDay.get(dayKey)
      if (daySessions === undefined) aiActiveSessionsByDay.set(dayKey, daySessions = new Set())
      daySessions.add(session.id)
      if (activity.kind !== 'assistant' || activity.tokens === undefined) continue
      day.aiCalls += 1
      totals.aiCalls += 1
      const provider = activity.provider ?? 'unknown'
      const model = activity.model ?? 'unknown'
      const key = `${provider}/${model}`
      let modelStats = models.get(key)
      if (modelStats === undefined) {
        modelStats = { key, provider, model, tokens: 0, calls: 0, percent: 0 }
        models.set(key, modelStats)
      }
      const amount = billedTokens(activity.tokens)
      modelStats.tokens += amount
      modelStats.calls += 1
      day.aiTokens += amount
      totals.aiTokens += amount
    }
    if (sessionActive) aiSessionIds.add(session.id)
  }
  for (const day of days) day.aiSessions = aiActiveSessionsByDay.get(day.date)?.size ?? 0
  totals.aiSessions = aiSessionIds.size
  totals.aiActiveDays = aiActiveDates.size
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index]
    if (day === undefined || !aiActiveDates.has(day.date)) break
    totals.aiCurrentStreak += 1
  }

  // Terminal dimension.
  for (const terminal of allTerminals) {
    if (query.workspace !== undefined && terminal.cwd !== query.workspace) continue
    const startDay = dateKey(terminal.startedAt, format)
    const start = byDate.get(startDay)
    if (start !== undefined) {
      start.terminalSessions += 1
      totals.terminalSessions += 1
      terminalActiveDates.add(startDay)
    }
    // Command counts are aggregated per session without per-command timestamps
    // (the original text is not stored), so they are attributed to the day the
    // session started.
    const commandTotal = Object.values(terminal.commandCounts).reduce((sum, count) => sum + count, 0)
    if (commandTotal > 0 && start !== undefined) {
      start.commands += commandTotal
      totals.commands += commandTotal
    }
    if (terminal.endedAt !== undefined && terminal.durationMs !== undefined) {
      const day = byDate.get(dateKey(terminal.endedAt, format))
      if (day === undefined) continue
      day.terminalMs += terminal.durationMs
      totals.terminalMs += terminal.durationMs
    }
  }
  totals.terminalActiveDays = terminalActiveDates.size

  const sortedModels = [...models.values()].sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key))
  for (const model of sortedModels) model.percent = totals.aiTokens === 0 ? 0 : (model.tokens / totals.aiTokens) * 100

  // Tool (command-name) share across the range, mirroring the model share.
  const toolCounts = new Map<string, number>()
  for (const terminal of allTerminals) {
    if (query.workspace !== undefined && terminal.cwd !== query.workspace) continue
    const startDay = dateKey(terminal.startedAt, format)
    if (!byDate.has(startDay)) continue
    for (const [name, count] of Object.entries(terminal.commandCounts)) {
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + count)
    }
  }
  const totalToolCount = [...toolCounts.values()].reduce((sum, count) => sum + count, 0)
  const tools: UsageToolStats[] = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count, percent: totalToolCount === 0 ? 0 : (count / totalToolCount) * 100 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10)

  const workspaceCounts = new Map<string, Set<string>>()
  for (const session of allSessions) {
    if (session.cwd === undefined || !inScope(session, query)) continue
    let ids = workspaceCounts.get(session.cwd)
    if (ids === undefined) workspaceCounts.set(session.cwd, ids = new Set())
    ids.add(session.id)
  }
  const workspaces: UsageWorkspace[] = [...workspaceCounts]
    .map(([path, ids]) => ({ path, sessions: ids.size }))
    .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))

  const lastAi = allSessions.length === 0 ? 0 : Math.max(...allSessions.map(session => session.indexedAt))
  const lastTerminal = allTerminals.length === 0 ? 0 : Math.max(...allTerminals.map(terminal => terminal.endedAt ?? terminal.startedAt))
  return {
    generatedAt: Date.now(),
    range: { from: query.from, to: query.to, timeZone: query.timeZone },
    totals,
    days,
    models: sortedModels,
    tools,
    workspaces,
    index: {
      aiSessions: allSessions.length,
      terminalSessions: allTerminals.length,
      lastUpdatedAt: lastAi === 0 && lastTerminal === 0 ? null : Math.max(lastAi, lastTerminal),
    },
  }
}

/** Collect assistant calls matching the query's model/provider/token filters, newest first. */
export function collectCalls(sessions: Iterable<UsageSessionSummary>, query: UsageCallsQuery): UsageCallRecord[] {
  const format = formatter(query.timeZone)
  const rows: UsageCallRecord[] = []
  for (const session of sessions) {
    if (!inScope(session, query)) continue
    for (const activity of session.activities) {
      if (activity.kind !== 'assistant') continue
      if (query.model !== undefined && activity.model !== query.model) continue
      if (query.provider !== undefined && activity.provider !== query.provider) continue
      const tokens = activity.tokens ?? ZERO_TOKENS()
      if (query.minInputTokens !== undefined && tokens.input < query.minInputTokens) continue
      if (query.minOutputTokens !== undefined && tokens.output < query.minOutputTokens) continue
      const dayKey = dateKey(activity.time, format)
      if (dayKey < query.from || dayKey > query.to) continue
      rows.push({
        key: `${session.id}:${activity.seq}`,
        seq: activity.seq,
        time: activity.time,
        sessionId: session.id,
        provider: activity.provider ?? 'unknown',
        model: activity.model ?? 'unknown',
        effort: activity.effort ?? null,
        durationMs: activity.durationMs ?? null,
        tokens,
      })
    }
  }
  rows.sort((a, b) => b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return rows
}

/** Collect terminal sessions started within the query range, newest first. */
export function collectTerminals(terminals: Iterable<UsageTerminalSession>, query: UsageTerminalsQuery): UsageTerminalRecord[] {
  const format = formatter(query.timeZone)
  const rows: UsageTerminalRecord[] = []
  for (const terminal of terminals) {
    if (query.workspace !== undefined && terminal.cwd !== query.workspace) continue
    const dayKey = dateKey(terminal.startedAt, format)
    if (dayKey < query.from || dayKey > query.to) continue
    rows.push({
      id: terminal.id,
      startedAt: terminal.startedAt,
      endedAt: terminal.endedAt ?? null,
      durationMs: terminal.durationMs ?? null,
      shell: terminal.shell,
      cwd: terminal.cwd ?? null,
      owner: terminal.owner ?? null,
      exitCode: terminal.exitCode ?? null,
      signal: terminal.signal ?? null,
      commandCount: Object.values(terminal.commandCounts).reduce((sum, count) => sum + count, 0),
      commands: Object.entries(terminal.commandCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 8),
    })
  }
  rows.sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows
}

/** Render the merged day rows as CSV (one row per day). */
export function exportCsv(snapshot: UsageSnapshot): string {
  const quote = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`
  const header = ['date', 'ai_tokens', 'ai_calls', 'ai_messages', 'ai_sessions', 'terminal_sessions', 'commands', 'terminal_ms']
  const rows: string[][] = snapshot.days.map(day => [
    day.date,
    String(day.aiTokens),
    String(day.aiCalls),
    String(day.aiMessages),
    String(day.aiSessions),
    String(day.terminalSessions),
    String(day.commands),
    String(day.terminalMs),
  ])
  return [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n')
}

/** Terminal events emitted by TerminalPanelService and folded by UsageService. */
export interface TerminalSpawnEvent {
  id: string
  time: number
  shell: string
  cwd?: string
  owner?: string
}

export interface TerminalCommandEvent {
  id: string
  time: number
  /** The command NAME (first token) — the full text never leaves the host. */
  name: string
}

export interface TerminalExitEvent {
  id: string
  time: number
  exitCode: number | null
  signal: string | null
}

export interface TerminalDisposeEvent {
  id: string
  time: number
}

/** Event names TerminalPanelService emits on the shared ctx. */
export const TERMINAL_EVENTS = {
  spawn: 'devpanel/terminal/spawn',
  command: 'devpanel/terminal/command',
  exit: 'devpanel/terminal/exit',
  dispose: 'devpanel/terminal/dispose',
} as const

/** Minimal structural face of a chat session for the `session/event` listener.
 *  The `Session` class lives in the dsh-session ROOT module, whose cordis
 *  Context merge would override the client's `ctx.sessions` type in this
 *  single-program build; the listener only needs `id` and `header`, so a
 *  structural type keeps the root module (and its merge) out of the program. */
interface SessionLike {
  id: unknown
  header: SessionHeader
}

/** Minimal structural face of the session-query service. Importing the real
 *  `SessionQueryEngine` type would drag the dsh-session ROOT module (via
 *  dsh-session-query) — and its `ctx.sessions: SessionStore` merge — into this
 *  single-program build, overriding the client's `ctx.sessions: ISessions`. */
interface SessionQueryEngineLike {
  listSessions(signal?: AbortSignal): Promise<Array<{ header: SessionHeader }>>
  readSession(sessionId: unknown): Promise<{ session: SessionHeader; events: SessionEvent[] }>
}

/** Publish the plugin's event vocabulary on the cordis Events map so
 *  `ctx.on`/`ctx.emit` type-check for these names on both sides of the plugin.
 *  `session/event` is re-declared here (with a structural session) because the
 *  harness's own declaration lives in the dsh-session root module we avoid. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Live session-log event (dsh-devpanel usage panel). */
    'session/event': (session: SessionLike, event: SessionEvent) => void
    /** Terminal session spawned (dsh-devpanel usage panel). */
    'devpanel/terminal/spawn': (event: TerminalSpawnEvent) => void
    /** Terminal command submitted (dsh-devpanel usage panel). */
    'devpanel/terminal/command': (event: TerminalCommandEvent) => void
    /** Terminal session exited (dsh-devpanel usage panel). */
    'devpanel/terminal/exit': (event: TerminalExitEvent) => void
    /** Terminal session disposed (dsh-devpanel usage panel). */
    'devpanel/terminal/dispose': (event: TerminalDisposeEvent) => void
  }
}

/** Durable index cache guard. */
function isCache(value: unknown): value is UsageIndexCache {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<UsageIndexCache>
  return record.schema === 1 && Array.isArray(record.aiSessions) && Array.isArray(record.terminalSessions)
}

/**
 * The usage panel service. Hooks the live `session/event` firehose and the
 * terminal event stream, persists a debounced index cache, replays historical
 * sessions best-effort, and serves the `usagePanel/*` Remote endpoints.
 */
export class UsageService extends TypertRemoteService {
  private readonly aiSessions = new Map<string, UsageSessionSummary>()
  private readonly collectors = new Map<string, CollectState>()
  private readonly terminalSessions = new Map<string, UsageTerminalSession>()
  private callsCache: { key: string; rows: UsageCallRecord[] } | undefined
  /** True once historical replay finished (details are complete). */
  private ready = false
  private readonly cachePath: string
  private readonly cacheWriteDelayMs: number
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private loading: Promise<void> | undefined

  constructor(ctx: Context, options: { cachePath?: string; cacheWriteDelayMs?: number } = {}) {
    super(ctx, 'usagePanel')
    this.cachePath = options.cachePath ?? dshHomePath('devpanel', 'usage-v1.json')
    this.cacheWriteDelayMs = options.cacheWriteDelayMs ?? DEFAULT_CACHE_WRITE_DELAY_MS

    // Collectors ride the plugin fiber: unload unsubscribes them.
    ctx.effect(() => {
      const off = [
        ctx.on('session/event', (session: SessionLike, event: SessionEvent) => { this.acceptLive(session, event) }),
        ctx.on(TERMINAL_EVENTS.spawn, (event: TerminalSpawnEvent) => { this.acceptTerminalSpawn(event) }),
        ctx.on(TERMINAL_EVENTS.command, (event: TerminalCommandEvent) => { this.acceptTerminalCommand(event) }),
        ctx.on(TERMINAL_EVENTS.exit, (event: TerminalExitEvent) => { this.acceptTerminalExit(event) }),
        ctx.on(TERMINAL_EVENTS.dispose, (event: TerminalDisposeEvent) => { this.acceptTerminalDispose(event) }),
      ]
      return () => { for (const dispose of off) dispose() }
    }, 'usagePanel: collectors')

    ctx.effect(() => () => { void this.dispose() }, 'usagePanel: index lifecycle')

    this.loading = this.initialize().catch((error: unknown) => {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    })
  }

  /**
   * Load the cache, then replay historical chat sessions best-effort through
   * `ctx.sessionQuery`. The query service is read from the store (not a hard
   * inject) so the plugin still loads — and the terminal panel still works —
   * in a profile that does not provide it; live and terminal collection are
   * unaffected.
   */
  private async initialize(): Promise<void> {
    const cacheNeedsRewrite = await this.loadCache()
    const sessionQuery = this.trySessionQuery()
    if (sessionQuery !== undefined) {
      try {
        const records = await sessionQuery.listSessions()
        const missing = records.filter(record => !this.aiSessions.has(String(record.header.id)))
        let cursor = 0
        const worker = async (): Promise<void> => {
          while (!this.disposed) {
            const record = missing[cursor]
            cursor += 1
            if (record === undefined) return
            try {
              const snapshot = await sessionQuery.readSession(record.header.id)
              const incoming = summarizeSession(snapshot.session, snapshot.events)
              const current = this.aiSessions.get(incoming.id)
              if (current === undefined || current.lastSeq < incoming.lastSeq) {
                this.aiSessions.set(incoming.id, incoming)
                this.callsCache = undefined
              }
            } catch (error) {
              this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
            }
            await new Promise<void>(resolve => setImmediate(resolve))
          }
        }
        await Promise.all(Array.from({ length: Math.min(REPLAY_CONCURRENCY, Math.max(1, missing.length)) }, worker))
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (cacheNeedsRewrite) await this.persist()
    else if (this.aiSessions.size > 0 || this.terminalSessions.size > 0) this.scheduleWrite()
    this.ready = true
  }

  /** Read `sessionQuery` from the service store without an inject requirement. */
  private trySessionQuery(): SessionQueryEngineLike | undefined {
    try {
      const value = this.ctx.reflect.get('sessionQuery') as SessionQueryEngineLike | undefined
      return value ?? undefined
    } catch {
      return undefined
    }
  }

  /** Fold one live session event into the matching AI summary. */
  private acceptLive(session: SessionLike, event: SessionEvent): void {
    const id = String(session.id)
    let summary = this.aiSessions.get(id)
    if (summary === undefined) {
      summary = summarizeSession(session.header, [])
      this.aiSessions.set(id, summary)
    }
    let state = this.collectors.get(id)
    if (state === undefined) {
      state = newCollectState()
      this.collectors.set(id, state)
    }
    if (appendActivity(summary, event, Date.now(), state)) {
      this.callsCache = undefined
      this.scheduleWrite()
    }
  }

  /** Record a terminal session spawn. */
  private acceptTerminalSpawn(event: TerminalSpawnEvent): void {
    if (this.disposed || this.terminalSessions.has(event.id)) return
    this.terminalSessions.set(event.id, {
      id: event.id,
      startedAt: event.time,
      shell: event.shell,
      commandCounts: {},
      ...(event.cwd === undefined ? {} : { cwd: event.cwd }),
      ...(event.owner === undefined ? {} : { owner: event.owner }),
    })
    // Bound memory: drop the oldest records beyond the cap.
    if (this.terminalSessions.size > MAX_TERMINAL_SESSIONS) {
      const oldest = [...this.terminalSessions.values()]
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(0, this.terminalSessions.size - MAX_TERMINAL_SESSIONS)
      for (const record of oldest) this.terminalSessions.delete(record.id)
    }
    this.scheduleWrite()
  }

  /** Aggregate one submitted command name into its terminal session. */
  private acceptTerminalCommand(event: TerminalCommandEvent): void {
    const terminal = this.terminalSessions.get(event.id)
    if (terminal === undefined) return
    terminal.commandCounts[event.name] = (terminal.commandCounts[event.name] ?? 0) + 1
    this.scheduleWrite()
  }

  /** Mark a terminal session exited with its outcome. */
  private acceptTerminalExit(event: TerminalExitEvent): void {
    const terminal = this.terminalSessions.get(event.id)
    if (terminal === undefined) return
    // A tab close (dispose) may have set endedAt first; the exit outcome must
    // still be recorded so the exit code / signal is not lost.
    if (terminal.endedAt === undefined) {
      terminal.endedAt = event.time
      terminal.durationMs = Math.max(0, event.time - terminal.startedAt)
    }
    terminal.exitCode = event.exitCode
    terminal.signal = event.signal
    this.scheduleWrite()
  }

  /** Close a terminal session that was disposed while still running. */
  private acceptTerminalDispose(event: TerminalDisposeEvent): void {
    const terminal = this.terminalSessions.get(event.id)
    if (terminal === undefined) return
    if (terminal.endedAt === undefined) {
      terminal.endedAt = event.time
      terminal.durationMs = Math.max(0, event.time - terminal.startedAt)
    }
    this.scheduleWrite()
  }

  /** Load the persisted cache; true when it must be rewritten after loading. */
  private async loadCache(): Promise<boolean> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.cachePath, 'utf8'))
      if (!isCache(parsed)) return true
      for (const session of parsed.aiSessions) {
        if (typeof session.id === 'string' && Array.isArray(session.activities)) this.aiSessions.set(session.id, session)
      }
      for (const terminal of parsed.terminalSessions) {
        if (typeof terminal.id === 'string' && terminal.commandCounts !== undefined && typeof terminal.commandCounts === 'object') {
          this.terminalSessions.set(terminal.id, terminal)
        }
      }
      return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        return true
      }
      return false
    }
  }

  /** Debounce a cache write (coalesces bursts of events). */
  private scheduleWrite(): void {
    if (this.disposed || this.writeTimer !== undefined) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      void this.persist().catch((error: unknown) => this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error))))
    }, this.cacheWriteDelayMs)
    this.writeTimer.unref?.()
  }

  /** Atomically write the index cache (temp file + rename, 0600). The temp
   *  name is unique per call so concurrent persists (initialize vs a pending
   *  debounced write vs dispose) never race on the same path — the last rename
   *  wins with a complete file. */
  private async persist(): Promise<void> {
    const data: UsageIndexCache = {
      schema: 1,
      aiSessions: [...this.aiSessions.values()],
      terminalSessions: [...this.terminalSessions.values()],
    }
    const temporary = `${this.cachePath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(this.cachePath), { recursive: true })
    await writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.cachePath)
  }

  /** Flush pending writes on plugin unload. */
  private async dispose(): Promise<void> {
    this.disposed = true
    if (this.writeTimer !== undefined) clearTimeout(this.writeTimer)
    await this.loading
    await this.persist()
  }

  /** Parse and validate a snapshot query from the wire. */
  private parseQuery(query: UsageQuery): UsageQuery {
    const { from, to } = query
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new Error('usagePanel: invalid date range')
    }
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (!Number.isFinite(span) || span > 3660) throw new Error('usagePanel: date range exceeds 10 years')
    if (query.scope !== 'all' && query.scope !== 'main' && query.scope !== 'subtasks') {
      throw new Error('usagePanel: invalid task scope')
    }
    return query
  }

  /** Aggregated snapshot for a date range. */
  @Remote
  async snapshot(query: UsageQuery): Promise<UsageSnapshot> {
    await this.loading
    return aggregateStats(this.aiSessions.values(), this.terminalSessions.values(), this.parseQuery(query))
  }

  /** Paginated assistant-call detail rows. */
  @Remote
  async calls(query: UsageCallsQuery): Promise<UsageCallsPage> {
    await this.loading
    const parsed = this.parseQuery(query)
    const page = Number.isSafeInteger(query.page) && query.page >= 1 ? query.page : 1
    const pageSize = Number.isSafeInteger(query.pageSize) && query.pageSize >= 1 ? Math.min(query.pageSize, 200) : 50
    const key = JSON.stringify({ ...parsed, page: undefined, pageSize: undefined })
    if (this.callsCache?.key !== key) {
      this.callsCache = { key, rows: collectCalls(this.aiSessions.values(), query) }
    }
    const offset = (page - 1) * pageSize
    const total = this.callsCache.rows.length
    return {
      indexReady: this.ready,
      items: this.callsCache.rows.slice(offset, offset + pageSize),
      page,
      pageSize,
      total,
      hasMore: total > page * pageSize,
    }
  }

  /** Paginated terminal-session detail rows. */
  @Remote
  async terminals(query: UsageTerminalsQuery): Promise<UsageTerminalsPage> {
    await this.loading
    const { from, to } = query
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw new Error('usagePanel: invalid date range')
    }
    const page = Number.isSafeInteger(query.page) && query.page >= 1 ? query.page : 1
    const pageSize = Number.isSafeInteger(query.pageSize) && query.pageSize >= 1 ? Math.min(query.pageSize, 200) : 50
    const rows = collectTerminals(this.terminalSessions.values(), query)
    const offset = (page - 1) * pageSize
    return {
      items: rows.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: rows.length,
      hasMore: rows.length > page * pageSize,
    }
  }

  /** CSV export of the merged day rows. */
  @Remote
  async exportCsv(query: UsageQuery): Promise<{ filename: string; body: string }> {
    await this.loading
    const snapshot = aggregateStats(this.aiSessions.values(), this.terminalSessions.values(), this.parseQuery(query))
    return { filename: 'dsh-devpanel-usage.csv', body: `\uFEFF${exportCsv(snapshot)}` }
  }

  /** JSON export of the full snapshot. */
  @Remote
  async exportJson(query: UsageQuery): Promise<{ filename: string; body: string }> {
    await this.loading
    const snapshot = aggregateStats(this.aiSessions.values(), this.terminalSessions.values(), this.parseQuery(query))
    return { filename: 'dsh-devpanel-usage.json', body: JSON.stringify(snapshot, null, 2) }
  }
}

export default UsageService
