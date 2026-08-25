/**
 * Usage panel tests: the AI + terminal dual-dimension collector and
 * aggregator. Covers the pure folds (activityFromEvent / summarizeSession /
 * aggregateStats / collectCalls / collectTerminals / exportCsv) and the
 * UsageService integration (terminal events folded through the shared ctx
 * into a snapshot, and the debounced index cache persisted to disk).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { TerminalPanelService } from '../src/index.ts'
import {
  UsageService,
  TERMINAL_EVENTS,
  activityFromEvent,
  aggregateStats,
  collectCalls,
  collectTerminals,
  exportCsv,
  summarizeSession,
} from '../src/usage.ts'
import type {
  UsageAiActivity,
  UsageSessionSummary,
  UsageTerminalSession,
} from '../src/usage-types.ts'

/** Collect every live context so disposal assertions run per test. */
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
})

// ── Minimal session-event builders (shapes mirror the harness SessionEventMap) ──

function stepStart(seq: number, time: number, turn = 0, step = 0): SessionEvent {
  return { type: 'step/start', seq, time, data: { turn, step } } as SessionEvent
}

function requestHeader(seq: number, time: number, effort: string): SessionEvent {
  return { type: 'request/header', seq, time, data: { header: { config: { reasoningEffort: effort } } } } as SessionEvent
}

function userMessage(seq: number, time: number): SessionEvent {
  return { type: 'user/message', seq, time, data: { source: { kind: 'user' } } } as SessionEvent
}

function assistantMessage(
  seq: number,
  time: number,
  model: string,
  usage?: Partial<Record<'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens', number>>,
  turn = 0,
  step = 0,
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      message: { source: { provider: 'deepseek', model } },
      ...(usage === undefined ? {} : { usage }),
    },
  } as SessionEvent
}

function stepEnd(seq: number, time: number, turn = 0, step = 0): SessionEvent {
  return { type: 'step/end', seq, time, data: { turn, step } } as SessionEvent
}

function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 1, id: id as never, createdAt, ...extra } as SessionHeader
}

function summary(id: string, createdAt: number, activities: UsageAiActivity[], extra: Partial<UsageSessionSummary> = {}): UsageSessionSummary {
  return {
    id,
    createdAt,
    lastSeq: activities.at(-1)?.seq ?? -1,
    indexedAt: createdAt,
    activities,
    ...extra,
  }
}

function terminal(id: string, startedAt: number, extra: Partial<UsageTerminalSession> = {}): UsageTerminalSession {
  return { id, startedAt, shell: 'zsh', commandCounts: {}, ...extra }
}

const QUERY = { from: '2026-08-01', to: '2026-08-31', timeZone: 'UTC', scope: 'all' as const }

describe('activityFromEvent', () => {
  it('turns a user message into a human activity', () => {
    const activity = activityFromEvent(userMessage(1, 1000))
    expect(activity).toEqual({ seq: 1, time: 1000, kind: 'human' })
  })

  it('turns an assistant message into a call with token accounting', () => {
    const activity = activityFromEvent(assistantMessage(2, 2000, 'deepseek-chat', {
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, reasoningTokens: 20,
    }))
    expect(activity).toMatchObject({
      seq: 2,
      time: 2000,
      kind: 'assistant',
      provider: 'deepseek',
      model: 'deepseek-chat',
      tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, reasoning: 20 },
    })
  })

  it('pairs step/start with the matching assistant/message for duration', () => {
    const state = { openStep: null as { turn: number; step: number; time: number } | null, currentEffort: undefined as string | undefined }
    expect(activityFromEvent(stepStart(1, 1000), state)).toBeNull()
    const activity = activityFromEvent(assistantMessage(2, 3500, 'deepseek-chat', { inputTokens: 1, outputTokens: 1 }), state)
    expect(activity?.durationMs).toBe(2500)
  })

  it('carries the reasoning effort captured from the nearest request/header', () => {
    const state = { openStep: null as { turn: number; step: number; time: number } | null, currentEffort: undefined as string | undefined }
    activityFromEvent(requestHeader(1, 1000, 'high'), state)
    const activity = activityFromEvent(assistantMessage(2, 2000, 'deepseek-chat', { inputTokens: 1, outputTokens: 1 }), state)
    expect(activity?.effort).toBe('high')
  })

  it('sanitizes absent or negative token counts to zero', () => {
    const activity = activityFromEvent(assistantMessage(1, 1000, 'm', { inputTokens: -5, outputTokens: NaN }))
    expect(activity?.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  })

  it('ignores step boundaries and non-message events', () => {
    expect(activityFromEvent(stepStart(1, 1000))).toBeNull()
    expect(activityFromEvent(stepEnd(2, 2000))).toBeNull()
  })
})

describe('summarizeSession', () => {
  it('skips inherited seed events for a forked child (no double counting)', () => {
    const events = [
      userMessage(0, 1000), // parent seed
      userMessage(1, 2000), // parent seed
      stepStart(2, 3000),
      assistantMessage(3, 4000, 'deepseek-chat', { inputTokens: 10, outputTokens: 5 }),
    ]
    const child = header('child', 1000, { parentSession: 'parent' as never, seedLength: 2 })
    const folded = summarizeSession(child, events)
    expect(folded.activities.map(a => a.seq)).toEqual([3])
    expect(folded.activities[0]?.kind).toBe('assistant')
  })

  it('folds a whole log in order for a top-level session', () => {
    const events = [userMessage(0, 1000), stepStart(1, 1000), assistantMessage(2, 3000, 'm', { inputTokens: 5, outputTokens: 5 })]
    const folded = summarizeSession(header('s', 1000), events)
    expect(folded.activities.map(a => a.kind)).toEqual(['human', 'assistant'])
    expect(folded.lastSeq).toBe(2)
  })
})

describe('aggregateStats', () => {
  it('merges AI and terminal dimensions into day rows and totals', () => {
    const ai = [
      summary('s1', 1_000, [
        { seq: 0, time: Date.UTC(2026, 7, 3, 10), kind: 'human' },
        { seq: 1, time: Date.UTC(2026, 7, 3, 10), kind: 'assistant', provider: 'deepseek', model: 'chat', tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      ]),
    ]
    const terms = [
      terminal('t1', Date.UTC(2026, 7, 3, 9), {
        endedAt: Date.UTC(2026, 7, 3, 9, 30),
        durationMs: 1_800_000,
        commandCounts: { git: 1, ls: 1 },
      }),
    ]
    const snapshot = aggregateStats(ai, terms, QUERY)
    const day = snapshot.days.find(d => d.date === '2026-08-03')
    expect(day).toMatchObject({ aiTokens: 150, aiCalls: 1, aiMessages: 2, terminalSessions: 1, commands: 2, terminalMs: 1_800_000 })
    expect(snapshot.totals).toMatchObject({ aiTokens: 150, aiCalls: 1, aiMessages: 2, terminalSessions: 1, commands: 2, terminalMs: 1_800_000 })
    expect(snapshot.models[0]).toMatchObject({ model: 'chat', tokens: 150, calls: 1, percent: 100 })
  })

  it('respects the main/subtasks scope filter', () => {
    const main = summary('main', 1_000, [{ seq: 0, time: Date.UTC(2026, 7, 3, 10), kind: 'human' }])
    const subtask = summary('sub', 1_000, [{ seq: 0, time: Date.UTC(2026, 7, 3, 10), kind: 'human' }], { parentSession: 'main' })
    const mainOnly = aggregateStats([main, subtask], [], { ...QUERY, scope: 'main' })
    expect(mainOnly.totals.aiMessages).toBe(1)
    const subOnly = aggregateStats([main, subtask], [], { ...QUERY, scope: 'subtasks' })
    expect(subOnly.totals.aiMessages).toBe(1)
  })

  it('respects the workspace filter', () => {
    const a = summary('a', 1_000, [{ seq: 0, time: Date.UTC(2026, 7, 3, 10), kind: 'human' }], { cwd: '/proj/a' })
    const b = summary('b', 1_000, [{ seq: 0, time: Date.UTC(2026, 7, 3, 10), kind: 'human' }], { cwd: '/proj/b' })
    const snapshot = aggregateStats([a, b], [], { ...QUERY, workspace: '/proj/a' })
    expect(snapshot.totals.aiMessages).toBe(1)
    expect(snapshot.workspaces).toEqual([{ path: '/proj/a', sessions: 1 }])
  })
})

describe('collectCalls / collectTerminals / exportCsv', () => {
  const sessions = [
    summary('s1', 1_000, [
      { seq: 1, time: Date.UTC(2026, 7, 5, 10), kind: 'assistant', provider: 'deepseek', model: 'chat', tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, durationMs: 1000, effort: 'high' },
      { seq: 2, time: Date.UTC(2026, 7, 6, 10), kind: 'assistant', provider: 'deepseek', model: 'reasoner', tokens: { input: 200, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
    ]),
  ]

  it('filters calls by model and returns them newest first', () => {
    const rows = collectCalls(sessions, { ...QUERY, model: 'chat', page: 1, pageSize: 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.model).toBe('chat')
    expect(rows[0]?.effort).toBe('high')
    expect(rows[0]?.durationMs).toBe(1000)
  })

  it('filters calls by date range', () => {
    const rows = collectCalls(sessions, { ...QUERY, from: '2026-08-06', to: '2026-08-06', page: 1, pageSize: 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.seq).toBe(2)
  })

  it('collects terminal sessions within the range, newest first', () => {
    const terms = [
      terminal('t1', Date.UTC(2026, 7, 3, 9), { commandCounts: { ls: 2, git: 1 } }),
      terminal('t2', Date.UTC(2026, 7, 4, 9)),
    ]
    const rows = collectTerminals(terms, { from: '2026-08-03', to: '2026-08-03', timeZone: 'UTC', page: 1, pageSize: 10 })
    expect(rows.map(r => r.id)).toEqual(['t1'])
    expect(rows[0]?.commandCount).toBe(3)
    expect(rows[0]?.commands).toEqual([{ name: 'ls', count: 2 }, { name: 'git', count: 1 }])
  })

  it('renders a CSV header plus one row per day', () => {
    const snapshot = aggregateStats([], [terminal('t1', Date.UTC(2026, 7, 3, 9))], QUERY)
    const csv = exportCsv(snapshot)
    expect(csv.split('\r\n')[0]).toBe('"date","ai_tokens","ai_calls","ai_messages","ai_sessions","terminal_sessions","commands","terminal_ms"')
    expect(csv).toContain('"2026-08-03"')
    expect(csv).toContain('"1"') // terminal_sessions for that day
  })
})

describe('UsageService integration', () => {
  it('folds terminal events emitted on the shared ctx into a snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-usage-'))
    const ctx = new Context()
    contexts.add(ctx)
    const service = new UsageService(ctx, { cachePath: join(dir, 'usage-v1.json'), cacheWriteDelayMs: 10 })

    ctx.emit(TERMINAL_EVENTS.spawn, { id: 't1', time: Date.UTC(2026, 7, 3, 9), shell: 'zsh', cwd: '/proj' })
    ctx.emit(TERMINAL_EVENTS.command, { id: 't1', time: Date.UTC(2026, 7, 3, 9, 5), name: 'git' })
    ctx.emit(TERMINAL_EVENTS.exit, { id: 't1', time: Date.UTC(2026, 7, 3, 9, 30), exitCode: 0, signal: null })

    const snapshot = await service.snapshot(QUERY)
    expect(snapshot.totals.terminalSessions).toBe(1)
    expect(snapshot.totals.commands).toBe(1)
    expect(snapshot.totals.terminalMs).toBe(1_800_000)
    const day = snapshot.days.find(d => d.date === '2026-08-03')
    expect(day?.terminalSessions).toBe(1)

    // Debounced cache lands on disk and replays on a fresh service (a second
    // UsageService cannot re-provide 'usagePanel' on the same ctx).
    await new Promise<void>(resolve => setTimeout(resolve, 60))
    expect(existsSync(join(dir, 'usage-v1.json'))).toBe(true)
    const ctx2 = new Context()
    contexts.add(ctx2)
    const reloaded = new UsageService(ctx2, { cachePath: join(dir, 'usage-v1.json'), cacheWriteDelayMs: 10 })
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    const replayed = await reloaded.snapshot(QUERY)
    expect(replayed.totals.terminalSessions).toBe(1)
    expect(replayed.totals.commands).toBe(1)

    rmSync(dir, { recursive: true, force: true })
  })

  it('folds live session/event AI activities into a snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-usage-'))
    const ctx = new Context()
    contexts.add(ctx)
    const service = new UsageService(ctx, { cachePath: join(dir, 'usage-v1.json'), cacheWriteDelayMs: 10 })

    const session = { id: 's1', header: header('s1', Date.UTC(2026, 7, 3, 8)) } as Session
    ctx.emit('session/event', session, userMessage(0, Date.UTC(2026, 7, 3, 9)))
    ctx.emit('session/event', session, stepStart(1, Date.UTC(2026, 7, 3, 9)))
    ctx.emit('session/event', session, assistantMessage(2, Date.UTC(2026, 7, 3, 9, 1), 'deepseek-chat', { inputTokens: 100, outputTokens: 50 }))

    const snapshot = await service.snapshot(QUERY)
    expect(snapshot.totals.aiMessages).toBe(2)
    expect(snapshot.totals.aiCalls).toBe(1)
    expect(snapshot.totals.aiTokens).toBe(150)
    expect(snapshot.models[0]?.model).toBe('deepseek-chat')

    rmSync(dir, { recursive: true, force: true })
  })

  it('records command names and exit codes through the real terminal service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-usage-'))
    const ctx = new Context()
    contexts.add(ctx)

    // Controllable process exit so the exit event can be fired after dispose.
    let resolveDone!: (outcome: { exitCode: number | null; signal: string | null }) => void
    const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { resolveDone = resolve })
    const output = new PassThrough()
    const handle: SubprocessTerminalHandle = {
      pid: 123,
      output,
      done,
      write: vi.fn(async () => {}),
      inspectForeground: vi.fn(async () => ({ processGroupId: 123, inputWaiting: true })),
      signalForeground: vi.fn(async () => 123),
      terminate: vi.fn(async () => { output.end() }),
    }
    ctx.provide('subprocess', { spawnTerminal: vi.fn(async () => handle) } as never)

    const usage = new UsageService(ctx, { cachePath: join(dir, 'usage-v1.json'), cacheWriteDelayMs: 10 })
    const terminalService = new TerminalPanelService(ctx)

    // The client streams keystrokes with submit=false; Enter arrives as \r.
    const spawned = await terminalService.spawn({ argv: [], cwd: '/tmp', rows: 24, cols: 80 })
    for (const ch of ['g', 'i', 't', ' ', 's', 't', 'a', 't', 'u', 's', '\r', 'n', 'p', 'm', ' ', 'i', '\r']) {
      await terminalService.write(spawned.id, ch, false)
    }

    const page = await usage.terminals({ from: '2026-08-01', to: '2026-08-31', timeZone: 'UTC', page: 1, pageSize: 10 })
    expect(page.items[0]?.commandCount).toBe(2)
    expect(page.items[0]?.commands).toEqual([{ name: 'git', count: 1 }, { name: 'npm', count: 1 }])

    // Close the tab (dispose) then the process exits; the exit code must survive.
    await terminalService.dispose(spawned.id)
    resolveDone({ exitCode: 0, signal: null })
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    const after = await usage.terminals({ from: '2026-08-01', to: '2026-08-31', timeZone: 'UTC', page: 1, pageSize: 10 })
    expect(after.items[0]?.endedAt).not.toBeNull()
    expect(after.items[0]?.exitCode).toBe(0)

    rmSync(dir, { recursive: true, force: true })
  })
})
