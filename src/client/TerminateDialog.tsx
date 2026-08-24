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
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SnapshotStore, ISessions, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the 'conversation.composer.dock' SlotMap row (declared by
// ui-conversation) into this program so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
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

/** Default tab name for the first session; later ones get "default N". */
const DEFAULT_TAB = 'default'

/** One live session's UI state: view + live xterm instance + its fit addon. */
interface TerminalSessionUi {
  view: ConsoleSessionView
  terminal: Terminal
  fit: FitAddon
  /** Whether the xterm instance has been opened into its mount div. */
  opened: boolean
  /** Whether the exit-time final read still needs to drain residual output. */
  pendingFinalRead: boolean
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
  const cwdRef = useRef<string | undefined>(cwd)
  cwdRef.current = cwd
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
  const spawn = (): void => {
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
    const request: ConsoleSpawnRequest = {
      // Empty argv: the host resolves the system login shell ($SHELL).
      argv: [],
      cwd: cwdRef.current === undefined || cwdRef.current === '' ? '~' : cwdRef.current,
      // Guard degenerate fit results (a 0/negative row count would break the PTY).
      rows: terminal.rows > 0 ? terminal.rows : 24,
      cols: terminal.cols > 0 ? terminal.cols : 80,
      name: nextTabName(tabsRef.current),
    }
    const mySpawn = ++spawnIdRef.current
    void terminalPanel.spawn(request).then((result) => {
      if (mySpawn !== spawnIdRef.current) {
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
        opened: false,
        pendingFinalRead: false,
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

  // Open the dialog: start with one fresh tab when no session is running.
  useEffect(() => {
    if (!open) return
    if (tabsRef.current.length === 0) spawn()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spawn is stable for the dialog lifetime.
  }, [open, terminalPanel])

  // Closing the panel (header toggle, not a per-tab close) must end every
  // session: dispose the PTYs and reset the tabs so the next open spawns a
  // fresh default window instead of reviving stale ones.
  useEffect(() => {
    if (open) return
    const live = tabsRef.current
    if (live.length === 0) return
    for (const session of live) {
      void terminalPanel.dispose(session.view.id)
    }
    tabsRef.current = []
    setTabs([])
    setActiveId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispose is stable for the dialog lifetime.
  }, [open, terminalPanel])

  // Poll EVERY tab's output deltas into its own xterm while it runs.
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => {
      for (const session of tabsRef.current) {
        // Skip sessions that are running AND haven't just exited — the
        // running path below handles them. A session flagged for a final
        // read (it just transitioned to 'exited') still needs one more poll
        // to drain the residual output before it goes quiet.
        if (session.view.status.kind === 'running' && !session.pendingFinalRead) {
          void terminalPanel.read(session.view.id).then((result) => {
            if (!result.ok) return
            if (result.value.delta !== '') {
              session.terminal.write(result.value.delta)
            }
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
            if (result.ok && result.value.delta !== '') {
              session.terminal.write(result.value.delta)
            }
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

  const active = tabs.find(session => session.view.id === activeId)

  if (!open) return null
  return (
    <div className="dsh-toolkit-dialog" role="dialog" aria-label={t('dialog.title')}>
      <div className="dsh-toolkit-tabs">
        <span className="dsh-toolkit-title">{t('dialog.title')}</span>
        {active?.view.shell !== undefined && (
          <span className="dsh-toolkit-shell-badge">{active.view.shell}</span>
        )}
        {tabs.map(session => (
          <button
            key={session.view.id}
            type="button"
            className="dsh-toolkit-tab"
            data-active={session.view.id === activeId || undefined}
            onClick={() => {
              setActiveId(session.view.id)
              window.requestAnimationFrame(() => openTerminal(session))
            }}
          >
            <span className="dsh-toolkit-tab-label">{session.view.name ?? session.view.shell ?? 'terminal'}</span>
            <span
              className="dsh-toolkit-tab-close"
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
        <div className="dsh-toolkit-tabs-actions">
          <button
            type="button"
            className="dsh-toolkit-tab-add"
            aria-label={t('dialog.newTab')}
            title={t('dialog.newTab')}
            onClick={spawn}
          >
            +
          </button>
          <button
            type="button"
            className="dsh-toolkit-close"
            aria-label={t('dialog.close')}
            onClick={closePanel}
          >
            ×
          </button>
        </div>
      </div>
      <div className="dsh-toolkit-terminals">
        {tabs.map(session => (
          <div
            key={session.view.id}
            className="dsh-toolkit-terminal"
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
