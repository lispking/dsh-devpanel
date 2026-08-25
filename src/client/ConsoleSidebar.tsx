/**
 * Right-side file viewer: the details-column entry for dsh-devpanel. Lists the
 * files the current session's AI output touched (from tool-call locations and
 * tool-result paths), and shows the selected file's content in the browser
 * through the terminalPanel readFile Remote. Renders inside the harness
 * layout's right details column (inline, non-floating, squeezes the center
 * column) and is driven by the shared store; while closed it renders nothing
 * but stays mounted (slot entries keep identity).
 * @module dsh-devpanel/client/ConsoleSidebar
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  SnapshotStore, ConversationSnapshot, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeBlock, DiffBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the 'details' SlotMap row (declared by ui-layout) into
// this program so PropsRuntime<'details'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConsoleListDirResult, ConsoleReadFileResult } from '../types.ts'
import type { ConsolePanelState } from './console-store.ts'
import type { TerminalPanelFace } from './TerminateDialog.tsx'
import { NS } from './locales.ts'

/** Injected business face of the sidebar. */
export interface ConsoleSidebarInjected {
  /** Shared open state; the sidebar renders while sidebarOpen is true. */
  store: SnapshotStore<ConsolePanelState>
  /** The mounted terminalPanel Remote namespace (file content reads). */
  terminalPanel: TerminalPanelFace
  /** Close the layout's right details column (geometry lives with ctx.layout). */
  closeDetails: () => void
}

/** Full component props: details standard kit + locale seat + injected face. */
export type ConsoleSidebarProps =
  PropsRuntime<'details'>
  & PropsLocale<typeof NS>
  & ConsoleSidebarInjected

/** One selectable file entry. */
interface FileEntry {
  /** The model-facing path as surfaced in the session. */
  path: string
  /** Display name (the last path segment). */
  name: string
}

/** A diff block's applied hunk (the shape the harness DiffBlock draws). */
interface DiffHunk {
  path: string
  oldText: string | null
  newText: string
}

/** Per-file with-edits: the artifact list plus each file's applied hunks. */
interface SessionArtifacts {
  /** De-duplicated write/edit artifacts in first-seen order. */
  files: FileEntry[]
  /** Every applied hunk, keyed by file path, in first-seen order. */
  history: Map<string, DiffHunk[]>
}

/**
 * Pull the file path out of a tool call's raw JSON args: the write/edit
 * family all carry a `path` (or `file_path`) argument. Returns the first
 * string-valued path found, or null.
 * @param argsRaw - the tool call's raw arguments JSON.
 * @returns the argument path, or null when absent/not a string.
 */
function pathFromArgs(argsRaw: string): string | null {
  if (argsRaw === '') return null
  try {
    const args = JSON.parse(argsRaw) as unknown
    if (typeof args !== 'object' || args === null) return null
    const candidate = (args as Record<string, unknown>)
    for (const key of ['path', 'file_path', 'filePath']) {
      const value = candidate[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return null
  } catch {
    return null
  }
}

/** Tool names that CREATE or MODIFY files — the only artifact producers. */
const WRITE_EDIT_TOOLS = new Set(['write', 'edit'])

/**
 * Extract the file ARTIFACTS a session's nodes produced — the write/edit
 * family only, PLUS the applied hunk history for each file. Reads the internal
 * ChatNodeStore (the authoritative materialized nodes; the legacy top-level
 * `nodes` projection omits tool views), walking every materialized tool-call
 * root and keeping only write/edit signals: pending diff call views, completed
 * diff result views, and the raw-args `path` fallback for write/edit tools
 * without a presenter. Read and search calls are inputs, not products, so they
 * never enter the list. Each diff hunk's `oldText`/`newText` is recorded in
 * first-seen order so the sidebar can render a version diff.
 * @param snapshot - the current conversation snapshot.
 * @returns the de-duplicated artifact list and per-file hunk history.
 */
function collectArtifacts(snapshot: ConversationSnapshot | undefined): SessionArtifacts {
  const seen = new Set<string>()
  const files: FileEntry[] = []
  const history = new Map<string, DiffHunk[]>()
  const record = (hunk: DiffHunk): void => {
    if (hunk.path === '' || seen.has(hunk.path)) return
    seen.add(hunk.path)
    files.push({ path: hunk.path, name: hunk.path.split('/').pop() ?? hunk.path })
    history.set(hunk.path, [hunk])
  }
  const append = (hunk: DiffHunk): void => {
    const list = history.get(hunk.path)
    if (list === undefined) record(hunk)
    else list.push(hunk)
  }
  const absorb = (diffs: DiffHunk[] | undefined): void => {
    if (diffs === undefined) return
    for (const hunk of diffs) {
      if (hunk.oldText === null && hunk.newText === '') {
        // A pure deletion with no added side still names the file.
        record(hunk)
      } else {
        append(hunk)
      }
    }
  }
  const visitBlock = (block: ToolCallBlock): void => {
    // Pending intent: a diff call card names the file(s) it will modify.
    if (block.callView !== null && block.callView.card === 'diff') {
      for (const diff of block.callView.diffs) record({ path: diff.path, oldText: diff.oldText, newText: diff.newText })
    }
    // Raw-args fallback: write/edit tools carry a path argument; only their
    // names count, so a read call's path never leaks into the artifact list.
    const raw = 'argsRaw' in block ? block.argsRaw : block.call?.argsRaw ?? ''
    const name = 'name' in block ? block.name : block.call?.name ?? ''
    if (WRITE_EDIT_TOOLS.has(name)) {
      const fromArgs = pathFromArgs(raw)
      if (fromArgs !== null) record({ path: fromArgs, oldText: null, newText: '' })
    }
    // Completed result: a diff result view names the file(s) it changed.
    if ('resultView' in block && block.resultView !== null && block.resultView.card === 'diff') {
      absorb(block.resultView.diffs as DiffHunk[] | undefined)
    }
    // Child calls owned by this call, in dispatch order.
    for (const child of block.subCalls) visitBlock(child)
  }
  for (const node of snapshot?.chat.nodes.values() ?? []) {
    if (node.kind !== 'tool-call') continue
    // The ChatNodeDataMap row for 'tool-call' lives in ui-conversation's
    // declaration merging; the runtime sees it as unknown, so narrow it here.
    const root = (node as { data: { root: ToolCallBlock } }).data.root
    visitBlock(root)
  }
  // Legacy projection as a final net (pre-chat-definition sessions): the
  // top-level nodes still carry tool-result views when materialized there.
  for (const node of snapshot?.nodes ?? []) {
    if (node.kind !== 'tool-result') continue
    if (node.callView !== null && node.callView.card === 'diff') {
      for (const diff of node.callView.diffs) record({ path: diff.path, oldText: diff.oldText, newText: diff.newText })
    }
    const resultView = node.resultView
    if (resultView !== null && resultView.card === 'diff') {
      absorb(resultView.diffs as DiffHunk[] | undefined)
    }
  }
  return { files, history }
}

/** Single-quote-shell quote a path so spaces/globs stay literal. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Code-language hint for a file path, or undefined for plain text. */
function codeLangOf(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': return 'ts'
    case 'tsx': return 'tsx'
    case 'js': return 'js'
    case 'jsx': return 'jsx'
    case 'json': return 'json'
    case 'css': return 'css'
    case 'html': return 'html'
    case 'py': return 'python'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'yaml': return 'yaml'
    case 'yml': return 'yaml'
    case 'toml': return 'toml'
    case 'sh': return 'bash'
    case 'bash': return 'bash'
    case 'zsh': return 'bash'
    case 'md': return 'markdown'
    case 'mdx': return 'markdown'
    case 'sql': return 'sql'
    case 'java': return 'java'
    case 'c': return 'c'
    case 'cpp': return 'cpp'
    case 'h': return 'cpp'
    case 'rb': return 'ruby'
    case 'php': return 'php'
    case 'xml': return 'xml'
    case 'svg': return 'xml'
    default: return undefined
  }
}

/** Render one read file: images as <img>, markdown rendered, code highlighted, else plain text. */
function FileBody({ result }: { result: ConsoleReadFileResult }) {
  if (result.kind === 'image' && result.dataUrl !== undefined) {
    return (
      <div className="dsh-devpanel-file-image">
        <img src={result.dataUrl} alt={result.path} />
      </div>
    )
  }
  const ext = result.path.split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'mdx') {
    return (
      <div className="dsh-devpanel-file-markdown">
        <MarkdownText text={result.content} fileMentions={undefined} />
      </div>
    )
  }
  const lang = codeLangOf(result.path)
  if (lang !== undefined) {
    return (
      <div className="dsh-devpanel-file-code">
        <CodeBlock code={result.content} lang={lang} />
      </div>
    )
  }
  return <pre className="dsh-devpanel-file-content">{result.content}</pre>
}

/** One lazily-loaded directory listing in the tree cache. */
interface DirCacheEntry {
  state: 'loading' | 'ready' | 'error'
  result?: ConsoleListDirResult
  error?: string
}

/** Tree props shared by every node (driven from the sidebar's state). */
interface DirTreeProps {
  path: string
  name: string
  depth: number
  terminalPanel: TerminalPanelFace
  sessionCwd: string | undefined
  cache: ReadonlyMap<string, DirCacheEntry>
  loadDir: (path: string) => void
  expanded: ReadonlySet<string>
  toggleDir: (path: string) => void
  onFile: (path: string) => void
  onOpenDir: (path: string) => void
  t: ConsoleSidebarProps['t']
}

/** One directory node: a toggle row that lazily lists its children on expand. */
function DirNode({ path, name, depth, terminalPanel, sessionCwd, cache, loadDir, expanded, toggleDir, onFile, onOpenDir, t }: DirTreeProps) {
  const entry = cache.get(path)
  const isOpen = expanded.has(path)
  const children = entry?.state === 'ready' ? entry.result?.entries ?? [] : []
  const childProps = {
    terminalPanel, sessionCwd, cache, loadDir, expanded, toggleDir, onFile, onOpenDir, t,
  }
  // Open body: loading / error / empty / children rows (computed as a plain
  // value so the JSX keeps one flat `{body}` slot instead of nested ternaries).
  let body: React.JSX.Element | null = null
  if (isOpen) {
    if (entry === undefined || entry.state === 'loading') {
      body = <div className="dsh-devpanel-tree-status" style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}>{t('sidebar.browse.loading')}</div>
    } else if (entry.state === 'error') {
      body = <div className="dsh-devpanel-tree-status dsh-devpanel-tree-error" style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}>{entry.error ?? t('sidebar.browse.error')}</div>
    } else if (children.length === 0) {
      body = <div className="dsh-devpanel-tree-status" style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}>{t('sidebar.browse.empty')}</div>
    } else {
      body = (
        <>
          {children.map(child => child.kind === 'dir'
            ? <DirNode key={child.name} {...childProps} path={`${path}/${child.name}`} name={child.name} depth={depth + 1} />
            : (
              <button
                key={child.name}
                type="button"
                className="dsh-devpanel-tree-row dsh-devpanel-tree-file"
                data-depth={depth + 1}
                style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}
                onClick={() => onFile(`${path}/${child.name}`)}
                title={`${path}/${child.name}`}
              >
                <span className="dsh-devpanel-tree-caret" />
                <span className="dsh-devpanel-tree-name">{child.name}</span>
              </button>
            ))}
        </>
      )
    }
  }
  return (
    <div className="dsh-devpanel-tree">
      <div className="dsh-devpanel-tree-row dsh-devpanel-tree-dirrow"
        data-depth={depth}
        style={{ '--dsh-tree-depth': depth } as React.CSSProperties}
        title={path}
      >
        <button
          type="button"
          className="dsh-devpanel-tree-toggle"
          onClick={() => {
            toggleDir(path)
            if (!isOpen && entry === undefined) loadDir(path)
          }}
        >
          <span className="dsh-devpanel-tree-caret">{isOpen ? '▾' : '▸'}</span>
          <span className="dsh-devpanel-tree-name">{name}</span>
        </button>
        <button
          type="button"
          className="dsh-devpanel-tree-open"
          aria-label={t('sidebar.enterDir')}
          title={t('sidebar.enterDir')}
          onClick={() => { onOpenDir(path) }}
        >
          &gt;_
        </button>
      </div>
      {body}
    </div>
  )
}

/**
 * Render the file viewer in the right details column.
 * @param props - details standard kit (useSession), locale seat, injected face.
 * @returns the viewer while open, null while closed.
 */
export function ConsoleSidebar({ store, terminalPanel, closeDetails, useSession, useSessions, sessionId, t }: ConsoleSidebarProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [active, setActive] = useState<string | null>(null)
  const [result, setResult] = useState<ConsoleReadFileResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  // Tail (-f like) log view: a toggle that streams incremental chunks of the
  // currently active file into a monospace pane, aborting the poll when off.
  const [tailOn, setTailOn] = useState(false)
  const [tailText, setTailText] = useState('')
  const [tailOffset, setTailOffset] = useState(0)
  const [tailGone, setTailGone] = useState(false)
  // Diff view: when the active file has applied hunks in this session, a mode
  // toggle renders those before/after pairs (the harness DiffBlock) instead of
  // the raw file body.
  const [diffOn, setDiffOn] = useState(false)
  // Browse mode: the session-artifact list vs a lazily-expanded directory tree
  // rooted at the session's project directory (or the user home).
  const [browse, setBrowse] = useState(false)
  const [cache, setCache] = useState<Map<string, DirCacheEntry>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const snapshot = useSession((s) => s)
  const { files, history } = collectArtifacts(snapshot)
  // The active file's hunk history, or empty when it has no recorded edits.
  const activeHunks = active === null ? undefined : history.get(active)
  // Relative file paths surface against the session's project directory.
  const sessionCwd = useSessions((list) => sessionId === undefined ? undefined : list.byId[sessionId]?.cwd)
  const rootPath = sessionCwd === undefined || sessionCwd === '' ? '~' : sessionCwd

  // Fetch one directory's listing into the cache (idempotent; the node shows a
  // loading/error state from the cache entry while it settles).
  const loadDir = (path: string): void => {
    if (cache.has(path)) return
    setCache(prev => new Map(prev).set(path, { state: 'loading' }))
    void terminalPanel.listDir(path, sessionCwd).then((res) => {
      setCache(prev => new Map(prev).set(path, res.ok
        ? { state: 'ready', result: res.value }
        : { state: 'error', error: res.error?.message }))
    })
  }
  const toggleDir = (path: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const openFile = (path: string): void => { setActive(path) }

  // Write "cd <dir> && cat <file>" into the terminal tab the dialog currently
  // shows (the shared store's activeTerminalId), so the AI's output file can
  // be inspected inside the real PTY. With no terminal open, just open the
  // dialog so the user can start one (spawn is async; a later click writes).
  const openInTerminal = (): void => {
    if (result === null) return
    const activeId = state.activeTerminalId
    if (activeId === null) {
      store.update(draft => { draft.dialogOpen = true })
      return
    }
    const path = result.path
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const dir = slash <= 0 ? '.' : path.slice(0, slash)
    const base = slash <= 0 ? path : path.slice(slash + 1)
    void terminalPanel.write(activeId, `cd ${shellQuote(dir)} && cat ${shellQuote(base)}`, true)
  }

  // "cd <dir>" into the terminal tab the dialog currently shows. With no
  // terminal open, just open the dialog (spawn is async; a later click lands).
  const enterDir = (path: string): void => {
    const target = path === '~' ? '~' : path
    const activeId = state.activeTerminalId
    if (activeId === null) {
      store.update(draft => { draft.dialogOpen = true })
      return
    }
    void terminalPanel.write(activeId, `cd ${shellQuote(target)}`, true)
    window.requestAnimationFrame(() => { void store.subscribe })
  }

  // Poll the active file's tail (-f like) while the log view is on: each tick
  // reads only the bytes appended since the last offset, appends them to the
  // pane, and stops on a vanished file or when the mode / selection changes.
  useEffect(() => {
    if (!state.sidebarOpen || !tailOn || active === null) {
      if (!tailOn) setTailGone(false)
      return
    }
    const controller = new AbortController()
    let offset = tailOffset
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (cancelled) return
      const res = await terminalPanel.tail(active, sessionCwd, offset, controller.signal)
      if (cancelled || !res.ok) return
      setTailText(prev => prev + res.value.delta)
      offset = res.value.offset
      if (res.value.gone) {
        setTailGone(true)
        return
      }
      setTailOffset(offset)
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 1500)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [state.sidebarOpen, tailOn, active, sessionCwd, terminalPanel])

  // Read the active file's content through the Remote; abort a stale read when
  // the selection changes or the sidebar closes.
  useEffect(() => {
    if (!state.sidebarOpen || active === null) {
      setResult(null)
      setError(null)
      return
    }
    const controller = new AbortController()
    setResult(null)
    setError(null)
    void terminalPanel.readFile(active, sessionCwd, controller.signal).then((res) => {
      if (res.ok) setResult(res.value)
      else setError(res.error?.message ?? t('sidebar.readError'))
    }, () => {
      setError(t('sidebar.readError'))
    })
    return () => { controller.abort() }
  }, [state.sidebarOpen, active, sessionCwd, terminalPanel, t])

  if (!state.sidebarOpen) return null
  const treeProps = {
    terminalPanel, sessionCwd, cache, loadDir, expanded, toggleDir,
    onFile: openFile, onOpenDir: enterDir, t,
  }
  return (
    <>
      <div className="dsh-devpanel-sidebar" role="region" aria-label={t('sidebar.title')}>
        <div className="dsh-devpanel-sidebar-header">
          <span className="dsh-devpanel-sidebar-title">{t('sidebar.title')}</span>
          <div className="dsh-devpanel-sidebar-modes" role="tablist" aria-label={t('sidebar.modes.aria')}>
            <button
              type="button"
              role="tab"
              aria-selected={!browse}
              data-active={!browse || undefined}
              onClick={() => { setBrowse(false) }}
            >
              {t('sidebar.modes.files')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={browse}
              data-active={browse || undefined}
              onClick={() => { setBrowse(true) }}
            >
              {t('sidebar.modes.browse')}
            </button>
          </div>
          <button
            type="button"
            className="dsh-devpanel-close"
            aria-label={t('sidebar.close')}
            onClick={() => {
              store.update(draft => { draft.sidebarOpen = false })
              closeDetails()
            }}
          >
            ×
          </button>
        </div>
      <div className="dsh-devpanel-files">
        {browse
          ? (
            <DirNode
              {...treeProps}
              path={rootPath}
              name={rootPath}
              depth={0}
            />
          )
          : files.length === 0
            ? <div className="dsh-devpanel-empty">{t('sidebar.empty')}</div>
            : files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="dsh-devpanel-file"
                data-active={file.path === active || undefined}
                onClick={() => { setActive(file.path) }}
                title={file.path}
              >
                {file.name}
              </button>
            ))}
      </div>
      <div className="dsh-devpanel-file-view">
        {error !== null
          ? <div className="dsh-devpanel-empty">{error}</div>
          : result === null
            ? <div className="dsh-devpanel-empty">{t('sidebar.select')}</div>
            : (
              <>
                <div className="dsh-devpanel-file-path">
                  <span className="dsh-devpanel-file-path-text">{result.path}</span>
                  <button
                    type="button"
                    className="dsh-devpanel-file-terminal"
                    aria-label={t('sidebar.openInTerminal')}
                    title={t('sidebar.openInTerminal')}
                    onClick={openInTerminal}
                  >
                    &gt;_
                  </button>
                  {activeHunks !== undefined && activeHunks.length > 0 && (
                    <button
                      type="button"
                      className="dsh-devpanel-file-diff"
                      aria-pressed={diffOn || undefined}
                      data-active={diffOn || undefined}
                      aria-label={t('sidebar.diff')}
                      title={t('sidebar.diff')}
                      onClick={() => { setDiffOn(prev => !prev) }}
                    >
                      {t('sidebar.diffLabel')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="dsh-devpanel-file-tail"
                    aria-pressed={tailOn || undefined}
                    data-active={tailOn || undefined}
                    aria-label={t('sidebar.tail')}
                    title={t('sidebar.tail')}
                    onClick={() => {
                      // Toggling on re-streams from the top of this file.
                      setTailText('')
                      setTailOffset(0)
                      setTailGone(false)
                      setTailOn(prev => !prev)
                    }}
                  >
                    {t('sidebar.tailLabel')}
                  </button>
                  <button
                    type="button"
                    className="dsh-devpanel-file-maximize"
                    aria-label={t('sidebar.maximize')}
                    title={t('sidebar.maximize')}
                    onClick={() => { setMaximized(true) }}
                  >
                    ⛶
                  </button>
                </div>
                {tailOn
                  ? (
                    <div className="dsh-devpanel-tail" role="log" aria-live="polite">
                      <div className="dsh-devpanel-tail-content">
                        {tailGone ? <span className="dsh-devpanel-tail-gone">{t('sidebar.tailGone')}</span> : null}
                        {tailText}
                      </div>
                    </div>
                  )
                  : diffOn && activeHunks !== undefined && activeHunks.length > 0
                    ? (
                      <div className="dsh-devpanel-file-history">
                        <DiffBlock diffs={activeHunks} />
                      </div>
                    )
                    : <FileBody result={result} />}
              </>
            )}
      </div>
    </div>
    {maximized && result !== null && (
      <div className="dsh-devpanel-file-fullscreen" role="dialog" aria-label={result.path}>
        <div className="dsh-devpanel-file-fullscreen-header">
          <span className="dsh-devpanel-file-path-text">{result.path}</span>
          <button
            type="button"
            className="dsh-devpanel-close"
            aria-label={t('sidebar.close')}
            onClick={() => { setMaximized(false) }}
          >
            ×
          </button>
        </div>
        <div className="dsh-devpanel-file-fullscreen-body">
          <FileBody result={result} />
        </div>
      </div>
    )}
    </>
  )
}
