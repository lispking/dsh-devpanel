/**
 * Shared zod codecs for the terminalPanel Remote boundary. Imported by both
 * the host-face Typert manifest (`typert.host.ts`) and the client-face
 * contribution (`client/remote.ts`), so a wire-shape change is a single edit
 * instead of two hand-synced copies. Pure data: no Node or harness runtime.
 * @module dsh-devpanel/schemas
 */

import { z } from 'zod'

/** Top-level session status (running or exited with optional exit metadata). */
export const sessionStatusSchema = z.union([
  z.object({ kind: z.literal('running') }),
  z.object({
    kind: z.literal('exited'),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
  }),
])

/** Spawn request: argv (empty = system login shell), cwd, initial size, optional name. */
export const spawnRequestSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
  rows: z.number(),
  cols: z.number(),
  name: z.string().optional(),
})

/** Spawn result: service-minted id, top-level pid, shell program name. */
export const spawnResultSchema = z.object({ id: z.string(), pid: z.number(), shell: z.string() })

/** Write result: always ok on a settled write. */
export const writeResultSchema = z.object({ ok: z.literal(true) })

/** Read result: incremental delta plus current top-level status. */
export const readResultSchema = z.object({
  delta: z.string(),
  status: sessionStatusSchema,
})

/** Signal result: the verified foreground group that received the signal. */
export const signalResultSchema = z.object({ delivered: z.literal(true), targetPgid: z.number() })

/** Terminate result: always ok on a settled terminate. */
export const terminateResultSchema = z.object({ ok: z.literal(true) })

/** Owner-visible session summary. */
export const sessionViewSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  shell: z.string().optional(),
  pid: z.number().optional(),
  status: sessionStatusSchema,
})

/** List result: live sessions in creation order. */
export const listResultSchema = z.object({ sessions: z.array(sessionViewSchema) })

/** Dispose result: always ok (idempotent on unknown ids). */
export const disposeResultSchema = z.object({ ok: z.literal(true) })

/** Read-file result: path, classification, content or data URL. */
export const readFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  kind: z.union([
    z.literal('text'),
    z.literal('image'),
    z.literal('pdf'),
    z.literal('audio'),
    z.literal('video'),
    z.literal('binary'),
  ]),
  dataUrl: z.string().optional(),
  size: z.number().optional(),
})

/** One directory entry (name + dir/file kind). */
export const dirEntrySchema = z.object({
  name: z.string(),
  kind: z.union([z.literal('dir'), z.literal('file')]),
})

/** Directory listing result: resolved path + sorted entries. */
export const listDirResultSchema = z.object({
  path: z.string(),
  entries: z.array(dirEntrySchema),
})

/** Incremental tail chunk: delta bytes, the next offset, and a gone flag. */
export const tailResultSchema = z.object({
  path: z.string(),
  delta: z.string(),
  offset: z.number(),
  gone: z.boolean(),
})

/** Permitted terminal signals (mirrors SubprocessTerminalSignal). */
export const signalSchema = z.union([
  z.literal('SIGINT'),
  z.literal('SIGTERM'),
  z.literal('SIGKILL'),
  z.literal('SIGTSTP'),
  z.literal('SIGHUP'),
])
