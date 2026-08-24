/**
 * Host-face Typert manifest for dsh-toolkit, consumed by the typert-loader.
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
 * @module dsh-toolkit/typert.host
 */

import { z } from 'zod'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

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
    id: `dsh-toolkit#${NAMESPACE}/${method}`,
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
  package: 'dsh-toolkit',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('spawn', [
      { name: 'request', schema: spawnRequestSchema, typeSymbol: 'dsh-toolkit#terminalPanel/spawn:request' },
    ], spawnResultSchema, 'dsh-toolkit#terminalPanel/spawn:result'),
    invocation('write', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/write:id' },
      { name: 'text', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/write:text' },
      { name: 'submit', schema: z.boolean(), typeSymbol: 'dsh-toolkit#terminalPanel/write:submit' },
    ], writeResultSchema, 'dsh-toolkit#terminalPanel/write:result'),
    invocation('read', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/read:id' },
    ], readResultSchema, 'dsh-toolkit#terminalPanel/read:result'),
    invocation('signal', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/signal:id' },
      { name: 'sig', schema: signalSchema, typeSymbol: 'dsh-toolkit#terminalPanel/signal:sig' },
    ], signalResultSchema, 'dsh-toolkit#terminalPanel/signal:result'),
    invocation('terminate', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/terminate:id' },
    ], terminateResultSchema, 'dsh-toolkit#terminalPanel/terminate:result'),
    invocation('list', [], listResultSchema, 'dsh-toolkit#terminalPanel/list:result'),
    invocation('dispose', [
      { name: 'id', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/dispose:id' },
    ], disposeResultSchema, 'dsh-toolkit#terminalPanel/dispose:result'),
    invocation('readFile', [
      { name: 'path', schema: z.string(), typeSymbol: 'dsh-toolkit#terminalPanel/readFile:path' },
      { name: 'cwd', schema: z.string().optional(), typeSymbol: 'dsh-toolkit#terminalPanel/readFile:cwd' },
    ], readFileResultSchema, 'dsh-toolkit#terminalPanel/readFile:result', { parameter: 'signal' }),
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}

export default TYPERT
