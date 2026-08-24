/**
 * Session-header actions for dsh-devpanel: two icon buttons beside the
 * Session Log control — the AI-output sidebar toggle and the Terminate
 * dialog toggle. Both flip the shared console store; the sidebar and the
 * dialog render their own surfaces through their own slots.
 * @module dsh-devpanel/client/ConsoleHeaderActions
 */

import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the 'conversation.session.header.utilities' SlotMap row
// (declared by ui-conversation) into this program so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConsolePanelState } from './console-store.ts'
import { NS } from './locales.ts'

/**
 * The international terminal glyph (`>_`, the Lucide "Terminal" icon): a
 * prompt caret over an underscore. The primitives icon set has no terminal
 * glyph (`IconCodeOutline16` is `</>`), so this ships the standard symbol
 * inline, inheriting `currentColor` like the other header icons.
 */
function IconTerminal16(): React.JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  )
}

/** Injected business face: the shared console store + details-column open/close. */
export interface ConsoleHeaderActionsInjected {
  /** Shared sidebar/dialog open state; each button flips its own flag. */
  store: SnapshotStore<ConsolePanelState>
  /** Open the layout's right details column (geometry lives with ctx.layout). */
  openSidebar: () => void
  /** Close the layout's right details column. */
  closeSidebar: () => void
}

/** Full component props: header utility standard kit + locale seat + injected store. */
export type ConsoleHeaderActionsProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & ConsoleHeaderActionsInjected

/**
 * Render the two console icon buttons in the session-header utilities (the
 * right-aligned group at the far end of the header, past the job list).
 * @param props - standard header kit, locale seat, injected store + column toggles.
 * @returns the file-sidebar and terminal toggles reflecting the shared store.
 */
export function ConsoleHeaderActions({ store, openSidebar, closeSidebar, t }: ConsoleHeaderActionsProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return (
    <div className="dsh-devpanel-header-actions">
      <button
        type="button"
        className="dsh-devpanel-header-icon"
        aria-pressed={state.dialogOpen}
        aria-label={t('header.terminate.aria')}
        title={t('header.terminate.aria')}
        onClick={() => { store.update(draft => { draft.dialogOpen = !draft.dialogOpen }) }}
      >
        <IconTerminal16 />
      </button>
      <button
        type="button"
        className="dsh-devpanel-header-icon"
        aria-pressed={state.sidebarOpen}
        aria-label={t('header.sidebar.aria')}
        title={t('header.sidebar.aria')}
        onClick={() => {
          const opening = !state.sidebarOpen
          store.update(draft => { draft.sidebarOpen = opening })
          if (opening) openSidebar()
          else closeSidebar()
        }}
      >
        <IconPanelLeftOutline16 />
      </button>
    </div>
  )
}
