/**
 * Shared console state: two independent surfaces — the right AI-output
 * sidebar and the Terminate dialog docked under the composer. Created once in
 * the client apply and injected into every registration (header actions,
 * sidebar, dialog) so they all agree on one store instance without a store
 * seat.
 *
 * All three fields are keyed by session id: the harness remounts
 * session-scoped slot entries per session (the renderer keys the session
 * body by sessionId), so component-local state is naturally per-session —
 * but this store is shared across every session, so the open flags must be
 * keyed here too or switching sessions would leak one session's panel state
 * into the next.
 * @module dsh-devpanel/client/console-store
 */

import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'

/** Shared console state, per-session keyed. */
export interface ConsolePanelState {
  /** Per-session open flags for the right AI-output sidebar, keyed by session id. */
  sidebarOpen: Record<string, boolean>
  /** Per-session open flags for the Terminate dialog, keyed by session id. */
  dialogOpen: Record<string, boolean>
  /** Per-session open flags for the usage stats panel, keyed by session id. */
  statsOpen: Record<string, boolean>
  /** Per-session id of the terminal tab currently shown in the dialog, or
   *  null while the dialog is closed. The sidebar writes into this session's
   *  tab when the user asks to open a file in the terminal. */
  activeTerminalId: Record<string, string | null>
}

/** Read one session's sidebar open flag (no session or absent means closed). */
export function sidebarOpenFor(state: ConsolePanelState, sessionId: string | undefined): boolean {
  return sessionId === undefined ? false : state.sidebarOpen[sessionId] ?? false
}

/** Read one session's dialog open flag (no session or absent means closed). */
export function dialogOpenFor(state: ConsolePanelState, sessionId: string | undefined): boolean {
  return sessionId === undefined ? false : state.dialogOpen[sessionId] ?? false
}

/** Read one session's usage-panel open flag (no session or absent means closed). */
export function statsOpenFor(state: ConsolePanelState, sessionId: string | undefined): boolean {
  return sessionId === undefined ? false : state.statsOpen[sessionId] ?? false
}

/** Read one session's active terminal tab id (no session or absent means none). */
export function activeTerminalFor(state: ConsolePanelState, sessionId: string | undefined): string | null {
  return sessionId === undefined ? null : state.activeTerminalId[sessionId] ?? null
}

/** Create the browser-wide console state source. */
export function createConsoleStore(): SnapshotStore<ConsolePanelState> {
  return createSnapshotStore({ sidebarOpen: {}, dialogOpen: {}, statsOpen: {}, activeTerminalId: {} })
}
