/**
 * Shared console state: two independent surfaces — the right AI-output
 * sidebar and the Terminate dialog docked under the composer. Created once in
 * the client apply and injected into every registration (header actions,
 * sidebar, dialog) so they all agree on one store instance without a store
 * seat.
 * @module dsh-devpanel/client/console-store
 */

import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Shared console state. */
export interface ConsolePanelState {
  /** Whether the right AI-output sidebar is open. */
  sidebarOpen: boolean
  /** Whether the Terminate dialog under the composer is open. */
  dialogOpen: boolean
}

/** Create the browser-wide console state source. */
export function createConsoleStore(): SnapshotStore<ConsolePanelState> {
  return createSnapshotStore({ sidebarOpen: false, dialogOpen: false })
}
