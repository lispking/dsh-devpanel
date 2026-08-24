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
  signalSchema,
} from './schemas.ts'

const NAMESPACE = 'terminalPanel'

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
): TypertContribution['invocations'][number] {
  return {
    id: `dsh-devpanel#${NAMESPACE}/${method}`,
    service: NAMESPACE,
    namespace: NAMESPACE,
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
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}

export default TYPERT
