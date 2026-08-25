/**
 * Shared zod codecs for the usagePanel Remote boundary. Imported by both the
 * host-face Typert manifest (`typert.host.ts`) and the client-face
 * contribution (`client/remote.ts`), so a wire-shape change is a single edit
 * instead of two hand-synced copies. Pure data: no Node or harness runtime.
 * @module dsh-devpanel/usage-schemas
 */

import { z } from 'zod'

/** Token accounting for one model call (disjoint counts). */
export const usageTokensSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
})

/** Scope filter over the session lineage. */
export const usageScopeSchema = z.union([
  z.literal('all'),
  z.literal('main'),
  z.literal('subtasks'),
])

/** Query for the aggregated snapshot. */
export const usageQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  workspace: z.string().optional(),
  scope: usageScopeSchema,
})

/** One day's merged AI + terminal figures. */
export const usageDayStatsSchema = z.object({
  date: z.string(),
  aiTokens: z.number(),
  aiCalls: z.number(),
  aiMessages: z.number(),
  aiSessions: z.number(),
  terminalSessions: z.number(),
  commands: z.number(),
  terminalMs: z.number(),
})

/** One model's aggregate within the range. */
export const usageModelStatsSchema = z.object({
  key: z.string(),
  provider: z.string(),
  model: z.string(),
  tokens: z.number(),
  calls: z.number(),
  percent: z.number(),
})

/** Merged totals for the range. */
export const usageTotalsSchema = z.object({
  aiTokens: z.number(),
  aiCalls: z.number(),
  aiMessages: z.number(),
  aiSessions: z.number(),
  aiActiveDays: z.number(),
  aiCurrentStreak: z.number(),
  terminalSessions: z.number(),
  commands: z.number(),
  terminalMs: z.number(),
  terminalActiveDays: z.number(),
})

/** One workspace (session cwd) with its session count. */
export const usageWorkspaceSchema = z.object({
  path: z.string(),
  sessions: z.number(),
})

/** One tool (command name) aggregate within the range. */
export const usageToolStatsSchema = z.object({
  name: z.string(),
  count: z.number(),
  percent: z.number(),
})

/** The aggregated snapshot served by the `snapshot` endpoint. */
export const usageSnapshotSchema = z.object({
  generatedAt: z.number(),
  range: z.object({
    from: z.string(),
    to: z.string(),
    timeZone: z.string(),
  }),
  totals: usageTotalsSchema,
  days: z.array(usageDayStatsSchema),
  models: z.array(usageModelStatsSchema),
  tools: z.array(usageToolStatsSchema),
  workspaces: z.array(usageWorkspaceSchema),
  index: z.object({
    aiSessions: z.number(),
    terminalSessions: z.number(),
    lastUpdatedAt: z.number().nullable(),
  }),
})

/** Query for the per-call detail endpoint. */
export const usageCallsQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  workspace: z.string().optional(),
  scope: usageScopeSchema,
  model: z.string().optional(),
  provider: z.string().optional(),
  minInputTokens: z.number().optional(),
  minOutputTokens: z.number().optional(),
  page: z.number(),
  pageSize: z.number(),
})

/** One assistant call row. */
export const usageCallRecordSchema = z.object({
  key: z.string(),
  seq: z.number(),
  time: z.number(),
  sessionId: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.string().nullable(),
  durationMs: z.number().nullable(),
  tokens: usageTokensSchema,
})

/** Paginated call page. */
export const usageCallsPageSchema = z.object({
  indexReady: z.boolean(),
  items: z.array(usageCallRecordSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  hasMore: z.boolean(),
})

/** One command-name aggregate (name → count). */
export const usageCommandCountSchema = z.object({
  name: z.string(),
  count: z.number(),
})

/** One terminal session row. */
export const usageTerminalRecordSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  shell: z.string(),
  cwd: z.string().nullable(),
  owner: z.string().nullable(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  commandCount: z.number(),
  commands: z.array(usageCommandCountSchema),
})

/** Query for the terminal-session detail endpoint. */
export const usageTerminalsQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  workspace: z.string().optional(),
  page: z.number(),
  pageSize: z.number(),
})

/** Paginated terminal-session page. */
export const usageTerminalsPageSchema = z.object({
  items: z.array(usageTerminalRecordSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  hasMore: z.boolean(),
})

/** CSV export payload (text body + suggested filename). */
export const usageExportResultSchema = z.object({
  filename: z.string(),
  body: z.string(),
})

/** JSON export payload (the snapshot itself, serialized). */
export const usageExportJsonResultSchema = z.object({
  filename: z.string(),
  body: z.string(),
})
