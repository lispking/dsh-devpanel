/**
 * dsh-devpanel client plugin body: mounts the terminalPanel Remote
 * contribution, registers the console locale, injects the panel stylesheet,
 * and contributes THREE surfaces — the session-header icon actions (file-tab
 * + Terminate dialog toggles), a right-Sidebar tab type holding the AI-output
 * / artifact viewer, and the Terminate dialog docked under the composer
 * (conversation.composer.dock). All registrations share one console store
 * created here, so the header icons and their surfaces agree on open state.
 * All contributions ride ctx effects; plugin unload unmounts the Remote
 * namespace, removes the style tag, and unregisters the slots and tab type.
 * @module dsh-devpanel/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the client Context merges this apply body relies on into
// the program — ctx.locale (client-locale), ctx.remote (api-remotes),
// ctx.sessions (api-session-controller), ctx.slots (ui-renderer),
// ctx.sidebarRight / ctx.sidebarRightTabs (ui-sidebar-right) and
// ctx.uiSession (ui-session).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ConsoleHeaderActions } from './ConsoleHeaderActions.tsx'
import { ConsoleSidebar } from './ConsoleSidebar.tsx'
import { TerminateDialog, type TerminalPanelFace } from './TerminateDialog.tsx'
import type { UsagePanelFace } from './UsagePanel.tsx'
import { createConsoleStore } from './console-store.ts'
import { installConsoleStyles } from './console.css.ts'
import { en, NS, zh } from './locales.ts'
import { TYPERT_REMOTE } from './remote.ts'

/**
 * This implementation's identity in the right Sidebar's tab registry: the key
 * its body registers under in `sidebar.right.pane.tab`.
 */
const DEVPANEL_ID = 'dsh-devpanel'

/** The page kind the header's file-tab button opens. */
const DEVPANEL_KIND = 'devpanel'

/** Required services: the typed Client Remote mount, slot registry, locale, sessions, and the right Sidebar's tab registry. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs', 'uiSession'] as const

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
      // 0.2 dropped `current` from the Session list snapshot; the renderer
      // binding source is the live current-session face.
      const sessionId = ctx.uiSession.adapter.current.getSnapshot().key
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
      openSidebar: () => { ctx.sidebarRight.openTab(DEVPANEL_KIND) },
      closeSidebar: () => { if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded() },
    }),
  }, ConsoleHeaderActions))

  // The AI-output / artifact viewer as a right-Sidebar tab type. 0.2 removed
  // the standalone `details` seat this plugin used to occupy: the right column
  // is now the Sidebar's own, and the supported way into it is a tab type.
  // Registering the type puts this viewer in the Sidebar's tab strip; the body
  // registers into the keyed seat under the same id, and the header button
  // opens the kind. Nothing here reaches into the Sidebar's stores or panes.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: DEVPANEL_ID,
    kind: DEVPANEL_KIND,
    title: () => ctx.locale.bind(NS)('sidebar.title'),
  }), 'dsh-devpanel: sidebar tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DEVPANEL_ID,
    locale: NS,
    inject: () => ({ store, terminalPanel }),
  }, ConsoleSidebar)), 'dsh-devpanel: sidebar tab body')

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
