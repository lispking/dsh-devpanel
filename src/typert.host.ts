/**
 * Host-face Typert manifest for dsh-devpanel, consumed by the typert-loader.
 *
 * The loader registers every `./typert`-exporting package's invocations into
 * the gateway's `typert.local` table, which is what `claimsEndpoint` consults
 * first. This artifact is REQUIRED for an out-of-tree bundle: the runtime
 * fallback (`collectSrcClaims`) reflects `@Remote` markers through the module
 * singleton of `@deepseek-ai/dsh-typert-protocol` that the gateway itself
 * loaded — an independently installed bundle resolves a different copy, so
 * its markers are invisible and the endpoints would 404. Shipping the strict
 * manifest here makes the endpoints known regardless of module identity.
 *
 * The shape mirrors generator output (`@deepseek-ai/dsh-typert-generator`);
 * wire vocabulary and zod schemas must match the host service methods and the
 * client-side contribution in `./client/remote.ts`.
 * @module dsh-devpanel/typert.host
 */

import { z } from 'zod'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
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
  statResultSchema,
  signalSchema,
} from './schemas.ts'
import {
  usageCallsPageSchema,
  usageCallsQuerySchema,
  usageExportJsonResultSchema,
  usageExportResultSchema,
  usageQuerySchema,
  usageSnapshotSchema,
  usageTerminalsPageSchema,
  usageTerminalsQuerySchema,
} from './usage-schemas.ts'

const NAMESPACE = 'terminalPanel'

/** Wire namespace of the usage panel service (see `src/usage.ts`). */
const USAGE_NAMESPACE = 'usagePanel'

/** One direct invocation descriptor, shaped like the generator's output. */
function invocation(
  method: string,
  parameters: Array<{
    name: string
    schema: z.ZodType
    typeSymbol: string
  }>,
  resultSchema: z.ZodType,
  resultSymbol: string,
  cancellation?: { parameter: 'signal' },
  namespace = NAMESPACE,
): TypertContribution['invocations'][number] {
  return {
    id: `dsh-devpanel#${namespace}/${method}`,
    service: namespace,
    namespace,
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map(parameter => ({
      name: parameter.name,
      wire: parameter.name,
      source: 'json' as const,
      codec: {
        mode: 'strict' as const,
        typeSymbol: parameter.typeSymbol,
        schema: parameter.schema,
      },
    })),
    ...(cancellation === undefined ? {} : { cancellation }),
    result: {
      mode: 'strict' as const,
      typeSymbol: resultSymbol,
      schema: resultSchema,
    },
  }
}

/** Host-face contribution registered by the typert-loader. */
export const TYPERT: TypertContribution = {
  package: 'dsh-devpanel',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('spawn', [
      { name: 'request', schema: spawnRequestSchema, typeSymbol: 'dsh-devpanel#terminalPanel/spawn:request' },
    ], spawnResultSchema, 'dsh-devpanel#terminalPanel/spawn:result'),
    invocation('write', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/write:id' },
      { name: 'text', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/write:text' },
      { name: 'submit', schema: z.boolean(), typeSymbol: 'dsh-devpanel#terminalPanel/write:submit' },
    ], writeResultSchema, 'dsh-devpanel#terminalPanel/write:result'),
    invocation('read', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/read:id' },
    ], readResultSchema, 'dsh-devpanel#terminalPanel/read:result'),
    invocation('signal', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/signal:id' },
      { name: 'sig', schema: signalSchema, typeSymbol: 'dsh-devpanel#terminalPanel/signal:sig' },
    ], signalResultSchema, 'dsh-devpanel#terminalPanel/signal:result'),
    invocation('terminate', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/terminate:id' },
    ], terminateResultSchema, 'dsh-devpanel#terminalPanel/terminate:result'),
    invocation('list', [], listResultSchema, 'dsh-devpanel#terminalPanel/list:result'),
    invocation('dispose', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/dispose:id' },
    ], disposeResultSchema, 'dsh-devpanel#terminalPanel/dispose:result'),
    invocation('readFile', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/readFile:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/readFile:cwd' },
    ], readFileResultSchema, 'dsh-devpanel#terminalPanel/readFile:result', { parameter: 'signal' }),
    invocation('listDir', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/listDir:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/listDir:cwd' },
    ], listDirResultSchema, 'dsh-devpanel#terminalPanel/listDir:result', { parameter: 'signal' }),
    invocation('tail', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/tail:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/tail:cwd' },
      { name: 'offset', schema: z.number().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/tail:offset' },
    ], tailResultSchema, 'dsh-devpanel#terminalPanel/tail:result', { parameter: 'signal' }),
    invocation('statFile', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-devpanel#terminalPanel/statFile:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-devpanel#terminalPanel/statFile:cwd' },
    ], statResultSchema, 'dsh-devpanel#terminalPanel/statFile:result', { parameter: 'signal' }),
    // Usage panel (see src/usage.ts) — the AI + terminal dual-dimension stats.
    invocation('snapshot', [
      { name: 'query', schema: usageQuerySchema, typeSymbol: 'dsh-devpanel#usagePanel/snapshot:query' },
    ], usageSnapshotSchema, 'dsh-devpanel#usagePanel/snapshot:result', undefined, USAGE_NAMESPACE),
    invocation('calls', [
      { name: 'query', schema: usageCallsQuerySchema, typeSymbol: 'dsh-devpanel#usagePanel/calls:query' },
    ], usageCallsPageSchema, 'dsh-devpanel#usagePanel/calls:result', undefined, USAGE_NAMESPACE),
    invocation('terminals', [
      { name: 'query', schema: usageTerminalsQuerySchema, typeSymbol: 'dsh-devpanel#usagePanel/terminals:query' },
    ], usageTerminalsPageSchema, 'dsh-devpanel#usagePanel/terminals:result', undefined, USAGE_NAMESPACE),
    invocation('exportCsv', [
      { name: 'query', schema: usageQuerySchema, typeSymbol: 'dsh-devpanel#usagePanel/exportCsv:query' },
    ], usageExportResultSchema, 'dsh-devpanel#usagePanel/exportCsv:result', undefined, USAGE_NAMESPACE),
    invocation('exportJson', [
      { name: 'query', schema: usageQuerySchema, typeSymbol: 'dsh-devpanel#usagePanel/exportJson:query' },
    ], usageExportJsonResultSchema, 'dsh-devpanel#usagePanel/exportJson:result', undefined, USAGE_NAMESPACE),
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}

export default TYPERT
