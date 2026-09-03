// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

// ConsoleSidebar.tsx pulls the runtime only through console-store.ts's value
// import of createSnapshotStore (every @deepseek-ai import in the client half
// is otherwise type-only and erased). Mock the store module with the same
// minimal stub the client apply spec uses.
vi.mock('../src/client/console-store.ts', () => {
  const state = { sidebarOpen: {}, dialogOpen: {}, activeTerminalId: {} }
  return {
    createConsoleStore: () => ({
      getSnapshot: () => state,
      subscribe: () => () => {},
      update: (mutator: (draft: typeof state) => void) => { mutator(state) },
      set: (next: typeof state) => { Object.assign(state, next) },
    }),
    sidebarOpenFor: (_s: typeof state, sessionId: string | undefined) =>
      sessionId === undefined ? false : state.sidebarOpen[sessionId] ?? false,
    dialogOpenFor: (_s: typeof state, sessionId: string | undefined) =>
      sessionId === undefined ? false : state.dialogOpen[sessionId] ?? false,
    activeTerminalFor: (_s: typeof state, sessionId: string | undefined) =>
      sessionId === undefined ? null : state.activeTerminalId[sessionId] ?? null,
  }
})

import type { ChatSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { collectArtifacts } from '../src/client/ConsoleSidebar.tsx'

/**
 * A settled `tool-result` root for any tool: the call head carries the raw
 * model arguments, the result carries the model-facing content blocks — the
 * shape the harness materializes for write/edit AND for shell tools alike.
 */
function settledTool(options: {
  name: string
  args?: Record<string, unknown>
  output?: string
  subCalls?: ToolCallBlock[]
}): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 1_100,
    callId: options.name === 'bash' ? 'sh1' : 'w1',
    call: { name: options.name, argsRaw: JSON.stringify(options.args ?? {}) },
    callTime: 1_000,
    content: options.output === undefined ? [] : [{ type: 'text', text: options.output }],
    isError: false,
    subCalls: options.subCalls ?? [],
  }
}

/** A snapshot whose chat store holds the given roots. */
function snapshotWith(roots: ToolCallBlock[]): ChatSnapshot {
  const rows = roots.map((root, index) => ({
    kind: 'tool-call' as const,
    seq: index + 1,
    data: { root },
  }))
  return {
    nodes: { values: () => rows },
    legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
  } as unknown as ChatSnapshot
}

/** The recorded artifact paths of one snapshot, in first-seen order. */
function artifactPaths(snapshot: ChatSnapshot): string[] {
  return collectArtifacts(snapshot).files.map(file => file.path)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('collectArtifacts write/edit registration', () => {
  it('records a write call from its raw-args path', () => {
    const snapshot = snapshotWith([
      settledTool({ name: 'write', args: { path: 'a.mp4' } }),
    ])
    expect(artifactPaths(snapshot)).toEqual(['a.mp4'])
  })

  it('records a mutation envelope result under the file it names', () => {
    const snapshot = snapshotWith([
      settledTool({ name: 'write', args: { path: 'a.mp4' }, output: 'The file a.mp4 has been updated.' }),
    ])
    expect(artifactPaths(snapshot)).toEqual(['a.mp4'])
  })

  it('records an edit result carrying a unified diff', () => {
    const snapshot = snapshotWith([
      settledTool({
        name: 'edit',
        args: { path: 'src/x.txt' },
        output: '--- src/x.txt\n+++ src/x.txt\n@@ -1 +1 @@\n-old line\n+new line\n',
      }),
    ])
    const { files, history } = collectArtifacts(snapshot)
    expect(files.map(file => file.path)).toEqual(['src/x.txt'])
    expect(history.get('src/x.txt')?.some(hunk => hunk.newText.trim() === 'new line')).toBe(true)
  })

  it('ignores a write result whose text is not a mutation envelope', () => {
    const snapshot = snapshotWith([
      settledTool({ name: 'write', args: {}, output: 'done writing, all good' }),
    ])
    expect(artifactPaths(snapshot)).toEqual([])
  })
})

describe('collectArtifacts non-mutation tools', () => {
  it('never registers a shell tool result line as a file path', () => {
    // Regression: a single-line bash result ("Updated todo list: …" style
    // notices the harness echoes) must NOT become a session-file entry that
    // cannot be opened (stat: no such file or directory).
    const snapshot = snapshotWith([
      settledTool({
        name: 'bash',
        args: { command: 'ls' },
        output: 'Updated todo list: 4 pending, 1 in progress, 1 completed.',
      }),
    ])
    expect(artifactPaths(snapshot)).toEqual([])
  })

  it('never registers a shell tool result even when it looks like a patch', () => {
    const snapshot = snapshotWith([
      settledTool({
        name: 'bash',
        args: { command: 'git diff' },
        output: '--- a/foo.txt\n+++ b/foo.txt\n@@ -1 +1 @@\n-old\n+new\n',
      }),
    ])
    expect(artifactPaths(snapshot)).toEqual([])
  })

  it('ignores read-style and unknown tools entirely', () => {
    const snapshot = snapshotWith([
      settledTool({ name: 'read', args: { path: 'a.mp4' }, output: 'The file a.mp4 has been updated.' }),
      settledTool({ name: 'search', args: { query: 'x' }, output: 'found a.mp4.' }),
    ])
    expect(artifactPaths(snapshot)).toEqual([])
  })

  it('tolerates an undefined snapshot', () => {
    expect(artifactPaths(undefined as unknown as ChatSnapshot)).toEqual([])
  })
})
