/**
 * Wire vocabulary of the dsh-devpanel terminal panel: the JSON-safe shapes
 * crossing the Typert Remote boundary between the browser client and the
 * host's TerminalPanelService. No Node or harness runtime imports — this
 * module is shared by the host service (encode) and the client contribution
 * (typed descriptors), so it stays pure data.
 * @module dsh-devpanel/types
 */

/** Terminal signal the foreground process group accepts (mirrors SubprocessTerminalSignal). */
export type ConsoleTerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Top-level terminal process status, JSON-safe. */
export type ConsoleSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }

/** Request to spawn one terminal session. */
export interface ConsoleSpawnRequest {
  /** Executable and arguments; `argv[0]` is the program (e.g. ['bash']). */
  argv: readonly string[]
  /** Working directory; empty string falls back to the host's process cwd. */
  cwd: string
  /** Initial terminal row count. */
  rows: number
  /** Initial terminal column count. */
  cols: number
  /** Optional owner-local display name. */
  name?: string
}

/** Successful spawn result. */
export interface ConsoleSpawnResult {
  /** Service-minted session identity used by every later operation. */
  id: string
  /** Top-level terminal process id. */
  pid: number
  /** Shell program name (e.g. 'zsh') shown as the tab badge. */
  shell: string
}

/** Result of one line-oriented write. */
export interface ConsoleWriteResult {
  /** Always true on a settled write. */
  ok: true
}

/** Incremental output consumed from one session. */
export interface ConsoleReadResult {
  /** Output produced since the previous read's offset. */
  delta: string
  /** Current top-level session status. */
  status: ConsoleSessionStatus
}

/** Result of delivering a signal to the foreground process group. */
export interface ConsoleSignalResult {
  /** True only after the backend delivered the signal. */
  delivered: true
  /** Process group that received the signal. */
  targetPgid: number
}

/** Result of terminating a session. */
export interface ConsoleTerminateResult {
  /** Always true on a settled terminate. */
  ok: true
}

/** Owner-visible summary of one live terminal session. */
export interface ConsoleSessionView {
  /** Service-minted session identity. */
  id: string
  /** Optional owner-local display name (e.g. the tab label). */
  name?: string
  /** Shell program name (e.g. 'zsh') shown as the tab badge. */
  shell?: string
  /** Top-level process id. */
  pid?: number
  /** Current top-level process status. */
  status: ConsoleSessionStatus
}

/** Session list response. */
export interface ConsoleListResult {
  /** Live sessions in creation order. */
  sessions: readonly ConsoleSessionView[]
}

/** One file read for the browser file viewer. */
export interface ConsoleReadFileResult {
  /** Resolved absolute path on the host. */
  path: string
  /** UTF-8 file content (kind: 'text'). */
  content: string
  /** Content classification the host derived from the extension. */
  kind: 'text' | 'image'
  /** Base64 data URL (kind: 'image'). */
  dataUrl?: string
}
