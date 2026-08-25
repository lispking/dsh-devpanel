/**
 * Terminate dialog for dsh-devpanel: the conversation.composer.dock entry
 * docked under the composer. A native file-browser style multi-tab terminal:
 * a tab bar (title + shell badge + one tab per PTY session with its own
 * close button, plus a trailing "+" to spawn a new session and "×" to close
 * the panel) above the active terminal. Every tab owns a real PTY driven
 * through ctx.remote.terminalPanel, rendered with xterm.js: output arrives as
 * raw PTY deltas (read poll) and feeds each term.write, keystrokes flow
 * straight into the PTY (term.onData -> remote.write), and the default shell
 * is the system login shell. New sessions spawn in the current session's
 * project directory (or the user home for a fresh session).
 * @module dsh-devpanel/client/TerminateDialog
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SnapshotStore, ISessions, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the 'conversation.composer.dock' SlotMap row (declared by
// ui-conversation) into this program so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConsoleListDirResult,
  ConsoleListResult,
  ConsoleReadFileResult,
  ConsoleReadResult,
  ConsoleSessionView,
  ConsoleSignalResult,
  ConsoleSpawnRequest,
  ConsoleSpawnResult,
  ConsoleTailResult,
  ConsoleTerminalSignal,
  ConsoleTerminateResult,
  ConsoleWriteResult,
} from '../types.ts'
import type { ConsolePanelState } from './console-store.ts'
import { dialogOpenFor } from './console-store.ts'
import { NS } from './locales.ts'

/** Browser-visible face of the terminalPanel Remote namespace. */
export interface TerminalPanelFace {
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

/** Injected business face of the Terminate dialog. */
export interface TerminateDialogInjected {
  /** Shared open state; the dialog renders while dialogOpen is true. */
  store: SnapshotStore<ConsolePanelState>
  /** The mounted terminalPanel Remote namespace. */
  terminalPanel: TerminalPanelFace
  /** The sessions service (project-directory resolution). */
  sessions: ISessions
}

/** Full component props: composer.dock standard kit + locale seat + injected face. */
export type TerminateDialogProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<typeof NS>
  & TerminateDialogInjected

/** Read interval while a session runs. */
const READ_INTERVAL_MS = 150

/** Body attribute the harness theme presenter sets when the dark palette is active. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Detect the harness's current light/dark palette from the DOM signal the
 *  theme presenter owns (body[data-ds-dark-theme]), falling back to the OS
 *  preference before the presenter runs. */
function isDarkTheme(): boolean {
  if (typeof document !== 'undefined' && document.body?.hasAttribute(DARK_ATTRIBUTE)) return true
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) return true
  return false
}

/** One-Dark-style terminal palette (the panel's native dark surface). */
const TERMINAL_THEME_DARK = {
  background: '#1b1b1f',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#1b1b1f',
  selectionBackground: 'rgba(76, 107, 254, 0.32)',
  selectionForeground: '#e4e4e7',
  black: '#3b3b40',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#d19a66',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c5c66',
  brightRed: '#f26d78',
  brightGreen: '#a8e07c',
  brightYellow: '#e2b36e',
  brightBlue: '#6cc1f8',
  brightMagenta: '#d088f0',
  brightCyan: '#62c8d4',
  brightWhite: '#e4e4e7',
}

/** One-Light-style terminal palette for the harness light theme: the same ANSI
 *  hue family re-tuned so colored output stays readable on a light canvas. */
const TERMINAL_THEME_LIGHT = {
  background: '#ffffff',
  foreground: '#1f2937',
  cursor: '#1f2937',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(59, 130, 246, 0.30)',
  selectionForeground: '#1f2937',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#4f525e',
  brightBlack: '#6a737d',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#383a42',
}

/** The xterm theme matching the harness's current palette. */
function terminalTheme(): typeof TERMINAL_THEME_DARK {
  return isDarkTheme() ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT
}

/** Default terminal band height (mirrors the CSS fallback). */
const DEFAULT_TERMINAL_HEIGHT = 240
/** Draggable height range for the terminal band. */
const MIN_TERMINAL_HEIGHT = 96
const MAX_TERMINAL_HEIGHT = 720
/** localStorage key for the persisted band height. */
const HEIGHT_STORAGE_KEY = 'dsh-devpanel.terminalHeight'
/** localStorage key for the persisted tab list (restore after refresh). */
const TABS_STORAGE_KEY = 'dsh-devpanel.savedTabs'

/** localStorage key for ONE chat session's persisted tab list: the tab
 *  descriptors are per session, so a fresh session never respawns another
 *  session's terminals after a refresh. */
function tabsStorageKey(sessionId: string | undefined): string {
  return sessionId === undefined ? TABS_STORAGE_KEY : `${TABS_STORAGE_KEY}.${sessionId}`
}

/** One persisted tab descriptor: the spawn cwd + the tab label. */
interface SavedTabDescriptor {
  cwd: string
  name: string
}

/** Load a session's saved tab list; malformed or absent entries return empty. */
function loadSavedTabs(sessionId: string | undefined): SavedTabDescriptor[] {
  try {
    const raw = window.localStorage.getItem(tabsStorageKey(sessionId))
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is SavedTabDescriptor =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as SavedTabDescriptor).cwd === 'string'
      && typeof (entry as SavedTabDescriptor).name === 'string')
  } catch {
    return []
  }
}

/**
 * Copy a prior xterm's content into a fresh one, preserving ANSI styling.
 * Restoring a session's panel REBUILDS its terminals (a detached xterm
 * element would show the old content but cannot accept input), so the
 * scrollback is replayed into the fresh instance via the official
 * serialization addon — identical colors and layout. Falls back to plain
 * text if serialization fails on an exotic buffer state.
 */
function replayBuffer(from: Terminal, into: Terminal): void {
  try {
    const serializer = new SerializeAddon()
    serializer.activate(from)
    const serialized = serializer.serialize()
    if (serialized.length > 0) {
      // Runs before `into` is opened (adopt opens in the next frame), which
      // the addon recommends to avoid rendering incomplete frames.
      into.write(serialized)
      return
    }
  } catch {
    // Fall through to the plain-text reconstruction below.
  }
  const buffer = from.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)?.translateToString(true)
    if (line !== undefined) lines.push(line)
  }
  if (lines.length > 0) into.write(lines.join('\r\n'))
}

/** localStorage key for user-defined command snippets (the Cmd/Ctrl+K palette). */
const SNIPPETS_STORAGE_KEY = 'dsh-devpanel.snippets'

/** One command snippet: display name + the shell line sent on Enter. */
interface CommandSnippet {
  name: string
  command: string
  /** Built-in defaults cannot be deleted; user entries can. */
  custom: boolean
}

/** Generic starter snippets; users add their own through the palette. */
const DEFAULT_SNIPPETS: readonly CommandSnippet[] = [
  { name: 'git status', command: 'git status', custom: false },
  { name: 'git diff', command: 'git diff', custom: false },
  { name: 'git recent log', command: 'git log --oneline --graph -20', custom: false },
  { name: 'list files', command: 'ls -la', custom: false },
]

/** Load user-defined snippets; malformed or absent storage returns empty. */
function loadCustomSnippets(): CommandSnippet[] {
  try {
    const raw = window.localStorage.getItem(SNIPPETS_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is { name: string; command: string } =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as { name?: unknown }).name === 'string'
      && typeof (entry as { command?: unknown }).command === 'string')
      .map(entry => ({ name: entry.name, command: entry.command, custom: true }))
  } catch {
    return []
  }
}

/** Persist only the user-defined subset (built-ins stay in code). */
function persistCustomSnippets(all: readonly CommandSnippet[]): void {
  try {
    const custom = all.filter(snippet => snippet.custom)
      .map(({ name, command }) => ({ name, command }))
    window.localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(custom))
  } catch {
    // Storage unavailable (private mode): snippets stay for this session only.
  }
}

/** Load the persisted terminal band height, clamped to the valid range. */
function loadTerminalHeight(): number {
  try {
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY)
    if (raw === null) return DEFAULT_TERMINAL_HEIGHT
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_HEIGHT
    return Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, parsed))
  } catch {
    return DEFAULT_TERMINAL_HEIGHT
  }
}

/** Search highlight decorations (match + active match), native-terminal palette. */
const SEARCH_DECORATIONS = {
  matchBackground: '#3a3f4f',
  matchBorder: '#61afef',
  matchOverviewRuler: '#61afef',
  activeMatchBackground: '#61afef',
  activeMatchBorder: '#1b1b1f',
  activeMatchColorOverviewRuler: '#61afef',
}

/** Default tab name for the first session; later ones get "default N". */
const DEFAULT_TAB = 'default'

/**
 * Scan terminal output for OSC sequences the shell emits: `OSC 0/2` sets the
 * window/tab title, `OSC 7` announces the current working directory
 * (`file://host/path`). Both are BEL- or ST-terminated and may be split across
 * PTY chunks, so the caller keeps `tail` pending and prepends it on the next
 * delta. Returns the parsed title/cwd plus the unterminated tail (empty when
 * the input had no dangling escape).
 * @param text - the raw output delta (plus any pending tail).
 * @returns parsed title and cwd, and the tail to hold for the next delta.
 */
function scanOsc(text: string): { title: string | null; cwd: string | null; tail: string } {
  let title: string | null = null
  let cwd: string | null = null
  let tail = ''
  let cursor = 0
  for (;;) {
    const start = text.indexOf('\x1b]', cursor)
    if (start === -1) break
    // Terminator: BEL (\x07) or ST (\x1b\\), whichever comes first.
    const bel = text.indexOf('\x07', start + 2)
    const st = text.indexOf('\x1b\\', start + 2)
    const end = bel === -1 ? st : (st === -1 || bel < st ? bel : st)
    const termLen = end === -1 ? 0 : (end === bel ? 1 : 2)
    if (termLen === 0) {
      // Unterminated at the end of this delta: hold it for the next one.
      tail = text.slice(start)
      break
    }
    const body = text.slice(start + 2, end)
    if ((body.startsWith('0;') || body.startsWith('2;')) && body.length > 2) {
      title = body.slice(2)
    } else if (body.startsWith('7;') && body.length > 2) {
      const target = body.slice(2)
      // file://host/path → drop the host part, keep the absolute path.
      cwd = target.startsWith('file://')
        ? (() => {
            const raw = target.slice('file://'.length).replace(/^[^/]*/, '')
            try { return decodeURIComponent(raw) } catch { return raw }
          })()
        : target
    }
    cursor = end + termLen
  }
  return { title, cwd, tail }
}

/** One live session's UI state: view + live xterm instance + its fit addon. */
interface TerminalSessionUi {
  view: ConsoleSessionView
  terminal: Terminal
  fit: FitAddon
  search: SearchAddon
  /** Whether the xterm instance has been opened into its mount div. */
  opened: boolean
  /** Whether the exit-time final read still needs to drain residual output. */
  pendingFinalRead: boolean
  /** Unterminated OSC tail held for the next delta (title/cwd may split). */
  pendingOsc: string
  /** Working directory announced by the shell (OSC 7), if any. */
  cwd?: string
  /** The working directory this tab was spawned in (restore fallback). */
  spawnCwd?: string
  /** Whether the tab should flash a "completed" highlight: set on process
   *  exit or a BEL byte, cleared when its tab is focused/clicked. */
  notify: boolean
}

/**
 * Per-chat-session terminal panel layouts, kept across remounts. Strict
 * session-scope slots REMOUNT per session (key=sessionId), so component
 * state dies with the instance — the last layout of each session survives
 * here (xterm instances and scrollback included) and re-attaches to fresh
 * mount divs when that session's panel opens again.
 */
const sessionPanels = new Map<string, { tabs: TerminalSessionUi[]; activeId: string | null }>()

/** Compute the next tab label: default, default 2, default 3, … */
function nextTabName(sessions: readonly TerminalSessionUi[]): string {
  let max = 0
  for (const session of sessions) {
    const match = /^default(?:\s+(\d+))?$/.exec(session.view.name ?? '')
    if (match === null) continue
    const n = match[1] === undefined ? 1 : Number(match[1])
    if (n > max) max = n
  }
  return max === 0 ? DEFAULT_TAB : `${DEFAULT_TAB} ${max + 1}`
}

/**
 * Render the Terminate dialog docked under the composer.
 * @param props - standard composer.dock kit (sessionId, useSessions), locale seat, injected face.
 * @returns the dialog while open, null while closed.
 */
export function TerminateDialog({ store, terminalPanel, sessions, sessionId, useSessions, t }: TerminateDialogProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const currentCwd = useSessions((snapshot: SessionListState) => sessionId === undefined
    ? undefined
    : snapshot.byId[sessionId]?.cwd)
  return (
    <TerminateView
      open={dialogOpenFor(state, sessionId)}
      sessionId={sessionId}
      cwd={currentCwd}
      store={store}
      terminalPanel={terminalPanel}
      sessions={sessions}
      t={t}
    />
  )
}

/** Multi-tab terminal body: tab bar + one mount div per session. */
function TerminateView({
  open,
  sessionId,
  cwd,
  store,
  terminalPanel,
  t,
}: {
  open: boolean
  sessionId: string | undefined
  cwd: string | undefined
  store: SnapshotStore<ConsolePanelState>
  terminalPanel: TerminalPanelFace
  sessions: ISessions
  t: TerminateDialogProps['t']
}) {
  const [tabs, setTabs] = useState<TerminalSessionUi[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Inline rename state: the tab id being renamed (or null) + the draft text.
  // A ref mirrors the id so a blur after Escape (unmount) cannot commit.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renamingIdRef = useRef<string | null>(null)
  renamingIdRef.current = renamingId
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  // Search bar state: open flag, term, and the last result counter emitted by
  // the active addon's onDidChangeResults (index + count; -1/0 when no match).
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState({ index: 0, count: 0 })
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Command snippet palette (Cmd/Ctrl+K): open flag + filter, the merged
  // snippet list (built-ins + persisted user entries), the highlighted row,
  // and the add-form drafts. Rows are matched/deleted by object reference.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteFilter, setPaletteFilter] = useState('')
  const [snippetList, setSnippetList] = useState<CommandSnippet[]>(() => [
    ...DEFAULT_SNIPPETS,
    ...loadCustomSnippets(),
  ])
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [addingSnippet, setAddingSnippet] = useState(false)
  const [newSnippetName, setNewSnippetName] = useState('')
  const [newSnippetCommand, setNewSnippetCommand] = useState('')
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  // Latest counter callback for addons created in spawn() (which closes over
  // this ref, not the current render's setter).
  const searchResultsCbRef = useRef<(index: number, count: number) => void>(() => {})
  searchResultsCbRef.current = (index, count) => setSearchResults({ index, count })
  const cwdRef = useRef<string | undefined>(cwd)
  cwdRef.current = cwd
  // Mirror of `open` for async restore guards (a restore landing after the
  // panel closed must not repopulate a hidden dialog).
  const openRef = useRef(open)
  openRef.current = open
  // The chat session whose dialog was last open. Lets the close effect tell
  // an EXPLICIT close (dispose the PTYs) from a session switch (open just
  // went false for the NEW session — keep the previous session's terminals
  // alive so switching back restores them instead of spawning a fresh tab).
  const lastOpenSessionRef = useRef<string | undefined>(undefined)
  // The chat session the currently displayed tabs belong to. The harness
  // reuses this component across sessions (the sessionId prop changes), so
  // the tab state must be swapped on switch — save the previous session's
  // layout to the registry and clear the display for the incoming session.
  const tabsSessionRef = useRef<string | undefined>(undefined)
  // Terminal band height: persisted across reloads; the handle drags it live
  // and commits on pointer-up. A ref mirrors the state for the move handler.
  const [terminalHeight, setTerminalHeight] = useState(loadTerminalHeight)
  const terminalHeightRef = useRef(terminalHeight)
  terminalHeightRef.current = terminalHeight
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)
  // Latest tabs kept for the open effect / poll without re-running on each tick.
  const tabsRef = useRef<TerminalSessionUi[]>([])
  tabsRef.current = tabs
  // Guards racing spawns: only the latest spawn per slot may land.
  const spawnIdRef = useRef(0)
  // Mount div per session id, filled by callback refs below.
  const mountsRef = useRef(new Map<string, HTMLDivElement>())
  // The tab strip (horizontal scroll container), to bring the active tab
  // into view when a new one spawns or the selection changes.
  const tabbarRef = useRef<HTMLDivElement | null>(null)

  // Open one xterm into its session's mount div, or re-attach/re-fit when
  // shown again. A previously opened xterm (restored from a session switch)
  // must NOT be open()ed twice — xterm rejects a second open — so its
  // element (scrollback intact) is moved into the fresh mount instead.
  const openTerminal = (session: TerminalSessionUi): void => {
    const mount = mountsRef.current.get(session.view.id)
    if (mount === undefined) return
    if (!session.opened) {
      session.terminal.open(mount)
      session.opened = true
    } else {
      const element = session.terminal.element
      if (element !== undefined && element.parentElement !== mount) {
        mount.appendChild(element)
      }
    }
    try {
      session.fit.fit()
    } catch {
      // Container not measurable yet: keep the current geometry.
    }
  }

  // Spawn a new PTY session with a fresh xterm instance and a new tab.
  // Build one xterm instance with the panel's addons (fit + search), the
  // native palette, and the copy/paste handlers. Shared by the spawn path and
  // the live-session adoption path (restore after a refresh).
  const createTerminal = (): { terminal: Terminal; fit: FitAddon; search: SearchAddon } => {
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      rightClickSelectsWord: true,
      // SearchAddon's match/active-match highlight decorations (passed to
      // findNext/findPrevious below) are implemented on top of the proposed
      // registerDecoration API — with allowProposedApi:false every findNext
      // THROWS ("You must set the allowProposedApi option to true to use
      // proposed API") and search silently never finds anything. Enable it.
      allowProposedApi: true,
      // Palette follows the harness theme (dark/light); the ANSI 16-color set
      // is tuned per palette so colored output (git, ls, prompts) reads on
      // either canvas.
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    // Search: findNext/findPrevious with highlight decorations; the result
    // counter flows to the shared search bar through the callback ref (this
    // closure predates the current render's state setter, so never capture it).
    const search = new SearchAddon()
    terminal.loadAddon(search)
    search.onDidChangeResults((event) => {
      searchResultsCbRef.current(event.resultIndex, event.resultCount)
    })
    // Copy-on-select: hand the selection to the clipboard like a native
    // terminal (best-effort; browsers may require a user gesture).
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection()
      if (selection !== '') {
        void navigator.clipboard?.writeText(selection).catch(() => {})
      }
    })
    // Paste with Cmd/Ctrl+Shift+V (native-terminal shortcut): the pasted text
    // flows through terminal.paste → onData, so the PTY write needs no id here.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey !== true) return true
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void navigator.clipboard?.readText().then((text) => {
          terminal.paste(text)
        }).catch(() => {})
        return false
      }
      return true
    })
    return { terminal, fit, search }
  }

  // Spawn a new PTY session with a fresh xterm instance and a new tab.
  // `restored` carries the persisted descriptor (cwd + name) when respawning a
  // saved tab; restored spawns are NOT superseded (each must land), while an
  // interactive spawn still supersedes older pending interactive spawns.
  const spawn = (restored?: { cwd: string; name: string }): void => {
    const { terminal, fit, search } = createTerminal()
    const request: ConsoleSpawnRequest = {
      // Empty argv: the host resolves the system login shell ($SHELL).
      argv: [],
      // Empty cwd when the session has no project directory: the host falls
      // back to its own process cwd (the directory `dsh web` was launched
      // from), so a freshly opened panel lands in the project, not $HOME.
      cwd: restored?.cwd ?? cwdRef.current ?? '',
      // Guard degenerate fit results (a 0/negative row count would break the PTY).
      rows: terminal.rows > 0 ? terminal.rows : 24,
      cols: terminal.cols > 0 ? terminal.cols : 80,
      name: restored?.name ?? nextTabName(tabsRef.current),
      // Tag the PTY with its owning chat session so restore() adopts back
      // exactly this session's terminals (and no other session's).
      ...(sessionId === undefined ? {} : { owner: sessionId }),
    }
    const mySpawn = ++spawnIdRef.current
    void terminalPanel.spawn(request).then((result) => {
      if (restored === undefined && mySpawn !== spawnIdRef.current) {
        // A newer spawn superseded this one: drop the orphan terminal AND
        // dispose the server-side PTY it would have attached to.
        terminal.dispose()
        if (result.ok) void terminalPanel.dispose(result.value.id)
        return
      }
      if (!result.ok) {
        terminal.write(`\r\n[dsh-devpanel] spawn failed: ${result.error?.message ?? 'unknown'}\r\n`)
        return
      }
      // Native input path: every keystroke (including Enter as \r) flows into
      // the PTY verbatim — no submit newline conversion.
      terminal.onData((data) => {
        void terminalPanel.write(result.value.id, data, false)
      })
      const session: TerminalSessionUi = {
        view: {
          id: result.value.id,
          pid: result.value.pid,
          ...(request.name === undefined ? {} : { name: request.name }),
          shell: result.value.shell,
          status: { kind: 'running' },
        },
        terminal,
        fit,
        search,
        opened: false,
        pendingFinalRead: false,
        pendingOsc: '',
        spawnCwd: request.cwd,
        notify: false,
      }
      tabsRef.current = [...tabsRef.current, session]
      setTabs(tabsRef.current)
      setActiveId(result.value.id)
      // Open into its mount once the div is rendered (next frame).
      window.requestAnimationFrame(() => openTerminal(session))
    }).catch(() => {
      // Transport reject (abort, codec, network). The terminal was never
      // attached to a tab, so just dispose the orphan xterm and surface the
      // failure to the console without leaking an unhandled rejection.
      terminal.dispose()
    })
  }

  // Adopt live host sessions (they survived a page refresh) into fresh xterm
  // instances. The host keeps each PTY's process and delta cursor, so the new
  // terminals pick up output from here on; spawned descriptors are unknown for
  // adopted sessions (spawnCwd stays undefined).
  const adopt = (views: readonly ConsoleSessionView[], preferredActiveId?: string | null): void => {
    const priorTabs = sessionId === undefined ? undefined : sessionPanels.get(sessionId)?.tabs
    const adopted: TerminalSessionUi[] = views.map(view => {
      const { terminal, fit, search } = createTerminal()
      // Rebuild the scrollback the session left behind: a detached xterm
      // element would show the old content but cannot accept input, so the
      // restored terminal is a fresh xterm with the prior content replayed
      // (ANSI-preserving). The prior tab label is kept too: renames and OSC
      // titles are client-side and never reach the host's session record.
      const prior = priorTabs?.find(tab => tab.view.id === view.id)
      if (prior !== undefined) {
        replayBuffer(prior.terminal, terminal)
      }
      // Native input path: mirror spawn()'s wiring so the restored terminal
      // accepts keystrokes into its live PTY.
      terminal.onData((data) => {
        void terminalPanel.write(view.id, data, false)
      })
      return {
        view: {
          ...view,
          // Prefer the prior tab's label (renames and OSC titles are
          // client-side and never reach the host's session record). The
          // conditional spread keeps `name` optional for the view type.
          ...(prior?.view.name === undefined ? {} : { name: prior.view.name }),
        },
        terminal,
        fit,
        search,
        opened: false,
        pendingFinalRead: false,
        pendingOsc: '',
        notify: false,
      }
    })
    tabsRef.current = adopted
    setTabs(adopted)
    // Restore the session's active tab when it is still among the live set.
    setActiveId(preferredActiveId !== null && preferredActiveId !== undefined
      && views.some(view => view.id === preferredActiveId)
      ? preferredActiveId
      : adopted[0]?.view.id ?? null)
    // Open into their mounts once the divs are rendered (next frame).
    window.requestAnimationFrame(() => {
      for (const session of adopted) openTerminal(session)
    })
  }

  // Publish the active session id into the shared store so the sidebar can
  // write into the same PTY ("open in terminal"). Closing the dialog (open
  // false) clears activeId through the close effect, which lands here too.
  // Keyed per chat session: each session's sidebar talks to its own dialog.
  useEffect(() => {
    if (sessionId !== undefined) store.update(draft => { draft.activeTerminalId[sessionId] = activeId })
  }, [store, sessionId, activeId])

  // Session switch: the harness reuses this component with a changing
  // sessionId prop, so the displayed tabs must be swapped. Save the previous
  // session's layout (its xterms feed the replay on return) and clear the
  // display; restore() below rebuilds the incoming session's panel from its
  // own live PTYs.
  useEffect(() => {
    if (sessionId === undefined) return
    const prev = tabsSessionRef.current
    if (prev !== undefined && prev !== sessionId) {
      if (tabsRef.current.length > 0) {
        sessionPanels.set(prev, { tabs: tabsRef.current, activeId })
      }
      tabsRef.current = []
      setTabs([])
      setActiveId(null)
    }
    tabsSessionRef.current = sessionId
  }, [sessionId])

  // Keep this session's latest layout in the module registry so a later
  // remount (session switch) restores it: the xterm instances survive here
  // with their scrollback and re-attach to fresh mount divs on restore.
  useEffect(() => {
    if (sessionId === undefined || tabs.length === 0) return
    sessionPanels.set(sessionId, { tabs: tabsRef.current, activeId })
  }, [sessionId, tabs, activeId])

  // Open the dialog: restore the previous session layout. Live host sessions
  // (surviving a page refresh) are ADOPTED into fresh xterm instances; a host
  // restart leaves none, so the persisted descriptors are respawned instead;
  // with neither, a fresh default tab spawns.
  const restore = (): void => {
    const myOpen = openRef.current
    const saved = sessionId === undefined ? undefined : sessionPanels.get(sessionId)
    const savedIds = new Set(saved?.tabs.map(tab => tab.view.id) ?? [])
    void terminalPanel.list().then((listed) => {
      if (!openRef.current || myOpen !== openRef.current) return
      const all = listed.ok ? listed.value.sessions : []
      // Adopt this session's own live PTYs: matched by the owner tag (spawned
      // since the owner feature) OR by the session's previously saved tab ids
      // (legacy sessions spawned before the tag existed carry no owner). A
      // session that never used the panel has neither, so it spawns a fresh
      // tab below instead of adopting another session's terminals.
      const live = sessionId === undefined
        ? all
        : all.filter(view => view.owner === sessionId || savedIds.has(view.id))
      if (live.length > 0) {
        adopt(live, saved?.activeId ?? null)
        return
      }
      const descriptors = loadSavedTabs(sessionId)
      if (descriptors.length > 0) {
        for (const tab of descriptors) spawn(tab)
        return
      }
      spawn()
    })
  }
  useEffect(() => {
    if (!open) return
    // Always rebuild the current session's panel from its own live PTYs:
    // restore() adopts them into FRESH xterms (with the prior scrollback
    // replayed). Re-attaching a detached xterm element would show the old
    // content but cannot accept input, and reusing leftover tabs from a
    // previous session would leak them into this one. Keyed on sessionId so
    // a switch into an open panel rebuilds it right after the swap cleared
    // the display.
    restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore is stable for the dialog lifetime.
  }, [open, sessionId])

  // Keep the active tab in view: a newly spawned tab (or one selected from
  // the overflow strip) must not sit scrolled out of the tab bar. Optional
  // call: scrollIntoView is absent in jsdom and some embedded webviews, so
  // this is a progressive enhancement that no-ops where unsupported.
  useEffect(() => {
    if (!open || activeId === null) return
    const activeTab = tabbarRef.current?.querySelector<HTMLElement>('.dsh-devpanel-tab[data-active]')
    activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [open, activeId])

  // Closing the panel (header toggle, not a per-tab close) must end every
  // session: dispose the PTYs, reset the tabs so the next open spawns a
  // fresh default window instead of reviving stale ones, and drop the saved
  // tab list (closing = explicit discard; a page refresh does NOT run this
  // effect, so the saved list survives reloads for the restore path).
  useEffect(() => {
    if (open) {
      lastOpenSessionRef.current = sessionId
      return
    }
    const live = tabsRef.current
    for (const session of live) session.search.clearDecorations()
    setSearchOpen(false)
    setSearchTerm('')
    setSearchResults({ index: 0, count: 0 })
    if (live.length === 0) return
    // A session switch lands here too (the NEW session's dialog is closed),
    // but that is not an explicit close: keep the previous session's PTYs
    // and tab layout alive so switching back restores them instead of
    // spawning a fresh default tab. Only a close by the owning session
    // (the one whose dialog was last open) disposes everything.
    if (sessionId !== lastOpenSessionRef.current) return
    for (const session of live) {
      void terminalPanel.dispose(session.view.id)
    }
    tabsRef.current = []
    setTabs([])
    setActiveId(null)
    // Explicit close discards the session's saved layout too: the next open
    // spawns a fresh default tab instead of reviving stale ones.
    if (sessionId !== undefined) sessionPanels.delete(sessionId)
    try {
      window.localStorage.removeItem(tabsStorageKey(sessionId))
    } catch {
      // Storage unavailable: nothing to clear.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispose is stable for the dialog lifetime.
  }, [open, sessionId, terminalPanel])

  // Persist the current tab layout (spawn cwd + label) whenever it changes, so
  // a page refresh can restore it. Never clears on an empty list — an empty
  // list also occurs on a fresh mount after a reload, and clearing here would
  // defeat the restore path; explicit closes clear via the effect above.
  useEffect(() => {
    if (tabs.length === 0) return
    const descriptors: SavedTabDescriptor[] = tabs.map(session => ({
      cwd: session.spawnCwd ?? '~',
      name: session.view.name ?? session.view.shell ?? 'terminal',
    }))
    try {
      window.localStorage.setItem(tabsStorageKey(sessionId), JSON.stringify(descriptors))
    } catch {
      // Storage unavailable (private mode): restore falls back to a fresh tab.
    }
  }, [tabs, sessionId])

  // Poll EVERY tab's output deltas into its own xterm while it runs.
  useEffect(() => {
    if (!open) return
    // Write one delta into its xterm and run the OSC scan (title/cwd may be
    // split across PTY chunks, so the scan prepends the pending tail and the
    // session keeps whatever tail remains unterminated).
    const applyDelta = (session: TerminalSessionUi, delta: string): void => {
      if (delta === '') return
      session.terminal.write(delta)
      // A BEL byte (form feed, long job done, error beep) flags the tab for a
      // brief "completed" highlight so the user notices output off-screen.
      if (delta.includes('\u0007') && !session.notify) {
        session.notify = true
        setTabs([...tabsRef.current])
      }
      const { title, cwd, tail } = scanOsc(`${session.pendingOsc}${delta}`)
      session.pendingOsc = tail
      if (cwd !== null && cwd !== session.cwd) session.cwd = cwd
      if (title !== null && title !== session.view.name) {
        session.view.name = title
        // The tab label reads view.name: force the tab bar to re-render.
        setTabs([...tabsRef.current])
      }
    }
    const timer = window.setInterval(() => {
      for (const session of tabsRef.current) {
        // Skip sessions that are running AND haven't just exited — the
        // running path below handles them. A session flagged for a final
        // read (it just transitioned to 'exited') still needs one more poll
        // to drain the residual output before it goes quiet.
        if (session.view.status.kind === 'running' && !session.pendingFinalRead) {
          void terminalPanel.read(session.view.id).then((result) => {
            if (!result.ok) return
            applyDelta(session, result.value.delta)
            if (result.value.status.kind !== session.view.status.kind) {
              session.view.status = result.value.status
              // The session just exited — flag the tab and arm the final
              // drain on the next tick.
              if (!session.notify) {
                session.notify = true
                setTabs([...tabsRef.current])
              }
              session.pendingFinalRead = true
            }
          })
        } else if (session.pendingFinalRead) {
          // One last read after exit captures the trailing bytes the host
          // may have emitted between the last poll and the exit transition.
          session.pendingFinalRead = false
          void terminalPanel.read(session.view.id).then((result) => {
            if (result.ok) applyDelta(session, result.value.delta)
          })
        }
      }
    }, READ_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [open, terminalPanel])

  // Re-theme open terminals when the harness flips light/dark: the theme
  // presenter toggles body[data-ds-dark-theme], so watch that attribute and
  // repaint every open xterm with the matching palette.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      const theme = terminalTheme()
      for (const session of tabsRef.current) {
        session.terminal.options = { ...session.terminal.options, theme }
        session.terminal.refresh?.(0, session.terminal.rows - 1)
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
    return () => { observer.disconnect() }
  }, [])

  // ⌘K/⌘F stay reachable while the dialog is open even when focus sits
  // outside it (composer, sidebar, header): the dialog's own onKeyDown only
  // sees events originating inside the dialog. A window listener bridges the
  // gap — but only while open, and only for events whose target is NOT inside
  // the dialog (the dialog-level handler owns those, so they don't double-fire).
  // The listener runs in the CAPTURE phase so Esc wins over the xterm textarea
  // (which stops propagation of keydowns it consumes): with the palette open,
  // Esc closes it no matter where focus sits, even on the terminal inside the
  // dialog. When the palette is closed, Esc is left alone so it still reaches
  // the terminal (vim/less/readline all use it).
  useEffect(() => {
    if (!open) return
    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && paletteOpen) {
        event.preventDefault()
        event.stopPropagation()
        closePalette()
        return
      }
      const target = event.target
      if (target instanceof Element && target.closest('.dsh-devpanel-dialog')) return
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey === true) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        if (paletteOpen) closePalette()
        else openPalette()
      } else if (key === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onWindowKeyDown, true)
    return () => { window.removeEventListener('keydown', onWindowKeyDown, true) }
  }, [open, paletteOpen])

  // Re-fit the active tab's viewport when its mount changes size (the dock
  // band is responsive; the PTY size stays at spawn-time values since the
  // subprocess handle exposes no resize, so only the render layer adapts).
  useEffect(() => {
    if (activeId === null) return
    const session = tabsRef.current.find(candidate => candidate.view.id === activeId)
    if (session === undefined) return
    const mount = mountsRef.current.get(activeId)
    if (mount === undefined) return
    const observer = new ResizeObserver(() => openTerminal(session))
    observer.observe(mount)
    return () => { observer.disconnect() }
  }, [activeId, open])

  // Close one tab: dispose the PTY and drop the session; re-activate a
  // neighbor. Closing the LAST tab closes the whole panel too.
  const closeTab = (id: string): void => {
    void terminalPanel.dispose(id)
    const remaining = tabsRef.current.filter(session => session.view.id !== id)
    tabsRef.current = remaining
    setTabs(remaining)
    if (remaining.length === 0) {
      setActiveId(null)
      // The layout died with the last tab: drop the saved entry so a reopen
      // spawns a fresh default tab instead of reviving it.
      if (sessionId !== undefined) sessionPanels.delete(sessionId)
      if (sessionId !== undefined) store.update(draft => { draft.dialogOpen[sessionId] = false })
      return
    }
    if (activeId === id) {
      const neighbor = remaining[Math.max(0, remaining.length - 1)]
      setActiveId(neighbor?.view.id ?? null)
    }
  }

  // Close the whole panel: dispose every session (fresh start on reopen).
  const closePanel = (): void => {
    for (const session of tabsRef.current) {
      void terminalPanel.dispose(session.view.id)
    }
    tabsRef.current = []
    setTabs([])
    setActiveId(null)
    setRenamingId(null)
    if (sessionId !== undefined) store.update(draft => { draft.dialogOpen[sessionId] = false })
  }

  // Start inline renaming: snapshot the current label as the draft and focus
  // the input once the tab re-renders it (next frame).
  const startRename = (session: TerminalSessionUi): void => {
    setRenamingId(session.view.id)
    setRenameDraft(session.view.name ?? session.view.shell ?? 'terminal')
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }

  // Commit the draft as the tab label; an empty/whitespace draft keeps the
  // current name. Blur-after-Escape is a no-op because the ref was cleared.
  const commitRename = (): void => {
    const id = renamingIdRef.current
    if (id === null) return
    renamingIdRef.current = null
    setRenamingId(null)
    const trimmed = renameDraft.trim()
    if (trimmed === '') return
    const session = tabsRef.current.find(candidate => candidate.view.id === id)
    if (session === undefined) return
    session.view.name = trimmed
    // The tab label reads view.name: force the tab bar to re-render.
    setTabs([...tabsRef.current])
  }

  // Drag the band-height handle: pointer-down records the start, window-level
  // pointermove updates the live height (clamped), pointer-up persists it.
  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragStartRef.current = { y: event.clientY, h: terminalHeightRef.current }
    const onMove = (move: PointerEvent): void => {
      const start = dragStartRef.current
      if (start === null) return
      const next = start.h + (start.y - move.clientY)
      setTerminalHeight(Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, next)))
    }
    const onUp = (): void => {
      dragStartRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(terminalHeightRef.current))
      } catch {
        // Storage unavailable (private mode): the height stays for this session.
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const active = tabs.find(session => session.view.id === activeId)

  // Run the search term against one session's addon: forward (findNext) or
  // backward (findPrevious) with highlight decorations; an empty term clears.
  const runFind = (session: TerminalSessionUi | undefined, term: string, backwards: boolean): void => {
    if (session === undefined) return
    if (term === '') {
      session.search.clearDecorations()
      return
    }
    const options = { decorations: SEARCH_DECORATIONS, incremental: !backwards }
    if (backwards) session.search.findPrevious(term, options)
    else session.search.findNext(term, options)
  }

  // Command snippet palette helpers ------------------------------------------------

  // Open/close the palette; opening focuses the filter input and resets any
  // half-typed filter/add-form drafts.
  const openPalette = (): void => {
    setPaletteOpen(true)
    window.requestAnimationFrame(() => paletteInputRef.current?.focus())
  }
  const closePalette = (): void => {
    setPaletteOpen(false)
    setPaletteFilter('')
    setPaletteIndex(0)
    setAddingSnippet(false)
    setNewSnippetName('')
    setNewSnippetCommand('')
  }

  // Snippets matching the filter (case-insensitive substring over the display
  // name or the command); the highlighted row clamps to the filtered length.
  const filteredSnippets = snippetList.filter((snippet) => {
    const needle = paletteFilter.trim().toLowerCase()
    if (needle === '') return true
    return snippet.name.toLowerCase().includes(needle)
      || snippet.command.toLowerCase().includes(needle)
  })
  const activeSnippetIndex = Math.min(paletteIndex, Math.max(0, filteredSnippets.length - 1))

  // Run one snippet: submit its command line into the ACTIVE session's PTY,
  // then close the palette and hand keyboard focus back to the terminal.
  const sendSnippet = (snippet: CommandSnippet): void => {
    if (active === undefined || active.view.status.kind !== 'running') return
    void terminalPanel.write(active.view.id, snippet.command, true)
    closePalette()
    window.requestAnimationFrame(() => { active.terminal.focus() })
  }

  // Persist a new user snippet from the add-form drafts (both fields required).
  const addSnippet = (): void => {
    const name = newSnippetName.trim()
    const command = newSnippetCommand.trim()
    if (name === '' || command === '') return
    const next = [...snippetList, { name, command, custom: true } satisfies CommandSnippet]
    setSnippetList(next)
    persistCustomSnippets(next)
    setPaletteIndex(next.length - 1)
    setNewSnippetName('')
    setNewSnippetCommand('')
    setAddingSnippet(false)
    setPaletteFilter('')
  }

  // Remove a user-defined snippet (built-ins stay); selection resets to top.
  const deleteSnippet = (snippet: CommandSnippet): void => {
    if (!snippet.custom) return
    const next = snippetList.filter(candidate => candidate !== snippet)
    setSnippetList(next)
    persistCustomSnippets(next)
    setPaletteIndex(0)
  }

  // Cmd/Ctrl+F opens the search bar; Cmd/Ctrl+K opens the snippet palette
  // (terminal textarea events bubble here); Esc closes whichever overlay is
  // open (palette first).
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.altKey !== true) {
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        if (paletteOpen) closePalette()
        else openPalette()
        return
      }
      if (key === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
        return
      }
    }
    if (event.key === 'Escape') {
      if (paletteOpen) {
        event.preventDefault()
        closePalette()
        return
      }
      if (searchOpen) {
        runFind(active, '', false)
        setSearchOpen(false)
      }
    }
  }

  if (!open) return null
  return (
    <div className="dsh-devpanel-dialog" role="dialog" aria-label={t('dialog.title')} onKeyDown={onDialogKeyDown}>
      <div className="dsh-devpanel-tabs" ref={tabbarRef}>
        <span className="dsh-devpanel-title">{t('dialog.title')}</span>
        {active?.view.shell !== undefined && (
          <span className="dsh-devpanel-shell-badge">{active.view.shell}</span>
        )}
        {tabs.map(session => {
          const isRenaming = renamingId === session.view.id
          // While renaming, render the tab as a div so the inline <input> is
          // not nested inside a <button> (invalid DOM nesting); the div keeps
          // the same class for styling and click-to-activate behavior.
          const tabLabel = session.view.name ?? session.view.shell ?? 'terminal'
          return (
            <div
              key={session.view.id}
              className="dsh-devpanel-tab"
              data-active={session.view.id === activeId || undefined}
              data-notify={session.notify || undefined}
              role={isRenaming ? undefined : 'tab'}
              title={session.cwd ?? tabLabel}
              onClick={() => {
                if (isRenaming) return
                setActiveId(session.view.id)
                // A click clears the "completed" flash (BEL/exit seen earlier).
                if (session.notify) {
                  session.notify = false
                  setTabs([...tabsRef.current])
                }
                window.requestAnimationFrame(() => openTerminal(session))
                // Keep search highlights on the newly focused tab.
                if (searchOpen) runFind(session, searchTerm, false)
              }}
              onDoubleClick={() => {
                if (!isRenaming) startRename(session)
              }}
            >
              {isRenaming
                ? (
                  <input
                    ref={renameInputRef}
                    className="dsh-devpanel-tab-rename"
                    value={renameDraft}
                    aria-label={t('dialog.renameTab')}
                    onChange={(event) => { setRenameDraft(event.target.value) }}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      // Stop the dialog-level Cmd+F / Esc handlers from firing.
                      // ⌘/Ctrl combos (⌘F search, ⌘K palette) still bubble up.
                      if (event.metaKey || event.ctrlKey) return
                      event.stopPropagation()
                      if (event.key === 'Enter') commitRename()
                      else if (event.key === 'Escape') {
                        renamingIdRef.current = null
                        setRenamingId(null)
                      }
                    }}
                  />
                )
                : <span className="dsh-devpanel-tab-label">{tabLabel}</span>}
              <span
                className="dsh-devpanel-tab-close"
                role="button"
                aria-label={t('dialog.closeTab')}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(session.view.id)
                }}
              >
                ×
              </span>
            </div>
          )
        })}
        <div className="dsh-devpanel-tabs-actions">
          <button
            type="button"
            className="dsh-devpanel-palette-open"
            aria-label={t('dialog.palette.open')}
            title={t('dialog.palette.open')}
            onClick={() => { if (paletteOpen) closePalette(); else openPalette() }}
          >
            ⌘K
          </button>
          <button
            type="button"
            className="dsh-devpanel-tab-add"
            aria-label={t('dialog.newTab')}
            title={t('dialog.newTab')}
            onClick={() => spawn()}
          >
            +
          </button>
          <button
            type="button"
            className="dsh-devpanel-close"
            aria-label={t('dialog.close')}
            onClick={closePanel}
          >
            ×
          </button>
        </div>
      </div>
      {searchOpen && (
        <div className="dsh-devpanel-search">
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            placeholder={t('dialog.search.placeholder')}
            onChange={(event) => {
              const term = event.target.value
              setSearchTerm(term)
              runFind(active, term, false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runFind(active, searchTerm, event.shiftKey)
              }
            }}
          />
          {searchTerm !== '' && (
            <span className="dsh-devpanel-search-count">
              {searchResults.count > 0 ? `${searchResults.index + 1}/${searchResults.count}` : '0/0'}
            </span>
          )}
          <button
            type="button"
            className="dsh-devpanel-search-nav"
            aria-label={t('dialog.search.prev')}
            title={t('dialog.search.prev')}
            onClick={() => runFind(active, searchTerm, true)}
          >
            ↑
          </button>
          <button
            type="button"
            className="dsh-devpanel-search-nav"
            aria-label={t('dialog.search.next')}
            title={t('dialog.search.next')}
            onClick={() => runFind(active, searchTerm, false)}
          >
            ↓
          </button>
          <button
            type="button"
            className="dsh-devpanel-search-close"
            aria-label={t('dialog.search.close')}
            onClick={() => {
              runFind(active, '', false)
              setSearchOpen(false)
            }}
          >
            ×
          </button>
        </div>
      )}
      {paletteOpen && (
        // stopPropagation keeps clicks inside the palette from bubbling to the
        // dialog root (harmless today, but the overlay must not inherit any
        // future dialog-level click handling).
        <div className="dsh-devpanel-palette" onClick={event => event.stopPropagation()}>
          <input
            ref={paletteInputRef}
            type="text"
            className="dsh-devpanel-palette-filter"
            value={paletteFilter}
            placeholder={t('dialog.palette.placeholder')}
            onChange={(event) => {
              setPaletteFilter(event.target.value)
              setPaletteIndex(0)
            }}
            onKeyDown={(event) => {
              // ⌘/Ctrl combos (⌘F search, ⌘K palette) bubble to the dialog
              // handler; plain keys are handled here, so stop them below.
              if (event.metaKey || event.ctrlKey) return
              event.stopPropagation()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setPaletteIndex(Math.min(activeSnippetIndex + 1, filteredSnippets.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setPaletteIndex(Math.max(activeSnippetIndex - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (filteredSnippets.length > 0) sendSnippet(filteredSnippets[activeSnippetIndex]!)
              } else if (event.key === 'Escape') {
                // Propagation is stopped here, so the dialog-level Esc
                // handler never sees it — close the palette ourselves.
                event.preventDefault()
                closePalette()
              }
            }}
          />
          {addingSnippet ? (
            <div className="dsh-devpanel-palette-add">
              <input
                type="text"
                value={newSnippetName}
                placeholder={t('dialog.palette.name')}
                aria-label={t('dialog.palette.name')}
                onChange={(event) => { setNewSnippetName(event.target.value) }}
                onKeyDown={(event) => {
                  // ⌘/Ctrl combos bubble to the dialog handler (⌘F/⌘K).
                  if (event.metaKey || event.ctrlKey) return
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addSnippet()
                  } else if (event.key === 'Escape') {
                    // Esc always closes the palette, even from the add form:
                    // exiting the form but leaving the overlay open leaves the
                    // next Esc with no focused handler (a real "no response").
                    event.preventDefault()
                    closePalette()
                  }
                }}
              />
              <input
                type="text"
                value={newSnippetCommand}
                placeholder={t('dialog.palette.command')}
                aria-label={t('dialog.palette.command')}
                onChange={(event) => { setNewSnippetCommand(event.target.value) }}
                onKeyDown={(event) => {
                  // ⌘/Ctrl combos bubble to the dialog handler (⌘F/⌘K).
                  if (event.metaKey || event.ctrlKey) return
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addSnippet()
                  } else if (event.key === 'Escape') {
                    // Esc always closes the palette, even from the add form:
                    // exiting the form but leaving the overlay open leaves the
                    // next Esc with no focused handler (a real "no response").
                    event.preventDefault()
                    closePalette()
                  }
                }}
              />
              <button
                type="button"
                className="dsh-devpanel-palette-save"
                disabled={newSnippetName.trim() === '' || newSnippetCommand.trim() === ''}
                onClick={addSnippet}
              >
                {t('dialog.palette.save')}
              </button>
            </div>
          ) : (
            <div className="dsh-devpanel-palette-list" role="listbox" aria-label={t('dialog.palette.open')}>
              {filteredSnippets.length === 0
                ? <div className="dsh-devpanel-palette-empty">{t('dialog.palette.empty')}</div>
                : filteredSnippets.map((snippet, index) => (
                  <div
                    key={`${snippet.custom ? 'u' : 'b'}:${snippet.name}`}
                    className="dsh-devpanel-palette-row"
                    role="option"
                    aria-selected={index === activeSnippetIndex || undefined}
                    data-active={index === activeSnippetIndex || undefined}
                    onMouseMove={() => { setPaletteIndex(index) }}
                    onClick={() => sendSnippet(snippet)}
                  >
                    <span className="dsh-devpanel-palette-name">{snippet.name}</span>
                    <span className="dsh-devpanel-palette-command">{snippet.command}</span>
                    {snippet.custom && (
                      <span
                        className="dsh-devpanel-palette-delete"
                        role="button"
                        aria-label={t('dialog.palette.delete')}
                        title={t('dialog.palette.delete')}
                        onClick={(event) => {
                          event.stopPropagation()
                          deleteSnippet(snippet)
                        }}
                      >
                        ×
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
          <div className="dsh-devpanel-palette-footer">
            <span>{t('dialog.palette.hint')}</span>
            {!addingSnippet && (
              <button type="button" className="dsh-devpanel-palette-new" onClick={() => { setAddingSnippet(true) }}>
                {t('dialog.palette.add')}
              </button>
            )}
          </div>
        </div>
      )}
      <div
        className="dsh-devpanel-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('dialog.resize')}
        title={t('dialog.resize')}
        onPointerDown={onResizePointerDown}
      />
      <div className="dsh-devpanel-terminals" style={{ height: terminalHeight }}>
        {tabs.map(session => (
          <div
            key={session.view.id}
            className="dsh-devpanel-terminal"
            data-active={session.view.id === activeId || undefined}
            ref={(element) => {
              if (element === null) mountsRef.current.delete(session.view.id)
              else mountsRef.current.set(session.view.id, element)
            }}
          />
        ))}
      </div>
    </div>
  )
}
