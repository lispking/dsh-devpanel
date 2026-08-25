// @vitest-environment jsdom
/**
 * Regression: closing the LAST tab closes the whole panel; reopening the
 * Terminate dialog must auto-spawn a fresh default tab again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TerminateDialog, type TerminalPanelFace } from '../src/client/TerminateDialog.tsx'
import type { ConsolePanelState } from '../src/client/console-store.ts'

// xterm needs a canvas; jsdom has none. A scriptable stub keeps the terminal
// happy so the test focuses on the tab lifecycle (spawn/close/reopen).
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    rows = 24
    cols = 80
    open = vi.fn()
    write = vi.fn()
    onData = vi.fn()
    onSelectionChange = vi.fn()
    attachCustomKeyEventHandler = vi.fn(() => true)
    loadAddon = vi.fn()
    dispose = vi.fn()
    getSelection = vi.fn(() => '')
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit = vi.fn() },
}))

// jsdom has no ResizeObserver; the dialog re-fits the active tab through one.
class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// console-store.ts value-imports createSnapshotStore from the client runtime,
// whose built bundles read window.__ModuleLoader__ at module scope — jsdom has
// none (see apply.client.spec.ts). This suite never creates the real store
// (makeStore is a plain stub), so mock the module with the read helpers the
// dialog imports.
vi.mock('../src/client/console-store.ts', () => ({
  createConsoleStore: () => { throw new Error('not used in this suite') },
  sidebarOpenFor: (state: { sidebarOpen: Record<string, boolean> }, sessionId: string | undefined) =>
    sessionId === undefined ? false : state.sidebarOpen[sessionId] ?? false,
  dialogOpenFor: (state: { dialogOpen: Record<string, boolean> }, sessionId: string | undefined) =>
    sessionId === undefined ? false : state.dialogOpen[sessionId] ?? false,
  activeTerminalFor: (state: { activeTerminalId: Record<string, string | null> }, sessionId: string | undefined) =>
    sessionId === undefined ? null : state.activeTerminalId[sessionId] ?? null,
}))

/** A minimal writable snapshot store (zustand-like contract). */
function makeStore() {
  const listeners = new Set<() => void>()
  let state: ConsolePanelState = { sidebarOpen: {}, dialogOpen: {}, activeTerminalId: {} }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    update: (mutator: (draft: ConsolePanelState) => void) => {
      state = { ...state }
      mutator(state)
      for (const fn of [...listeners]) fn()
    },
    set: (next: ConsolePanelState) => {
      state = next
      for (const fn of [...listeners]) fn()
    },
  }
}

/** Mount the Terminate dialog into jsdom with stubbed kit props. */
function renderDialog(store: ReturnType<typeof makeStore>, terminalPanel: TerminalPanelFace, sessionId = 'test-session') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  root.render(createElement(
    TerminateDialog,
    {
      store: store as never,
      terminalPanel,
      sessions: {} as never,
      sessionId,
      useSessions: ((selector: (snapshot: never) => unknown) => selector({ byId: {} } as never)) as never,
      t: ((key: string) => key) as never,
    },
  ))
  return { container, root }
}

describe('TerminateDialog tab lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('re-spawns a default tab when reopened after closing the last tab', async () => {
    const store = makeStore()
    let nextId = 0
    const spawn = vi.fn(async () => {
      nextId += 1
      return {
        ok: true as const,
        value: { id: `s${nextId}`, pid: nextId, shell: 'zsh' },
      }
    })
    const terminalPanel: TerminalPanelFace = {
      spawn,
      write: vi.fn(async () => ({ ok: true })),
      read: vi.fn(async () => ({ ok: true, value: { delta: '', status: { kind: 'running' } } })),
      signal: vi.fn(async () => ({ ok: true, value: { delivered: true, targetPgid: 1 } })),
      terminate: vi.fn(async () => ({ ok: true })),
      list: vi.fn(async () => ({ ok: true, value: { sessions: [] } })),
      dispose: vi.fn(async () => ({ ok: true })),
      readFile: vi.fn(async () => ({ ok: true, value: { path: '/x', content: '', kind: 'text' } })),
      listDir: vi.fn(async () => ({ ok: true, value: { path: '/x', entries: [] } })),
      tail: vi.fn(async () => ({ ok: true, value: { path: '/x', delta: '', offset: 0, gone: false } })),
    }
    const { container, root } = renderDialog(store, terminalPanel)
    try {
      // Open the dialog: the first default tab spawns and renders.
      await act(async () => {
        store.update(draft => { draft.dialogOpen['test-session'] = true })
      })
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
      await act(async () => {})
      expect(container.querySelectorAll('.dsh-devpanel-tab')).toHaveLength(1)

      // Close the last (only) tab: the whole panel closes.
      const closeButton = container.querySelector<HTMLElement>('.dsh-devpanel-tab-close')
      expect(closeButton).not.toBeNull()
      await act(async () => {
        closeButton?.click()
      })
      expect(store.getSnapshot().dialogOpen['test-session']).toBe(false)
      expect(container.querySelector('.dsh-devpanel-dialog')).toBeNull()

      // Reopen: a fresh default tab must spawn AND render again.
      await act(async () => {
        store.update(draft => { draft.dialogOpen['test-session'] = true })
      })
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
      await act(async () => {})
      expect(container.querySelectorAll('.dsh-devpanel-tab')).toHaveLength(1)
    } finally {
      await act(async () => { root.unmount() })
    }
  })

  it('re-spawns a default tab when reopened after the panel was closed via the header toggle', async () => {
    // The header icon only toggles dialogOpen; the dialog must still reset its
    // sessions so a fresh default tab appears on the next open.
    // A distinct session id isolates this test from the layout the previous
    // test saved under 'test-session' (module-level registry).
    const sessionId = 'test-session-2'
    const store = makeStore()
    let nextId = 0
    const spawn = vi.fn(async () => {
      nextId += 1
      return {
        ok: true as const,
        value: { id: `s${nextId}`, pid: nextId, shell: 'zsh' },
      }
    })
    const terminalPanel: TerminalPanelFace = {
      spawn,
      write: vi.fn(async () => ({ ok: true })),
      read: vi.fn(async () => ({ ok: true, value: { delta: '', status: { kind: 'running' } } })),
      signal: vi.fn(async () => ({ ok: true, value: { delivered: true, targetPgid: 1 } })),
      terminate: vi.fn(async () => ({ ok: true })),
      list: vi.fn(async () => ({ ok: true, value: { sessions: [] } })),
      dispose: vi.fn(async () => ({ ok: true })),
      readFile: vi.fn(async () => ({ ok: true, value: { path: '/x', content: '', kind: 'text' } })),
      listDir: vi.fn(async () => ({ ok: true, value: { path: '/x', entries: [] } })),
      tail: vi.fn(async () => ({ ok: true, value: { path: '/x', delta: '', offset: 0, gone: false } })),
    }
    const { container, root } = renderDialog(store, terminalPanel, sessionId)
    try {
      await act(async () => {
        store.update(draft => { draft.dialogOpen[sessionId] = true })
      })
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
      await act(async () => {})
      expect(container.querySelectorAll('.dsh-devpanel-tab')).toHaveLength(1)

      // Close the panel the way the header button does: toggle dialogOpen only.
      await act(async () => {
        store.update(draft => { draft.dialogOpen[sessionId] = false })
      })
      expect(container.querySelector('.dsh-devpanel-dialog')).toBeNull()

      // Reopen: a fresh default tab must spawn again.
      await act(async () => {
        store.update(draft => { draft.dialogOpen[sessionId] = true })
      })
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
      await act(async () => {})
      expect(container.querySelectorAll('.dsh-devpanel-tab')).toHaveLength(1)
    } finally {
      await act(async () => { root.unmount() })
    }
  })
})
