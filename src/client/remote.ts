/**
 * Client half of the terminalPanel Remote: the hand-written TYPERT_REMOTE
 * contribution (mirroring what @deepseek-ai/dsh-typert-generator emits) plus
 * the declaration-merge that types `ctx.remote.terminalPanel.*` on the
 * browser side. The Host side needs no generator run: the Gateway discovers
 * TerminalPanelService through its `typertRemote` binding and reflects the
 * `@Remote` methods, so this contribution is the only client-side artifact.
 *
 * Wire shapes come from dsh-toolkit/types (the shared JSON vocabulary); the
 * zod schemas below are the strict boundary codecs the client api requires.
 * @module dsh-toolkit/client/remote
 */

import { z } from 'zod'
import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  ConsoleListResult,
  ConsoleReadFileResult,
  ConsoleReadResult,
  ConsoleSignalResult,
  ConsoleSpawnRequest,
  ConsoleSpawnResult,
  ConsoleTerminalSignal,
  ConsoleTerminateResult,
  ConsoleWriteResult,
} from '../types.ts'

const sessionStatusSchema = z.union([
  z.object({ kind: z.literal('running') }),
  z.object({
    kind: z.literal('exited'),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
  }),
])

const spawnRequestSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
  rows: z.number(),
  cols: z.number(),
  name: z.string().optional(),
})
const spawnResultSchema = z.object({ id: z.string(), pid: z.number(), shell: z.string() })
const writeResultSchema = z.object({ ok: z.literal(true) })
const readResultSchema = z.object({
  delta: z.string(),
  status: sessionStatusSchema,
})
const signalResultSchema = z.object({ delivered: z.literal(true), targetPgid: z.number() })
const terminateResultSchema = z.object({ ok: z.literal(true) })
const sessionViewSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  shell: z.string().optional(),
  pid: z.number().optional(),
  status: sessionStatusSchema,
})
const listResultSchema = z.object({ sessions: z.array(sessionViewSchema) })
const disposeResultSchema = z.object({ ok: z.literal(true) })
const readFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  kind: z.union([z.literal('text'), z.literal('image')]),
  dataUrl: z.string().optional(),
})

const signalSchema = z.union([
  z.literal('SIGINT'),
  z.literal('SIGTERM'),
  z.literal('SIGKILL'),
  z.literal('SIGTSTP'),
  z.literal('SIGHUP'),
])

const NAMESPACE = 'terminalPanel'

/** One endpoint's descriptor, shaped like the generator's output. */
function descriptor(
  method: string,
  parameters: Array<{
    name: string
    schema: z.ZodType
    typeSymbol: string
  }>,
  resultSchema: z.ZodType,
  resultSymbol: string,
  cancellation?: { parameter: 'signal' },
): TypertRemoteContribution['descriptors'][number] {
  return {
    id: `dsh-toolkit#${NAMESPACE}/${method}`,
    service: NAMESPACE,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map(parameter => ({
      name: parameter.name,
      wire: parameter.name,
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: parameter.typeSymbol,
        schema: parameter.schema,
      },
    })),
    ...(cancellation === undefined ? {} : { cancellation }),
    result: {
      mode: 'strict',
      typeSymbol: resultSymbol,
      schema: resultSchema,
    },
  }
}

/** Generated-style contribution consumed by `ctx.remote.$mount`. */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-toolkit',
  descriptors: [
    descriptor('spawn', [
      { name: 'request', schema: spawnRequestSchema, typeSymbol: 'dsh-toolkit#terminalPanel/spawn:request' },
    ], spawnResultSchema, 'dsh-toolkit#terminalPanel/spawn:result'),
    descriptor('write', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/write:id' },
      { name: 'text', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/write:text' },
      { name: 'submit', schema: z.boolean(), typeSymbol: 'dsh-toolkit#terminalPanel/write:submit' },
    ], writeResultSchema, 'dsh-toolkit#terminalPanel/write:result'),
    descriptor('read', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/read:id' },
    ], readResultSchema, 'dsh-toolkit#terminalPanel/read:result'),
    descriptor('signal', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/signal:id' },
      { name: 'sig', schema: signalSchema, typeSymbol: 'dsh-toolkit#terminalPanel/signal:sig' },
    ], signalResultSchema, 'dsh-toolkit#terminalPanel/signal:result'),
    descriptor('terminate', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/terminate:id' },
    ], terminateResultSchema, 'dsh-toolkit#terminalPanel/terminate:result'),
    descriptor('list', [], listResultSchema, 'dsh-toolkit#terminalPanel/list:result'),
    descriptor('dispose', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/dispose:id' },
    ], disposeResultSchema, 'dsh-toolkit#terminalPanel/dispose:result'),
    descriptor('readFile', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/readFile:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-toolkit#terminalPanel/readFile:cwd' },
    ], readFileResultSchema, 'dsh-toolkit#terminalPanel/readFile:result', { parameter: 'signal' }),
  ],
}

export default TYPERT_REMOTE

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$7465726d696e616c50616e656c {
    spawn: (request: ConsoleSpawnRequest, signal?: AbortSignal) => Promise<RemoteResult<ConsoleSpawnResult>>
    write: (id: string, text: string, submit: boolean, signal?: AbortSignal) => Promise<RemoteResult<ConsoleWriteResult>>
    read: (id: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleReadResult>>
    signal: (id: string, sig: ConsoleTerminalSignal, signal?: AbortSignal) => Promise<RemoteResult<ConsoleSignalResult>>
    terminate: (id: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleTerminateResult>>
    list: (signal?: AbortSignal) => Promise<RemoteResult<ConsoleListResult>>
    dispose: (id: string, signal?: AbortSignal) => Promise<RemoteResult<{ ok: true }>>
    readFile: (path: string, cwd?: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleReadFileResult>>
  }
  interface TypertRemoteMap {
    'terminalPanel/spawn': (request: ConsoleSpawnRequest, signal?: AbortSignal) => Promise<RemoteResult<ConsoleSpawnResult>>
    'terminalPanel/write': (id: string, text: string, submit: boolean, signal?: AbortSignal) => Promise<RemoteResult<ConsoleWriteResult>>
    'terminalPanel/read': (id: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleReadResult>>
    'terminalPanel/signal': (id: string, sig: ConsoleTerminalSignal, signal?: AbortSignal) => Promise<RemoteResult<ConsoleSignalResult>>
    'terminalPanel/terminate': (id: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleTerminateResult>>
    'terminalPanel/list': (signal?: AbortSignal) => Promise<RemoteResult<ConsoleListResult>>
    'terminalPanel/dispose': (id: string, signal?: AbortSignal) => Promise<RemoteResult<{ ok: true }>>
    'terminalPanel/readFile': (path: string, cwd?: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleReadFileResult>>
  }
  interface TypertRemoteNamespaceMap {
    'terminalPanel': TypertRemoteNamespace$7465726d696e616c50616e656c
  }
}

export type {
  ConsoleListResult,
  ConsoleReadResult,
  ConsoleSessionStatus,
  ConsoleSessionView,
  ConsoleSignalResult,
  ConsoleSpawnRequest,
  ConsoleSpawnResult,
  ConsoleTerminalSignal,
  ConsoleTerminateResult,
  ConsoleWriteResult,
} from '../types.ts'
