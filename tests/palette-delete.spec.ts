// @vitest-environment jsdom
/**
 * Regression: a snippet added through the palette add-form must be deletable
 * via its × button (user entries carry custom:true; built-ins stay).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TerminateDialog, type TerminalPanelFace } from '../src/client/TerminateDialog.tsx'
import type { ConsolePanelState } from '../src/client/console-store.ts'

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

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// jsdom (node env here) has no localStorage; a trivial in-memory stub keeps
// the snippet persistence paths (load/persist) exercised.
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
  clear: () => { storage.clear() },
})

function makeStore() {
  const listeners = new Set<() => void>()
  let state: ConsolePanelState = { sidebarOpen: false, dialogOpen: false }
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

function renderDialog(store: ReturnType<typeof makeStore>, terminalPanel: TerminalPanelFace) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  root.render(createElement(
    TerminateDialog,
    {
      store: store as never,
      terminalPanel,
      sessions: {} as never,
      sessionId: undefined,
      useSessions: ((selector: (snapshot: never) => unknown) => selector({} as never)) as never,
      t: ((key: string) => key) as never,
    },
  ))
  return { container, root }
}

describe('palette snippet deletion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage?.clear()
    document.body.innerHTML = ''
  })

  it('deletes a snippet added through the add form', async () => {
    const store = makeStore()
    let nextId = 0
    const spawn = vi.fn(async () => {
      nextId += 1
      return { ok: true as const, value: { id: `s${nextId}`, pid: nextId, shell: 'zsh' } }
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
      await act(async () => {
        store.update(draft => { draft.dialogOpen = true })
      })
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
      await act(async () => {})

      // Open the snippet palette via the ⌘K tab button.
      const openButton = container.querySelector<HTMLElement>('.dsh-devpanel-palette-open')
      expect(openButton).not.toBeNull()
      await act(async () => { openButton?.click() })
      expect(container.querySelector('.dsh-devpanel-palette')).not.toBeNull()

      // Switch to the add-form and save a new snippet.
      const addButton = container.querySelector<HTMLElement>('.dsh-devpanel-palette-new')
      expect(addButton).not.toBeNull()
      await act(async () => { addButton?.click() })
      const inputs = container.querySelectorAll<HTMLInputElement>('.dsh-devpanel-palette-add input')
      expect(inputs.length).toBe(2)
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      await act(async () => {
        nativeSet.call(inputs[0], 'my cmd')
        inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }))
        nativeSet.call(inputs[1], 'echo hi')
        inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const saveButton = container.querySelector<HTMLElement>('.dsh-devpanel-palette-save')
      expect(saveButton).not.toBeNull()
      await act(async () => { saveButton?.click() })

      // The new row shows a delete button (user entries only).
      const rows = container.querySelectorAll('.dsh-devpanel-palette-row')
      const addedRow = [...rows].find(row => row.textContent?.includes('my cmd'))
      expect(addedRow).toBeDefined()
      const deleteButton = addedRow?.querySelector<HTMLElement>('.dsh-devpanel-palette-delete')
      expect(deleteButton).not.toBeNull()

      // Click ×: the row must disappear and the built-ins must remain.
      await act(async () => { deleteButton?.click() })
      const rowsAfter = container.querySelectorAll('.dsh-devpanel-palette-row')
      expect([...rowsAfter].some(row => row.textContent?.includes('my cmd'))).toBe(false)
      expect(rowsAfter.length).toBeGreaterThan(0)
      const stored = JSON.parse(window.localStorage.getItem('dsh-devpanel.snippets') ?? '[]')
      expect(stored.some((entry: { name: string }) => entry.name === 'my cmd')).toBe(false)

      // Close and reopen the palette: the deletion must stick (state persists
      // across overlay toggles, not just within one open session).
      await act(async () => { openButton?.click() })
      expect(container.querySelector('.dsh-devpanel-palette')).toBeNull()
      await act(async () => { openButton?.click() })
      const rowsReopened = container.querySelectorAll('.dsh-devpanel-palette-row')
      expect([...rowsReopened].some(row => row.textContent?.includes('my cmd'))).toBe(false)
      expect(rowsReopened.length).toBeGreaterThan(0)
    } finally {
      await act(async () => { root.unmount() })
    }
  })

  it('shows the delete button on persisted snippets but never on built-ins', async () => {
    // Pre-seed localStorage the way a previous session would have: only the
    // persisted subset ({name, command}), exactly what persistCustomSnippets
    // writes. loadCustomSnippets must restore custom:true on load.
    storage.set('dsh-devpanel.snippets', JSON.stringify([{ name: 'test', command: 'du -lh' }]))
    const store = makeStore()
    const terminalPanel: TerminalPanelFace = {
      spawn: vi.fn(async () => ({ ok: true as const, value: { id: 's1', pid: 1, shell: 'zsh' } })),
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
      await act(async () => {
        store.update(draft => { draft.dialogOpen = true })
      })
      await act(async () => {})
      const openButton = container.querySelector<HTMLElement>('.dsh-devpanel-palette-open')
      await act(async () => { openButton?.click() })

      const rows = container.querySelectorAll('.dsh-devpanel-palette-row')
      expect(rows.length).toBe(5) // 4 built-ins + 1 persisted

      // The persisted snippet row carries the × delete affordance.
      const persistedRow = [...rows].find(row => row.textContent?.includes('du -lh'))
      expect(persistedRow).toBeDefined()
      expect(persistedRow?.querySelector('.dsh-devpanel-palette-delete')).not.toBeNull()

      // Built-in rows must NOT show a delete button (custom: false).
      for (const row of rows) {
        if (row === persistedRow) continue
        expect(row.querySelector('.dsh-devpanel-palette-delete')).toBeNull()
      }
    } finally {
      await act(async () => { root.unmount() })
    }
  })
})
