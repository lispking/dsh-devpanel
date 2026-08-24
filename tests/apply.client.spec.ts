// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

// The client apply pulls in the runtime only through console-store.ts's value
// import of createSnapshotStore (every other @deepseek-ai import in the client
// half is type-only and erased). Vitest resolves workspace packages natively
// (bypassing the vite plugin chain), so loading the real runtime would execute
// the built closure-factory bundles, which read window.__ModuleLoader__ at
// module scope. Mock the store module with a minimal stub instead.
vi.mock('../src/client/console-store.ts', () => {
  const state = { sidebarOpen: false, dialogOpen: false }
  return {
    createConsoleStore: () => ({
      getSnapshot: () => state,
      subscribe: () => () => {},
      update: (mutator: (draft: typeof state) => void) => { mutator(state) },
      set: (next: typeof state) => { Object.assign(state, next) },
    }),
  }
})

import { apply, inject } from '../src/client/index.ts'
import { ConsoleHeaderActions } from '../src/client/ConsoleHeaderActions.tsx'
import { ConsoleSidebar } from '../src/client/ConsoleSidebar.tsx'
import { TerminateDialog } from '../src/client/TerminateDialog.tsx'
import { CONSOLE_STYLE_PLUGIN } from '../src/client/console.css.ts'
import { NS } from '../src/client/locales.ts'
import { TYPERT_REMOTE } from '../src/client/remote.ts'

/** Minimal stub of the client slot registry (inject + register). */
interface SlotsStub {
  inject: ReturnType<typeof vi.fn>
  register: ReturnType<typeof vi.fn>
}

function mountClient() {
  const ctx = new Context()

  const disposeRemote = vi.fn(async () => {})
  const mount = vi.fn(async () => disposeRemote)
  ctx.provide('remote', { $mount: mount } as never)

  const slots: SlotsStub = {
    inject: vi.fn((_key: string, callback: () => unknown) => {
      callback()
      return () => {}
    }),
    register: vi.fn(() => () => {}),
  }
  ctx.provide('slots', slots as never)

  const disposeLocale = vi.fn(() => {})
  ctx.provide('locale', { register: vi.fn(() => disposeLocale) } as never)

  ctx.provide('sessions', {} as never)

  const openDetails = vi.fn(() => {})
  const closeDetails = vi.fn(() => {})
  ctx.provide('layout', { openDetails, closeDetails } as never)

  return { ctx, mount, disposeRemote, slots, openDetails, closeDetails }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dsh-devpanel client apply', () => {
  it('declares the Remote, slot registry, locale, sessions, and layout services', () => {
    expect(inject).toEqual(['remote', 'slots', 'locale', 'sessions', 'layout'])
  })

  it('mounts the terminalPanel Remote contribution', async () => {
    const { ctx, mount } = mountClient()
    await apply(ctx as never)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount).toHaveBeenCalledWith(TYPERT_REMOTE)
  })

  it('registers the header actions, the file viewer, and the Terminate dialog slots', async () => {
    const { ctx, slots, openDetails, closeDetails } = mountClient()
    await apply(ctx as never)

    // The file viewer occupies the layout's right details column; the dialog
    // stays in the composer dock; the two header toggles ride the utilities
    // row. The sidebar toggle drives the details column through ctx.layout.
    expect(slots.inject).toHaveBeenCalledTimes(3)
    const keys = slots.inject.mock.calls.map((call) => call[0] as string).sort()
    expect(keys).toEqual([
      'conversation.composer.dock',
      'conversation.session.header.utilities',
      'details',
    ])

    const registrations = slots.register.mock.calls as Array<
      [{ name: string; id?: string; order?: number; locale: string }, unknown]
    >
    const names = registrations.map(([options]) => options.name).sort()
    expect(names).toEqual([
      'conversation.composer.dock',
      'conversation.session.header.utilities',
      'details',
    ])

    const actions = registrations.find(([options]) => options.name === 'conversation.session.header.utilities')
    expect(actions?.[0]).toMatchObject({ id: 'toolkit-actions', order: 10, locale: NS })
    expect(actions?.[1]).toBe(ConsoleHeaderActions)

    const sidebar = registrations.find(([options]) => options.name === 'details')
    expect(sidebar?.[0]).toMatchObject({ locale: NS })
    expect(sidebar?.[1]).toBe(ConsoleSidebar)

    const dialog = registrations.find(([options]) => options.name === 'conversation.composer.dock')
    expect(dialog?.[0]).toMatchObject({ id: 'toolkit-dialog', order: 10, locale: NS })
    expect(dialog?.[1]).toBe(TerminateDialog)

    // The header sidebar toggle opens/closes the layout details column.
    expect(openDetails).not.toHaveBeenCalled()
    expect(closeDetails).not.toHaveBeenCalled()
  })

  it('unmounts the Remote namespace through the returned disposer', async () => {
    const { ctx, disposeRemote } = mountClient()
    const dispose = await apply(ctx as never)
    expect(disposeRemote).not.toHaveBeenCalled()
    await dispose()
    expect(disposeRemote).toHaveBeenCalledTimes(1)
  })

  it('injects the console stylesheet for the plugin lifetime', async () => {
    const nodes: Array<{ dataset: Record<string, string>; remove: ReturnType<typeof vi.fn> }> = []
    const remove = vi.fn(() => {})
    vi.stubGlobal('document', {
      head: { appendChild: vi.fn((el: (typeof nodes)[number]) => { nodes.push(el) }) },
      createElement: vi.fn(() => ({ dataset: {}, textContent: '', remove })),
    } as never)
    const { ctx } = mountClient()
    await apply(ctx as never)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.dataset.plugin).toBe(CONSOLE_STYLE_PLUGIN)
    expect(nodes[0]?.textContent).toContain('.dsh-toolkit-sidebar')

    // The stylesheet is registered through ctx.effect, so its cleanup runs on
    // fiber disposal (the apply disposer only unmounts the Remote namespace).
    await ctx.fiber.dispose()
    expect(remove).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
