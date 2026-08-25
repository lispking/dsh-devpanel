/**
 * Wire vocabulary of the dsh-devpanel usage panel: the JSON-safe shapes
 * crossing the Typert Remote boundary between the browser client and the
 * host's UsageService. Pure data — no Node or harness runtime imports, so
 * this module is shared by the host service (encode) and the client
 * contribution (typed descriptors), exactly like `./types.ts`.
 *
 * The panel is deliberately TWO-dimensional: the AI dimension (token usage,
 * calls, effort — the same session-event stream dsh-usage-stats reads) and
 * the terminal dimension (PTY sessions, submitted commands, wall time — only
 * dsh-devpanel can see these, because it owns the terminal panel). The
 * aggregation merges both into one "how much did I actually work" view.
 * @module dsh-devpanel/usage-types
 */

/** Scope filter over the session lineage (mirrors dsh-usage-stats). */
export type UsageScope = 'all' | 'main' | 'subtasks'

/** Token accounting for one model call; counts are disjoint (cached input is
 *  reported separately), matching the harness TokenUsage shape. */
export interface UsageTokens {
  /** Uncached input tokens. */
  input: number
  /** Output tokens. */
  output: number
  /** Cache-hit input tokens. */
  cacheRead: number
  /** Cache-write input tokens. */
  cacheWrite: number
  /** Reasoning (thinking) tokens, when the adapter reported them. */
  reasoning: number
}

/** One recorded AI activity: a human message or an assistant model call. */
export interface UsageAiActivity {
  /** Session-log sequence number (dedup + ordering). */
  seq: number
  /** Unix epoch milliseconds. */
  time: number
  /** Human prompt or assistant call. */
  kind: 'human' | 'assistant'
  /** Provider route that produced the message (assistant only). */
  provider?: string
  /** Provider model id (assistant only). */
  model?: string
  /** Token accounting (assistant only). */
  tokens?: UsageTokens
  /** End-to-end response time from step/start to assistant/message, in ms. */
  durationMs?: number
  /** Effective reasoning effort from the nearest request/header. */
  effort?: string
}

/** Per-chat-session summary on the AI side (mirrors the reference SessionSummary). */
export interface UsageSessionSummary {
  /** Chat session id. */
  id: string
  /** Session creation time in Unix epoch milliseconds. */
  createdAt: number
  /** Absolute working directory the session was created in. */
  cwd?: string
  /** Fork lineage: the session this one was forked from. */
  parentSession?: string
  /** Highest raw-log seq folded into this summary (dedup cursor). */
  lastSeq: number
  /** When this summary was last folded. */
  indexedAt: number
  /** Folded activities in log order. */
  activities: UsageAiActivity[]
}

/** One command-name aggregate (name → count) served by the `terminals` endpoint. */
export interface UsageCommandCount {
  /** The command name (first token of the submitted line). */
  name: string
  /** How many times it was submitted. */
  count: number
}

/** One recorded terminal session (the dimension only dsh-devpanel can see). */
export interface UsageTerminalSession {
  /** Terminal session id (the terminalPanel service's minted id). */
  id: string
  /** Spawn time in Unix epoch milliseconds. */
  startedAt: number
  /** Exit time; absent while the session is still running. */
  endedAt?: number
  /** Wall time in ms; absent while running. */
  durationMs?: number
  /** Shell program name (e.g. 'zsh'). */
  shell: string
  /** Working directory the session was spawned in. */
  cwd?: string
  /** Owning chat session id (the browser-side panel identity). */
  owner?: string
  /** Exit code; null when the process was killed by a signal or is running. */
  exitCode?: number | null
  /** Terminating signal, when the process was killed by one. */
  signal?: string | null
  /** Command-name → count for this session. The original command text is
   *  deliberately NOT stored (it can carry secrets); only the first token
   *  (the tool name) is aggregated. */
  commandCounts: Record<string, number>
}

/** Durable index cache written to disk (debounced) and replayed on startup. */
export interface UsageIndexCache {
  /** Schema version; bump to force a rebuild when the shape changes. */
  schema: 1
  /** AI-side per-session summaries. */
  aiSessions: UsageSessionSummary[]
  /** Terminal-side session records. */
  terminalSessions: UsageTerminalSession[]
}

/** Query for the aggregated snapshot. */
export interface UsageQuery {
  /** Inclusive range start, `YYYY-MM-DD`. */
  from: string
  /** Inclusive range end, `YYYY-MM-DD`. */
  to: string
  /** IANA time zone for day bucketing. */
  timeZone: string
  /** Exact workspace (session cwd) filter; absent means all. */
  workspace?: string
  /** Lineage scope filter. */
  scope: UsageScope
}

/** One day's merged AI + terminal figures. */
export interface UsageDayStats {
  /** `YYYY-MM-DD` in the query time zone. */
  date: string
  /** AI: total billed tokens (input + output + cacheRead + cacheWrite). */
  aiTokens: number
  /** AI: assistant calls. */
  aiCalls: number
  /** AI: human + assistant messages. */
  aiMessages: number
  /** AI: distinct active chat sessions. */
  aiSessions: number
  /** Terminal: sessions that started that day. */
  terminalSessions: number
  /** Terminal: commands submitted that day. */
  commands: number
  /** Terminal: wall time (ms) of sessions that ended that day. */
  terminalMs: number
}

/** One model's aggregate within the range. */
export interface UsageModelStats {
  /** `${provider}/${model}` composite key. */
  key: string
  provider: string
  model: string
  /** Billed tokens. */
  tokens: number
  /** Assistant calls. */
  calls: number
  /** Share of the range's total tokens, 0–100. */
  percent: number
}

/** One tool (command name) aggregate within the range. */
export interface UsageToolStats {
  /** The command name (first token of the submitted line). */
  name: string
  /** How many times it was submitted. */
  count: number
  /** Share of the range's total command count, 0–100. */
  percent: number
}

/** Merged totals for the range. */
export interface UsageTotals {
  /** AI billed tokens. */
  aiTokens: number
  /** AI assistant calls. */
  aiCalls: number
  /** AI human + assistant messages. */
  aiMessages: number
  /** AI distinct active chat sessions. */
  aiSessions: number
  /** AI distinct active days. */
  aiActiveDays: number
  /** AI consecutive active days ending at the range end. */
  aiCurrentStreak: number
  /** Terminal sessions started in the range. */
  terminalSessions: number
  /** Terminal commands submitted in the range. */
  commands: number
  /** Terminal wall time (ms) of sessions ended in the range. */
  terminalMs: number
  /** Terminal distinct active days. */
  terminalActiveDays: number
}

/** One workspace (session cwd) with its session count. */
export interface UsageWorkspace {
  /** Absolute working directory path. */
  path: string
  /** Distinct chat sessions created there. */
  sessions: number
}

/** The aggregated snapshot served by the `snapshot` endpoint. */
export interface UsageSnapshot {
  /** When the snapshot was computed. */
  generatedAt: number
  /** Echo of the query the snapshot answers. */
  range: { from: string; to: string; timeZone: string }
  /** Merged totals. */
  totals: UsageTotals
  /** Day rows in ascending date order. */
  days: UsageDayStats[]
  /** Model aggregates, token-descending. */
  models: UsageModelStats[]
  /** Tool (command-name) aggregates, count-descending. */
  tools: UsageToolStats[]
  /** Workspace aggregates, session-descending. */
  workspaces: UsageWorkspace[]
  /** Index health. */
  index: {
    /** AI sessions folded. */
    aiSessions: number
    /** Terminal sessions folded. */
    terminalSessions: number
    /** Most recent fold time, or null when empty. */
    lastUpdatedAt: number | null
  }
}

/** One assistant call row served by the `calls` endpoint. */
export interface UsageCallRecord {
  /** `${sessionId}:${seq}` composite key. */
  key: string
  seq: number
  time: number
  sessionId: string
  provider: string
  model: string
  effort: string | null
  durationMs: number | null
  tokens: UsageTokens
}

/** Query for the per-call detail endpoint. */
export interface UsageCallsQuery extends UsageQuery {
  /** Exact model filter; absent means no filter. */
  model?: string
  /** Exact provider route filter; absent means no filter. */
  provider?: string
  /** Keep only calls whose billed input tokens are at least this value. */
  minInputTokens?: number
  /** Keep only calls whose output tokens are at least this value. */
  minOutputTokens?: number
  /** 1-based page. */
  page: number
  /** Rows per page. */
  pageSize: number
}

/** Paginated payload served by the `calls` endpoint. */
export interface UsageCallsPage {
  /** True once historical replay finished (details are complete). */
  indexReady: boolean
  items: UsageCallRecord[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

/** One terminal session row served by the `terminals` endpoint. */
export interface UsageTerminalRecord {
  id: string
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  shell: string
  cwd: string | null
  owner: string | null
  exitCode: number | null
  signal: string | null
  /** Total commands submitted in this session. */
  commandCount: number
  /** Command-name breakdown, count-descending (top 8 for display). */
  commands: UsageCommandCount[]
}

/** Query for the terminal-session detail endpoint. */
export interface UsageTerminalsQuery {
  /** Inclusive range start, `YYYY-MM-DD`. */
  from: string
  /** Inclusive range end, `YYYY-MM-DD`. */
  to: string
  /** IANA time zone for day bucketing. */
  timeZone: string
  /** Exact workspace (session cwd) filter; absent means all. */
  workspace?: string
  /** 1-based page. */
  page: number
  /** Rows per page. */
  pageSize: number
}

/** Paginated payload served by the `terminals` endpoint. */
export interface UsageTerminalsPage {
  items: UsageTerminalRecord[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}
