/**
 * dsh-devpanel client plugin body: mounts the terminalPanel Remote
 * contribution, registers the console locale, injects the panel stylesheet,
 * and contributes THREE slots — the session-header icon actions (AI-output
 * sidebar toggle + Terminate dialog toggle), the right AI-output sidebar
 * (shell.overlay), and the Terminate dialog docked under the composer
 * (conversation.composer.dock). All registrations share one console store
 * created here, so the header icons and their surfaces agree on open state.
 * All contributions ride ctx effects; plugin unload unmounts the Remote
 * namespace, removes the style tag, and unregisters the slots.
 * @module dsh-devpanel/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the client Context merges this apply body relies on into
// the program — ctx.locale (client-locale), ctx.remote (api-remotes),
// ctx.sessions (api-session-controller), ctx.slots (ui-renderer), and
// ctx.layout (ui-layout).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ConsoleHeaderActions } from './ConsoleHeaderActions.tsx'
import { ConsoleSidebar } from './ConsoleSidebar.tsx'
import { TerminateDialog, type TerminalPanelFace } from './TerminateDialog.tsx'
import type { UsagePanelFace } from './UsagePanel.tsx'
import { createConsoleStore } from './console-store.ts'
import { installConsoleStyles } from './console.css.ts'
import { en, NS, zh } from './locales.ts'
import { TYPERT_REMOTE } from './remote.ts'

/** Required services: the typed Client Remote mount, slot registry, locale, sessions, layout. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'layout'] as const

/**
 * Client plugin body: mount the terminalPanel Remote, then contribute the
 * header actions, the right AI-output sidebar, and the Terminate dialog over
 * one shared store.
 * @param ctx - client root context.
 * @returns disposer unmounting the namespace on plugin unload.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void> | void> = []

  // The Remote namespace must be mounted before the dialog injects it into
  // its component; mount first, then register the slots.
  disposers.push(await ctx.remote.$mount(TYPERT_REMOTE))

  const store = createConsoleStore()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-devpanel: dictionaries')
  installConsoleStyles(ctx)

  // Global hotkey: Cmd/Ctrl+Shift+` toggles the terminal dialog of the
  // CURRENT chat session, wherever focus is (composer, sidebar, terminal).
  // Shift+Backquote reports key '~'.
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      if (event.key !== '`' && event.key !== '~') return
      event.preventDefault()
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) return
      store.update(draft => { draft.dialogOpen[sessionId] = !(draft.dialogOpen[sessionId] ?? false) })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, 'dsh-devpanel: terminal hotkey')

  // This plugin itself mounts the `remote.terminalPanel` namespace above, so
  // it cannot be a static `inject` entry (the loader would wait for a service
  // only this apply provides — a self-wait deadlock). Instead read the live
  // instance out of the service store (ctx.get bypasses the inject check) and
  // close over it in the slot's inject factory.
  const terminalPanel = ctx.get('remote.terminalPanel') as TerminalPanelFace
  // The usage service is OPTIONAL for the terminal: if the gateway has not
  // (yet) exposed it, degrade gracefully (no stats button) instead of letting
  // a single `ctx.get` throw take down every slot including the terminal.
  let usagePanel: UsagePanelFace | undefined
  try {
    usagePanel = ctx.get('remote.usagePanel') as UsagePanelFace
  } catch {
    usagePanel = undefined
  }

  // Session-header utilities (the right-aligned group at the far end of the
  // header, past the job list): the terminal dialog toggle, the file
  // sidebar toggle, and the usage stats toggle. The sidebar toggle also
  // drives the layout's right details column (list slot, session scope).
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'toolkit-actions',
    order: 10,
    locale: NS,
    inject: () => ({
      store,
      usagePanel,
      openSidebar: () => { ctx.layout.openDetails() },
      closeSidebar: () => { ctx.layout.closeDetails() },
    }),
  }, ConsoleHeaderActions))

  // File viewer in the layout's right details column (single slot, session
  // scope — inline, non-floating, squeezes the center column). The header
  // sidebar toggle opens/closes this column through ctx.layout. The harness
  // DetailsPanel already occupies this slot at priority 0; a LOWER priority
  // shadows it (lowest renders), so -10 wins.
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -10,
    locale: NS,
    inject: () => ({
      store,
      terminalPanel,
      // The harness layout closes the details column on every session switch;
      // the sidebar re-opens it through this face when it renders open.
      openDetails: () => { ctx.layout.openDetails() },
      closeDetails: () => { ctx.layout.closeDetails() },
    }),
  }, ConsoleSidebar))

  // Terminate dialog docked under the composer (list slot, session scope).
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'toolkit-dialog',
    // After the stats line: the dialog is the interactive band.
    order: 10,
    locale: NS,
    inject: () => ({
      store,
      terminalPanel,
      sessions: ctx.sessions,
    }),
  }, TerminateDialog))

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
