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
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the 'details' SlotMap row (declared by ui-layout) into
// this program so PropsRuntime<'details'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConsoleReadFileResult } from '../types.ts'
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
 * family only. Reads the internal ChatNodeStore (the authoritative materialized
 * nodes; the legacy top-level `nodes` projection omits tool views), walking
 * every materialized tool-call root and keeping only write/edit signals:
 * pending diff call views, completed diff result views, and the raw-args
 * `path` fallback for write/edit tools without a presenter. Read and search
 * calls are inputs, not products, so they never enter the list.
 * De-duplicates entries in first-seen order.
 * @param snapshot - the current conversation snapshot.
 * @returns de-duplicated file entries in first-seen order.
 */
function collectFiles(snapshot: ConversationSnapshot | undefined): FileEntry[] {
  const seen = new Set<string>()
  const entries: FileEntry[] = []
  const push = (path: string): void => {
    if (path === '' || seen.has(path)) return
    seen.add(path)
    entries.push({ path, name: path.split('/').pop() ?? path })
  }
  const visitBlock = (block: ToolCallBlock): void => {
    // Pending intent: a diff call card names the file(s) it will modify.
    if (block.callView !== null && block.callView.card === 'diff') {
      for (const diff of block.callView.diffs) push(diff.path)
    }
    // Raw-args fallback: write/edit tools carry a path argument; only their
    // names count, so a read call's path never leaks into the artifact list.
    const raw = 'argsRaw' in block ? block.argsRaw : block.call?.argsRaw ?? ''
    const name = 'name' in block ? block.name : block.call?.name ?? ''
    if (WRITE_EDIT_TOOLS.has(name)) {
      const fromArgs = pathFromArgs(raw)
      if (fromArgs !== null) push(fromArgs)
    }
    // Completed result: a diff result view names the file(s) it changed.
    if ('resultView' in block && block.resultView !== null && block.resultView.card === 'diff') {
      for (const diff of block.resultView.diffs) push(diff.path)
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
      for (const diff of node.callView.diffs) push(diff.path)
    }
    const resultView = node.resultView
    if (resultView !== null && resultView.card === 'diff') {
      for (const diff of resultView.diffs) push(diff.path)
    }
  }
  return entries
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
      <div className="dsh-toolkit-file-image">
        <img src={result.dataUrl} alt={result.path} />
      </div>
    )
  }
  const ext = result.path.split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'mdx') {
    return (
      <div className="dsh-toolkit-file-markdown">
        <MarkdownText text={result.content} fileMentions={undefined} />
      </div>
    )
  }
  const lang = codeLangOf(result.path)
  if (lang !== undefined) {
    return (
      <div className="dsh-toolkit-file-code">
        <CodeBlock code={result.content} lang={lang} />
      </div>
    )
  }
  return <pre className="dsh-toolkit-file-content">{result.content}</pre>
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

  const snapshot = useSession((s) => s)
  const files = collectFiles(snapshot)
  // Relative file paths surface against the session's project directory.
  const sessionCwd = useSessions((list) => sessionId === undefined ? undefined : list.byId[sessionId]?.cwd)

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
  return (
    <>
      <div className="dsh-toolkit-sidebar" role="region" aria-label={t('sidebar.title')}>
        <div className="dsh-toolkit-sidebar-header">
          <span className="dsh-toolkit-sidebar-title">{t('sidebar.title')}</span>
          <button
            type="button"
            className="dsh-toolkit-close"
            aria-label={t('sidebar.close')}
            onClick={() => {
              store.update(draft => { draft.sidebarOpen = false })
              closeDetails()
            }}
          >
            ×
          </button>
        </div>
      {files.length === 0
        ? <div className="dsh-toolkit-empty">{t('sidebar.empty')}</div>
        : (
          <>
            <div className="dsh-toolkit-files">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="dsh-toolkit-file"
                  data-active={file.path === active || undefined}
                  onClick={() => { setActive(file.path) }}
                  title={file.path}
                >
                  {file.name}
                </button>
              ))}
            </div>
            <div className="dsh-toolkit-file-view">
              {error !== null
                ? <div className="dsh-toolkit-empty">{error}</div>
                : result === null
                  ? <div className="dsh-toolkit-empty">{t('sidebar.select')}</div>
                  : (
                    <>
                      <div className="dsh-toolkit-file-path">
                        <span className="dsh-toolkit-file-path-text">{result.path}</span>
                        <button
                          type="button"
                          className="dsh-toolkit-file-maximize"
                          aria-label={t('sidebar.maximize')}
                          title={t('sidebar.maximize')}
                          onClick={() => { setMaximized(true) }}
                        >
                          ⛶
                        </button>
                      </div>
                      <FileBody result={result} />
                    </>
                  )}
            </div>
          </>
        )}
    </div>
    {maximized && result !== null && (
      <div className="dsh-toolkit-file-fullscreen" role="dialog" aria-label={result.path}>
        <div className="dsh-toolkit-file-fullscreen-header">
          <span className="dsh-toolkit-file-path-text">{result.path}</span>
          <button
            type="button"
            className="dsh-toolkit-close"
            aria-label={t('sidebar.close')}
            onClick={() => { setMaximized(false) }}
          >
            ×
          </button>
        </div>
        <div className="dsh-toolkit-file-fullscreen-body">
          <FileBody result={result} />
        </div>
      </div>
    )}
    </>
  )
}
