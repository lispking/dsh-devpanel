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
import { collectShellCandidates, commandWritePolicy, pathsFromText, writeTargetsFrom } from '../src/client/ConsoleSidebar.tsx'

// The fixtures below model the harness node vocabulary dsh-v0.1.2-alpha.4+
// materializes (chat-nodes / conversation records): a settled shell tool call
// is a `tool-result` block whose `call` head carries `name` + the raw model
// arguments (the bash/pwsh tools take one required `command`), whose `content`
// holds the model-facing captured output as text blocks, and whose `callTime`
// is the paired tool/call time. There are NO callView/resultView presentation
// fields on nodes anymore — those were render hints of the legacy runtime.

/** A settled `tool-result` root for a bash/pwsh call with the given command. */
function settledShell(options: {
  command: string
  output?: string
  callTime?: number
  time?: number
  cwd?: string
  name?: string
  subCalls?: ToolCallBlock[]
}): ToolCallBlock {
  const args: Record<string, unknown> = { command: options.command }
  if (options.cwd !== undefined) args.cwd = options.cwd
  return {
    kind: 'tool-result',
    seq: 2,
    time: options.time ?? 1_100,
    callId: 'c1',
    call: { name: options.name ?? 'bash', argsRaw: JSON.stringify(args) },
    callTime: options.callTime ?? 1_000,
    content: options.output === undefined ? [] : [{ type: 'text', text: options.output }],
    isError: false,
    subCalls: options.subCalls ?? [],
  }
}

/** A still-running shell call: only the call head exists, no result yet. */
function runningShell(options: {
  command: string
  time?: number
  name?: string
}): ToolCallBlock {
  return {
    callId: 'c1',
    name: options.name ?? 'bash',
    argsRaw: JSON.stringify({ command: options.command }),
    turn: 1,
    step: 1,
    time: options.time ?? 2_000,
    subCalls: [],
  }
}

/** A settled write/edit-family block (not a shell tool). */
function settledWrite(options: { args: Record<string, unknown>; output?: string }): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 1_100,
    callId: 'w1',
    call: { name: 'write', argsRaw: JSON.stringify(options.args) },
    callTime: 1_000,
    content: options.output === undefined ? [] : [{ type: 'text', text: options.output }],
    isError: false,
    subCalls: [],
  }
}

/** A snapshot whose chat store holds the given roots, plus legacy rows. */
function snapshotWith(roots: ToolCallBlock[], legacy: ToolCallBlock[] = []): ChatSnapshot {
  const rows = roots.map((root, index) => ({
    kind: 'tool-call' as const,
    seq: index + 1,
    data: { root },
  }))
  return {
    nodes: { values: () => rows },
    legacy: {
      nodes: legacy,
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: null,
      runningCalls: [],
    },
  } as unknown as ChatSnapshot
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
  it('collects candidates from the settled command argument and the captured output', () => {
    const snapshot = snapshotWith([
      settledShell({ command: 'cp a.mp4 b.mp4', output: 'copied to /dst/b.mp4.' }),
    ])
    expect(collectShellCandidates(snapshot)).toEqual([
      { path: 'a.mp4', base: undefined, time: 1_000, end: 1_100 },
      { path: 'b.mp4', base: undefined, time: 1_000, end: 1_100 },
      { path: '/dst/b.mp4', base: undefined, time: 1_000, end: 1_100 },
    ])
  })

  it('floors the mtime window at the paired call time, not the result time', () => {
    const snapshot = snapshotWith([
      settledShell({ command: 'ffmpeg out.mkv', callTime: 5_000, time: 9_999 }),
    ])
    expect(collectShellCandidates(snapshot)[0]?.time).toBe(5_000)
  })

  it('uses an absolute args cwd as the candidate base but not a relative one', () => {
    const absolute = collectShellCandidates(snapshotWith([
      settledShell({ command: 'make dist/a.zip', cwd: '/work' }),
    ]))
    expect(absolute[0]?.base).toBe('/work')
    const relative = collectShellCandidates(snapshotWith([
      settledShell({ command: 'make dist/a.zip', cwd: 'sub' }),
    ]))
    expect(relative[0]?.base).toBeUndefined()
  })

  it('includes a still-running shell call by its command line alone', () => {
    const snapshot = snapshotWith([
      runningShell({ command: 'ffmpeg -i in.avi out.mp4' }),
    ])
    expect(collectShellCandidates(snapshot)).toEqual([
      { path: 'in.avi', base: undefined, time: 2_000 },
      { path: 'out.mp4', base: undefined, time: 2_000 },
    ])
  })

  it('ignores non-shell tools even when their result names a file', () => {
    const snapshot = snapshotWith([
      settledWrite({ args: { path: 'a.mp4' }, output: 'wrote /tmp/a.mp4.' }),
    ])
    expect(collectShellCandidates(snapshot)).toEqual([])
  })

  it('collects candidates from a shell sub-call nested under a non-shell root', () => {
    const root = {
      ...settledWrite({ args: { path: 'note.md' }, output: 'updated note.md.' }),
      subCalls: [runningShell({ command: 'ffmpeg -i in.avi out.mp4' })],
    }
    const snapshot = snapshotWith([root])
    expect(collectShellCandidates(snapshot)).toEqual([
      { path: 'in.avi', base: undefined, time: 2_000 },
      { path: 'out.mp4', base: undefined, time: 2_000 },
    ])
  })

  it('scans the legacy projection rows the node store does not cover', () => {
    const snapshot = snapshotWith([], [
      settledShell({ command: 'cp a.mp4 b.mp4' }),
    ])
    const candidates = collectShellCandidates(snapshot)
    expect(candidates.map(candidate => candidate.path)).toEqual(['a.mp4', 'b.mp4'])
  })

  it('visits a root once when it appears both in the store and the projection', () => {
    const root = settledShell({ command: 'cp a.mp4 b.mp4' })
    const snapshot = snapshotWith([root], [root])
    const candidates = collectShellCandidates(snapshot)
    expect(candidates.map(candidate => candidate.path)).toEqual(['a.mp4', 'b.mp4'])
  })

  it('tolerates an undefined snapshot', () => {
    expect(collectShellCandidates(undefined)).toEqual([])
  })
})

describe('commandWritePolicy', () => {
  it('classifies pure readers as non-producers', () => {
    expect(commandWritePolicy('cat a.log')).toBe('none')
    expect(commandWritePolicy('head -n 5 out.txt')).toBe('none')
    expect(commandWritePolicy('tail -f app.log')).toBe('none')
    expect(commandWritePolicy('grep -o pat f.txt')).toBe('none')
    expect(commandWritePolicy('ls src/')).toBe('none')
    expect(commandWritePolicy('echo hi')).toBe('none')
    expect(commandWritePolicy('Get-Content x.txt')).toBe('none')
  })

  it('classifies a reader with a write side as targets-only', () => {
    expect(commandWritePolicy('cat a.txt b.txt > out.txt')).toBe('targets')
    expect(commandWritePolicy('tail -f x.log >> y.log')).toBe('targets')
    expect(commandWritePolicy('echo hi | tee a.log')).toBe('targets')
  })

  it('classifies in-place writers and producers as full scans', () => {
    expect(commandWritePolicy('sed -i s/a/b/ f.txt')).toBe('all')
    expect(commandWritePolicy('cp a.mp4 b.mp4')).toBe('all')
    expect(commandWritePolicy('ffmpeg -i in.avi out.mp4')).toBe('all')
    expect(commandWritePolicy('unzip a.zip -d dist/')).toBe('all')
    expect(commandWritePolicy('python gen.py')).toBe('all')
  })

  it('looks past cd chains and wrappers to find the reader', () => {
    expect(commandWritePolicy('cd sub && cat a.log')).toBe('none')
    expect(commandWritePolicy('sudo cat a.log')).toBe('none')
    expect(commandWritePolicy('cd sub && cat a.log > out.log')).toBe('targets')
  })
})

describe('writeTargetsFrom', () => {
  it('keeps only the redirection targets, not the read sources', () => {
    expect(writeTargetsFrom('cat a.txt b.txt > out.txt')).toEqual(['out.txt'])
    expect(writeTargetsFrom('cat src.log >glued.log')).toEqual(['glued.log'])
    expect(writeTargetsFrom('tail -f x.log 2>&1 | tee both.log')).toEqual(['both.log'])
  })

  it('ignores missing or non-file targets', () => {
    expect(writeTargetsFrom('cat a.txt >')).toEqual([])
    expect(writeTargetsFrom('cat a.txt b.txt')).toEqual([])
    expect(writeTargetsFrom('cp a.txt b.txt')).toEqual([])
  })
})

describe('collectShellCandidates read/write policy', () => {
  it('drops a pure reader even when its output names fresh-looking files', () => {
    const snapshot = snapshotWith([
      settledShell({ command: 'cat ~/.dsh/todo.json', output: 'Updated todo list: 5 pending, 1 in progress.' }),
    ])
    expect(collectShellCandidates(snapshot)).toEqual([])
  })

  it('keeps only the write target of a reader with a redirection', () => {
    const snapshot = snapshotWith([
      settledShell({ command: 'cat a.log b.log > combined.txt', output: 'Updated todo list.' }),
    ])
    expect(collectShellCandidates(snapshot)).toEqual([
      { path: 'combined.txt', base: undefined, time: 1_000, end: 1_100 },
    ])
  })

  it('caps the mtime window at the settled result time', () => {
    const settled = snapshotWith([settledShell({ command: 'cp a.mp4 b.mp4', callTime: 1_000, time: 5_000 })])
    expect(collectShellCandidates(settled)[0]).toMatchObject({ time: 1_000, end: 5_000 })
    const running = snapshotWith([runningShell({ command: 'cp a.mp4 b.mp4' })])
    expect(collectShellCandidates(running)[0]).not.toHaveProperty('end')
  })
})
