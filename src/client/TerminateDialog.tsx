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
  ConsoleTerminalSignal,
  ConsoleTerminateResult,
  ConsoleWriteResult,
} from '../types.ts'
import type { ConsolePanelState } from './console-store.ts'
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

/** Default terminal band height (mirrors the CSS fallback). */
const DEFAULT_TERMINAL_HEIGHT = 240
/** Draggable height range for the terminal band. */
const MIN_TERMINAL_HEIGHT = 96
const MAX_TERMINAL_HEIGHT = 720
/** localStorage key for the persisted band height. */
const HEIGHT_STORAGE_KEY = 'dsh-devpanel.terminalHeight'
/** localStorage key for the persisted tab list (restore after refresh). */
const TABS_STORAGE_KEY = 'dsh-devpanel.savedTabs'

/** One persisted tab descriptor: the spawn cwd + the tab label. */
interface SavedTabDescriptor {
  cwd: string
  name: string
}

/** Load the saved tab list; malformed or absent entries return empty. */
function loadSavedTabs(): SavedTabDescriptor[] {
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY)
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
}

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
      open={state.dialogOpen}
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
  cwd,
  store,
  terminalPanel,
  t,
}: {
  open: boolean
  cwd: string | undefined
  store: SnapshotStore<ConsolePanelState>
  terminalPanel: TerminalPanelFace
  sessions: ISessions
  t: TerminateDialogProps['t']
}) {
  const [tabs, setTabs] = useState<TerminalSessionUi[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Search bar state: open flag, term, and the last result counter emitted by
  // the active addon's onDidChangeResults (index + count; -1/0 when no match).
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState({ index: 0, count: 0 })
  const searchInputRef = useRef<HTMLInputElement | null>(null)
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

  // Open one xterm into its session's mount div, or re-fit when shown.
  const openTerminal = (session: TerminalSessionUi): void => {
    const mount = mountsRef.current.get(session.view.id)
    if (mount === undefined) return
    if (!session.opened) {
      session.terminal.open(mount)
      session.opened = true
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
      allowProposedApi: false,
      // Native-terminal palette: near-black canvas, light text, standard ANSI
      // 16-color set so colored output (git, ls, prompts) reads like a real
      // terminal, plus a translucent selection tint.
      theme: {
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
      },
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
      cwd: restored?.cwd ?? (cwdRef.current === undefined || cwdRef.current === '' ? '~' : cwdRef.current),
      // Guard degenerate fit results (a 0/negative row count would break the PTY).
      rows: terminal.rows > 0 ? terminal.rows : 24,
      cols: terminal.cols > 0 ? terminal.cols : 80,
      name: restored?.name ?? nextTabName(tabsRef.current),
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
  const adopt = (views: readonly ConsoleSessionView[]): void => {
    const adopted: TerminalSessionUi[] = views.map(view => {
      const { terminal, fit, search } = createTerminal()
      return {
        view: { ...view },
        terminal,
        fit,
        search,
        opened: false,
        pendingFinalRead: false,
        pendingOsc: '',
      }
    })
    tabsRef.current = adopted
    setTabs(adopted)
    setActiveId(adopted[0]?.view.id ?? null)
    // Open into their mounts once the divs are rendered (next frame).
    window.requestAnimationFrame(() => {
      for (const session of adopted) openTerminal(session)
    })
  }

  // Open the dialog: restore the previous session layout. Live host sessions
  // (surviving a page refresh) are ADOPTED into fresh xterm instances; a host
  // restart leaves none, so the persisted descriptors are respawned instead;
  // with neither, a fresh default tab spawns.
  const restore = (): void => {
    const myOpen = openRef.current
    void terminalPanel.list().then((listed) => {
      if (!openRef.current || myOpen !== openRef.current) return
      const live = listed.ok ? listed.value.sessions : []
      if (live.length > 0) {
        adopt(live)
        return
      }
      const saved = loadSavedTabs()
      if (saved.length > 0) {
        for (const tab of saved) spawn(tab)
        return
      }
      spawn()
    })
  }
  useEffect(() => {
    if (!open) return
    if (tabsRef.current.length === 0) restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore is stable for the dialog lifetime.
  }, [open, terminalPanel])

  // Closing the panel (header toggle, not a per-tab close) must end every
  // session: dispose the PTYs, reset the tabs so the next open spawns a
  // fresh default window instead of reviving stale ones, and drop the saved
  // tab list (closing = explicit discard; a page refresh does NOT run this
  // effect, so the saved list survives reloads for the restore path).
  useEffect(() => {
    if (open) return
    const live = tabsRef.current
    for (const session of live) session.search.clearDecorations()
    setSearchOpen(false)
    setSearchTerm('')
    setSearchResults({ index: 0, count: 0 })
    if (live.length === 0) return
    for (const session of live) {
      void terminalPanel.dispose(session.view.id)
    }
    tabsRef.current = []
    setTabs([])
    setActiveId(null)
    try {
      window.localStorage.removeItem(TABS_STORAGE_KEY)
    } catch {
      // Storage unavailable: nothing to clear.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispose is stable for the dialog lifetime.
  }, [open, terminalPanel])

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
      window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(descriptors))
    } catch {
      // Storage unavailable (private mode): restore falls back to a fresh tab.
    }
  }, [tabs])

  // Poll EVERY tab's output deltas into its own xterm while it runs.
  useEffect(() => {
    if (!open) return
    // Write one delta into its xterm and run the OSC scan (title/cwd may be
    // split across PTY chunks, so the scan prepends the pending tail and the
    // session keeps whatever tail remains unterminated).
    const applyDelta = (session: TerminalSessionUi, delta: string): void => {
      if (delta === '') return
      session.terminal.write(delta)
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
              // The session just exited — arm the final drain on the next tick.
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
      store.update(draft => { draft.dialogOpen = false })
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
    store.update(draft => { draft.dialogOpen = false })
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

  // Cmd/Ctrl+F on the dialog (terminal textarea events bubble here) opens the
  // search bar and focuses its input; Esc inside the input closes it.
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      setSearchOpen(true)
      window.requestAnimationFrame(() => searchInputRef.current?.focus())
      return
    }
    if (event.key === 'Escape' && searchOpen) {
      runFind(active, '', false)
      setSearchOpen(false)
    }
  }

  if (!open) return null
  return (
    <div className="dsh-devpanel-dialog" role="dialog" aria-label={t('dialog.title')} onKeyDown={onDialogKeyDown}>
      <div className="dsh-devpanel-tabs">
        <span className="dsh-devpanel-title">{t('dialog.title')}</span>
        {active?.view.shell !== undefined && (
          <span className="dsh-devpanel-shell-badge">{active.view.shell}</span>
        )}
        {tabs.map(session => (
          <button
            key={session.view.id}
            type="button"
            className="dsh-devpanel-tab"
            data-active={session.view.id === activeId || undefined}
            onClick={() => {
              setActiveId(session.view.id)
              window.requestAnimationFrame(() => openTerminal(session))
              // Keep search highlights on the newly focused tab.
              if (searchOpen) runFind(session, searchTerm, false)
            }}
            title={session.cwd ?? session.view.name ?? session.view.shell}
          >
            <span className="dsh-devpanel-tab-label">{session.view.name ?? session.view.shell ?? 'terminal'}</span>
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
          </button>
        ))}
        <div className="dsh-devpanel-tabs-actions">
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
