/**
 * Client half of the terminalPanel Remote: the hand-written TYPERT_REMOTE
 * contribution (mirroring what @deepseek-ai/dsh-typert-generator emits) plus
 * the declaration-merge that types `ctx.remote.terminalPanel.*` on the
 * browser side. The Host side needs no generator run: the Gateway discovers
 * TerminalPanelService through its `typertRemote` binding and reflects the
 * `@Remote` methods, so this contribution is the only client-side artifact.
 *
 * Wire shapes come from dsh-devpanel/types (the shared JSON vocabulary); the
 * zod schemas below are the strict boundary codecs the client api requires.
 * @module dsh-devpanel/client/remote
 */

import { z } from 'zod'
import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  ConsoleListDirResult,
  ConsoleListResult,
  ConsoleReadFileResult,
  ConsoleReadResult,
  ConsoleSignalResult,
  ConsoleSpawnRequest,
  ConsoleSpawnResult,
  ConsoleTailResult,
  ConsoleTerminalSignal,
  ConsoleTerminateResult,
  ConsoleWriteResult,
} from '../types.ts'
import {
  spawnRequestSchema,
  spawnResultSchema,
  writeResultSchema,
  readResultSchema,
  signalResultSchema,
  terminateResultSchema,
  listResultSchema,
  disposeResultSchema,
  readFileResultSchema,
  listDirResultSchema,
  tailResultSchema,
  signalSchema,
} from '../schemas.ts'

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
    id: `dsh-devpanel#${NAMESPACE}/${method}`,
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
  package: 'dsh-devpanel',
  descriptors: [
    descriptor('spawn', [
      { name: 'request', schema: spawnRequestSchema, typeSymbol: 'dsh-devpanel#terminalPanel/spawn:request' },
    ], spawnResultSchema, 'dsh-devpanel#terminalPanel/spawn:result'),
    descriptor('write', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/write:id' },
      { name: 'text', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/write:text' },
      { name: 'submit', schema: z.boolean(), typeSymbol: 'dsh-devpanel#terminalPanel/write:submit' },
    ], writeResultSchema, 'dsh-devpanel#terminalPanel/write:result'),
    descriptor('read', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/read:id' },
    ], readResultSchema, 'dsh-devpanel#terminalPanel/read:result'),
    descriptor('signal', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/signal:id' },
      { name: 'sig', schema: signalSchema, typeSymbol: 'dsh-devpanel#terminalPanel/signal:sig' },
    ], signalResultSchema, 'dsh-devpanel#terminalPanel/signal:result'),
    descriptor('terminate', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/terminate:id' },
    ], terminateResultSchema, 'dsh-devpanel#terminalPanel/terminate:result'),
    descriptor('list', [], listResultSchema, 'dsh-devpanel#terminalPanel/list:result'),
    descriptor('dispose', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/dispose:id' },
    ], disposeResultSchema, 'dsh-devpanel#terminalPanel/dispose:result'),
    descriptor('readFile', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/readFile:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/readFile:cwd' },
    ], readFileResultSchema, 'dsh-devpanel#terminalPanel/readFile:result', { parameter: 'signal' }),
    descriptor('listDir', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/listDir:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/listDir:cwd' },
    ], listDirResultSchema, 'dsh-devpanel#terminalPanel/listDir:result', { parameter: 'signal' }),
    descriptor('tail', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/tail:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/tail:cwd' },
      { name: 'offset', schema: z.number().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/tail:offset' },
    ], tailResultSchema, 'dsh-devpanel#terminalPanel/tail:result', { parameter: 'signal' }),
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
    listDir: (path: string, cwd?: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleListDirResult>>
    tail: (path: string, cwd?: string, offset?: number, signal?: AbortSignal) => Promise<RemoteResult<ConsoleTailResult>>
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
    'terminalPanel/listDir': (path: string, cwd?: string, signal?: AbortSignal) => Promise<RemoteResult<ConsoleListDirResult>>
    'terminalPanel/tail': (path: string, cwd?: string, offset?: number, signal?: AbortSignal) => Promise<RemoteResult<ConsoleTailResult>>
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
  ConsoleListDirResult,
  ConsoleDirEntry,
  ConsoleTailResult,
} from '../types.ts'
