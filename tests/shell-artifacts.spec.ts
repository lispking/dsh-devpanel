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

import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { collectShellCandidates, pathsFromText } from '../src/client/ConsoleSidebar.tsx'

/** A completed terminal-card tool result node with the given command/output. */
function terminalResult(options: {
  title: string
  output?: string
  cwd?: string
  time?: number
  callTime?: number
}): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: options.time ?? 1_100,
    callId: 'c1',
    call: { name: 'bash', argsRaw: '{}' },
    callTime: options.callTime ?? 1_000,
    content: [],
    isError: false,
    callView: { card: 'terminal', title: options.title, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) },
    resultView: { card: 'terminal', ...(options.output === undefined ? {} : { output: options.output }), exitCode: 0 },
    subCalls: [],
  }
}

/** A snapshot whose chat store holds the given tool blocks, plus a legacy row. */
function snapshotWith(blocks: ToolCallBlock[], legacy: ToolCallBlock[] = []): ConversationSnapshot {
  const nodes = new Map()
  let seq = 0
  for (const block of blocks) {
    seq += 1
    nodes.set(seq, { kind: 'tool-call', seq, data: { root: block } })
  }
  return {
    chat: { nodes },
    nodes: legacy.map((block, index) => ({ ...block, seq: 100 + index })),
  } as unknown as ConversationSnapshot
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pathsFromText', () => {
  it('extracts plain and quoted file names from a command line', () => {
    expect(pathsFromText('cp a.mp4 b.mp4')).toEqual(['a.mp4', 'b.mp4'])
    expect(pathsFromText("ffmpeg -i 'in.mov' out.mp4")).toEqual(['in.mov', 'out.mp4'])
  })

  it('keeps a flag inline value but drops bare flags', () => {
    expect(pathsFromText('ffmpeg --output=clip.mp4 -vn -y')).toEqual(['clip.mp4'])
  })

  it('resolves absolute, relative, home, and Windows paths', () => {
    expect(pathsFromText('cp /tmp/in.wav out.wav')).toEqual(['/tmp/in.wav', 'out.wav'])
    expect(pathsFromText('ls ./build/report.pdf')).toEqual(['./build/report.pdf'])
    expect(pathsFromText('cp ~/v/a.mkv b.mkv')).toEqual(['~/v/a.mkv', 'b.mkv'])
    expect(pathsFromText('copy C:\\Users\\me\\a.mp4 b.mp4')).toEqual(['C:\\Users\\me\\a.mp4', 'b.mp4'])
  })

  it('strips trailing sentence punctuation and redirection targets', () => {
    expect(pathsFromText("Video written to 'out.mp4'.")).toEqual(['out.mp4'])
    expect(pathsFromText('echo hi > log.txt')).toEqual(['log.txt'])
    expect(pathsFromText('stream 2>&1 | tee a.log')).toEqual(['a.log'])
  })

  it('drops URLs, globs, expansions, bare words, and directories', () => {
    expect(pathsFromText('curl https://example.com/a.mp4 -o out.mp4')).toEqual(['out.mp4'])
    expect(pathsFromText('cp *.png dir/')).toEqual([])
    expect(pathsFromText('echo ${HOME} $(pwd) $VAR')).toEqual([])
    expect(pathsFromText('npm run build')).toEqual([])
    expect(pathsFromText('ls src/')).toEqual([])
  })

  it('drops numbers and dotted tokens that are not file names', () => {
    expect(pathsFromText('wait 1.5 seconds')).toEqual([])
    expect(pathsFromText('connect 127.0.0.1:8080')).toEqual([])
  })
})

describe('collectShellCandidates', () => {
  it('collects candidates from the command title and the captured output', () => {
    const snapshot = snapshotWith([
      terminalResult({ title: 'cp a.mp4 b.mp4', output: 'copied to /dst/b.mp4.' }),
    ])
    expect(collectShellCandidates(snapshot)).toEqual([
      { path: 'a.mp4', base: undefined, time: 1_000 },
      { path: 'b.mp4', base: undefined, time: 1_000 },
      { path: '/dst/b.mp4', base: undefined, time: 1_000 },
    ])
  })

  it('floors the mtime window at the paired call time, not the result time', () => {
    const snapshot = snapshotWith([
      terminalResult({ title: 'ffmpeg out.mkv', callTime: 5_000, time: 9_999 }),
    ])
    expect(collectShellCandidates(snapshot)[0]?.time).toBe(5_000)
  })

  it('uses an absolute terminal cwd as the candidate base but not a relative one', () => {
    const absolute = collectShellCandidates(snapshotWith([
      terminalResult({ title: 'make dist/a.zip', cwd: '/work' }),
    ]))
    expect(absolute[0]?.base).toBe('/work')
    const relative = collectShellCandidates(snapshotWith([
      terminalResult({ title: 'make dist/a.zip', cwd: 'sub' }),
    ]))
    expect(relative[0]?.base).toBeUndefined()
  })

  it('includes a still-running terminal call by its command line alone', () => {
    const snapshot = snapshotWith([{
      callId: 'c1',
      name: 'bash',
      argsRaw: '{}',
      turn: 1,
      step: 1,
      time: 2_000,
      callView: { card: 'terminal', title: 'ffmpeg -i in.avi out.mp4' },
      subCalls: [],
    } as unknown as ToolCallBlock])
    expect(collectShellCandidates(snapshot)).toEqual([
      { path: 'in.avi', base: undefined, time: 2_000 },
      { path: 'out.mp4', base: undefined, time: 2_000 },
    ])
  })

  it('ignores non-terminal tool cards (diff, read, generic)', () => {
    const snapshot = snapshotWith([{
      kind: 'tool-result',
      seq: 2,
      time: 1_100,
      callId: 'c1',
      call: { name: 'write', argsRaw: '{"path":"a.mp4"}' },
      callTime: 1_000,
      content: [],
      isError: false,
      callView: { card: 'diff', title: 'Write a.mp4', diffs: [] },
      resultView: { card: 'generic' },
      subCalls: [],
    } as unknown as ToolCallBlock])
    expect(collectShellCandidates(snapshot)).toEqual([])
  })

  it('scans the legacy top-level tool-result projection too', () => {
    const snapshot = snapshotWith([], [
      terminalResult({ title: 'cp a.mp4 b.mp4' }),
    ])
    const candidates = collectShellCandidates(snapshot)
    expect(candidates.map(candidate => candidate.path)).toEqual(['a.mp4', 'b.mp4'])
  })

  it('tolerates an undefined snapshot', () => {
    expect(collectShellCandidates(undefined)).toEqual([])
  })
})
