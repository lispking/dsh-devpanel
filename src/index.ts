/**
 * dsh-toolkit host half: one TypertRemoteService exposing a user-facing PTY
 * terminal panel to the browser client. Wraps `ctx.subprocess.spawnTerminal`
 * (the real PTY primitive) with owner-free session records: the browser can
 * spawn, write, read deltas, signal the foreground group, terminate, list,
 * and dispose sessions. The Gateway auto-discovers this service through its
 * `typertRemote` binding, so the client calls `terminalPanel/*` endpoints
 * with no harness changes.
 * @module dsh-toolkit
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { readFile as readFileNode, stat } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type {
  ConsoleListResult,
  ConsoleReadFileResult,
  ConsoleReadResult,
  ConsoleSessionStatus,
  ConsoleSessionView,
  ConsoleSignalResult,
  ConsoleSpawnRequest,
  ConsoleSpawnResult,
  ConsoleTerminalSignal,
  ConsoleTerminateResult,
  ConsoleWriteResult,
} from './types.ts'

/** Retained scrollback cap per session; overflow keeps the TAIL. */
const MAX_SCROLLBACK_BYTES = 1_000_000

/** Extension → MIME for image files the browser viewer renders natively. */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

/** One live session record owned by this service. */
interface SessionRecord {
  /** Service-minted identity. */
  readonly id: string
  /** Optional owner-local display name. */
  readonly name?: string
  /** Shell program name (e.g. 'zsh') shown as the tab badge. */
  readonly shell: string
  /** Top-level terminal process id. */
  readonly pid: number
  /** Live PTY handle from the subprocess provider. */
  readonly handle: SubprocessTerminalHandle
  /** Streaming UTF-8 decoder: output arrives as bytes in arbitrary chunks,
   *  and a multi-byte char straddling two chunks must stay intact (per-chunk
   *  toString() would decode each half as U+FFFD, painting '?' in the shell). */
  readonly decoder: TextDecoder
  /** Retained UTF-8 output tail in delivery order. */
  buffer: string
  /** Read cursor for delta consumption. */
  readOffset: number
  /** Current top-level process status. */
  status: ConsoleSessionStatus
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-facing terminal panel service (dsh-toolkit). */
    terminalPanel: TerminalPanelService
  }
}

/** Owner-free PTY sessions for the browser console panel. */
export class TerminalPanelService extends TypertRemoteService {
  /** Required host services. */
  static inject = ['subprocess'] as const

  private readonly sessions = new Map<string, SessionRecord>()

  constructor(ctx: Context) {
    super(ctx, 'terminalPanel')
    // Session lifetimes follow the plugin: terminate every live PTY when the
    // fiber that owns this service disposes.
    ctx.effect(() => () => { void this.disposeAll() }, 'terminalPanel: session cleanup')
  }

  /**
   * Spawn one terminal session from a fully explicit request.
   * @param request - argv/cwd/size request; empty cwd falls back to the host cwd.
   * @returns the minted session identity and top-level pid.
   */
  @Remote
  async spawn(request: ConsoleSpawnRequest): Promise<ConsoleSpawnResult> {
    // Default argv uses the system login shell ($SHELL, falling back to /bin/sh)
    // instead of a hard-coded bash, so the panel behaves like a native terminal.
    // The harness forks PTYs with TERM=dumb (subprocess-local hardcodes
    // name:'dumb'), which makes `clear` emit nothing (its terminfo capability
    // is empty) and zsh print a literal '?' in front of prompt glyphs whose
    // width it cannot resolve. Wrap the default shell so it exports a real
    // TERM before exec'ing the user's shell — self-contained, no harness
    // change required. Explicit request argv is left verbatim.
    const defaultShell = process.env.SHELL ?? '/bin/sh'
    const argv = request.argv.length > 0
      ? [...request.argv]
      : [defaultShell, '-c', 'export TERM=xterm-256color; exec "${SHELL:-/bin/sh}"']
    // A fresh-session default ('' or '~') lands in the user home; an explicit
    // path is used verbatim.
    const cwd = request.cwd === '' || request.cwd === '~' ? homedir() : request.cwd
    const handle = await this.ctx.subprocess.spawnTerminal({
      argv,
      cwd,
      rows: request.rows,
      cols: request.cols,
      graceMs: 2_000,
    })
    const id = randomUUID()
    const shell = basename(argv[0] ?? 'shell')
    const record: SessionRecord = {
      id,
      ...(request.name === undefined ? {} : { name: request.name }),
      shell,
      pid: handle.pid,
      handle,
      decoder: new TextDecoder('utf-8'),
      buffer: '',
      readOffset: 0,
      status: { kind: 'running' },
    }
    this.sessions.set(id, record)
    // Consume the live output stream into the bounded scrollback; the exit
    // promise drives the status transition (a transport failure also settles).
    handle.output.on('data', (chunk: unknown) => {
      const text = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
          ? record.decoder.decode(chunk, { stream: true })
          : String(chunk)
      record.buffer += text
      if (record.buffer.length > MAX_SCROLLBACK_BYTES) {
        record.buffer = record.buffer.slice(-MAX_SCROLLBACK_BYTES)
        // Keep the delta cursor coherent: drop the same tail from the cursor.
        record.readOffset = Math.max(0, record.readOffset - (MAX_SCROLLBACK_BYTES > 0 ? text.length : 0))
      }
    })
    void handle.done.then(
      (outcome) => {
        record.status = { kind: 'exited', exitCode: outcome.exitCode, signal: outcome.signal }
      },
      () => {
        record.status = { kind: 'exited', exitCode: null, signal: null }
      },
    )
    return { id, pid: handle.pid, shell }
  }

  /**
   * Write text to the terminal input.
   * @param id - session identity.
   * @param text - UTF-8 text without implicit newline conversion.
   * @param submit - whether to append the terminal's Enter sequence.
   * @returns confirmation after the write settles.
   */
  @Remote
  async write(id: string, text: string, submit: boolean): Promise<ConsoleWriteResult> {
    const record = this.expect(id)
    await record.handle.write(submit ? `${text}\r` : text)
    return { ok: true }
  }

  /**
   * Consume the output produced since the previous read.
   * @param id - session identity.
   * @returns the delta plus the current top-level status.
   */
  @Remote
  read(id: string): ConsoleReadResult {
    const record = this.expect(id)
    const delta = record.buffer.slice(record.readOffset)
    record.readOffset = record.buffer.length
    return { delta, status: record.status }
  }

  /**
   * Deliver a signal to the verified foreground process group.
   * @param id - session identity.
   * @param sig - permitted terminal signal (wire name avoids the gateway's `signal` cancellation slot).
   * @returns the exact group that received the signal.
   */
  @Remote
  async signal(id: string, sig: ConsoleTerminalSignal): Promise<ConsoleSignalResult> {
    const record = this.expect(id)
    const targetPgid = await record.handle.signalForeground(sig)
    return { delivered: true, targetPgid }
  }

  /**
   * Terminate the session's captured process tree and await quiescence.
   * @param id - session identity.
   * @returns confirmation after settlement; the record stays listed as exited.
   */
  @Remote
  async terminate(id: string): Promise<ConsoleTerminateResult> {
    const record = this.expect(id)
    await record.handle.terminate()
    return { ok: true }
  }

  /**
   * List live sessions in creation order.
   * @returns owner-visible session summaries.
   */
  @Remote
  list(): ConsoleListResult {
    const sessions: ConsoleSessionView[] = [...this.sessions.values()].map(record => ({
      id: record.id,
      ...(record.name === undefined ? {} : { name: record.name }),
      shell: record.shell,
      pid: record.pid,
      status: record.status,
    }))
    return { sessions }
  }

  /**
   * Remove one session record (and terminate it if still running).
   * @param id - session identity.
   * @returns confirmation; unknown ids are idempotently ok.
   */
  @Remote
  async dispose(id: string): Promise<{ ok: true }> {
    const record = this.sessions.get(id)
    if (record === undefined) return { ok: true }
    this.sessions.delete(id)
    if (record.status.kind === 'running') {
      await record.handle.terminate().catch(() => undefined)
    }
    return { ok: true }
  }

  /**
   * Read one file for the browser file viewer (the AI-output sidebar).
   * @param path - absolute path, `~`-prefixed home path, or path relative to `cwd`.
   * @param cwd - base directory for relative paths (the session's project
   *   directory); defaults to the host process cwd.
   * @returns the resolved path, a text/image classification, and the content
   *   (UTF-8 for text, a base64 data URL for images).
   */
  @Remote
  async readFile(path: string, cwd?: string): Promise<ConsoleReadFileResult> {
    const resolved = path === '~' || path.startsWith('~/')
      ? `${homedir()}${path.slice(1)}`
      : path
    const base = cwd === undefined || cwd === '' || cwd === '~' ? process.cwd() : cwd
    const target = resolved.startsWith('/') ? resolved : `${base}/${resolved}`
    const info = await stat(target)
    if (!info.isFile()) {
      throw new Error(`terminalPanel: not a file ${JSON.stringify(path)} (resolved ${JSON.stringify(target)})`)
    }
    const ext = extname(target).toLowerCase()
    const mime = IMAGE_MIME[ext]
    if (mime !== undefined) {
      const buffer = await readFileNode(target)
      return { path: target, content: '', kind: 'image', dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
    }
    const content = await readFileNode(target, 'utf8')
    return { path: target, content, kind: 'text' }
  }

  private expect(id: string): SessionRecord {
    const record = this.sessions.get(id)
    if (record === undefined) {
      throw new Error(`terminalPanel: unknown session ${JSON.stringify(id)}`)
    }
    return record
  }

  private async disposeAll(): Promise<void> {
    const records = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(records.map(record => record.handle.terminate()))
  }
}

export default TerminalPanelService
