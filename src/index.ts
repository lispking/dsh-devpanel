/**
 * dsh-devpanel host half: one TypertRemoteService exposing a user-facing PTY
 * terminal panel to the browser client. Wraps `ctx.subprocess.spawnTerminal`
 * (the real PTY primitive) with owner-free session records: the browser can
 * spawn, write, read deltas, signal the foreground group, terminate, list,
 * and dispose sessions. The Gateway auto-discovers this service through its
 * `typertRemote` binding, so the client calls `terminalPanel/*` endpoints
 * with no harness changes.
 * @module dsh-devpanel
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { open, readFile as readFileNode, readdir, stat } from 'node:fs/promises'
import { extname, basename, resolve, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type {
  ConsoleDirEntry,
  ConsoleListDirResult,
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
  ConsoleTailResult,
} from './types.ts'

/** Retained scrollback cap per session; overflow keeps the TAIL. */
const MAX_SCROLLBACK_BYTES = 1_000_000

/** Overall teardown budget at plugin unload; a stuck PTY must not hang the host. */
const DISPOSE_BUDGET_MS = 5_000

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
    /** User-facing terminal panel service (dsh-devpanel). */
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
    // change required.
    //
    // Constraint: the TERM wrapper is ONLY applied when the caller leaves
    // argv empty (the panel's own default tab). Explicit request argv is
    // passed verbatim, so a caller who spawns `['bash']` directly inherits
    // TERM=dumb and loses `clear`/prompt glyphs. This is intentional — the
    // wrapper re-execs `${SHELL}` which would clobber a caller-chosen
    // program — but the client default-tab path always sends argv: [] and
    // therefore always gets the wrapped shell. Callers passing explicit
    // argv are responsible for their own TERM setup.
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
        // Drop the overflowed PREFIX (not the just-appended chunk); the cursor
        // must shift by exactly the number of bytes removed from the front.
        const before = record.buffer.length
        record.buffer = record.buffer.slice(-MAX_SCROLLBACK_BYTES)
        const dropped = before - record.buffer.length
        record.readOffset = Math.max(0, record.readOffset - dropped)
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
   * Resolve a browser-supplied path the same way for readFile and listDir:
   * `~`-prefixed paths land in the home directory; absolute paths are used
   * verbatim; relative paths resolve under `cwd` and must NOT escape it
   * (accidental traversal guard — absolute/`~` paths are explicit intent).
   * @param path - absolute, `~`-prefixed, or `cwd`-relative path.
   * @param cwd - base directory for relative paths; defaults to the host cwd.
   * @returns the normalized absolute path.
   */
  private resolveTarget(path: string, cwd?: string): string {
    const resolved = path === '~' || path.startsWith('~/')
      ? `${homedir()}${path.slice(1)}`
      : path
    const base = cwd === undefined || cwd === '' || cwd === '~' ? process.cwd() : cwd
    const target = resolve(resolved.startsWith('/') ? resolved : `${base}/${resolved}`)
    // Reject relative paths that traverse out of the project root. Absolute
    // and `~`-prefixed paths are explicit user intent and stay allowed.
    if (!resolved.startsWith('/') && !resolved.startsWith('~')) {
      const drift = relative(resolve(base), target)
      if (drift.startsWith('..') || drift === '') {
        if (drift !== '') {
          throw new Error(`terminalPanel: path escapes project directory ${JSON.stringify(path)} (resolved ${JSON.stringify(target)})`)
        }
      }
    }
    return target
  }

  /**
   * Read one file for the browser file viewer (the AI-output sidebar).
   *
   * Threat model: the browser is the same user who already owns the host
   * shell, so we do NOT forbid reading `~/.ssh` or `/etc/passwd` — those are
   * files the user could `cat` in the terminal anyway. What we DO prevent is
   * accidental traversal OUT of the session's project directory via relative
   * `..` segments in a path that the caller expected to be project-local. An
   * absolute path or a `~`-prefixed path is honored verbatim (explicit user
   * intent); a relative path is resolved under `cwd` and rejected if the
   * normalized target escapes that root.
   *
   * @param path - absolute path, `~`-prefixed home path, or path relative to `cwd`.
   * @param cwd - base directory for relative paths (the session's project
   *   directory); defaults to the host process cwd.
   * @returns the resolved path, a text/image classification, and the content
   *   (UTF-8 for text, a base64 data URL for images).
   */
  @Remote
  async readFile(path: string, cwd?: string): Promise<ConsoleReadFileResult> {
    const target = this.resolveTarget(path, cwd)
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

  /**
   * List one directory for the browser file tree (the AI-output sidebar).
   * Same path resolution and traversal guard as readFile; entries are sorted
   * directories-first, then alphabetically, with dotfiles included.
   * @param path - absolute, `~`-prefixed, or `cwd`-relative directory path.
   * @param cwd - base directory for relative paths; defaults to the host cwd.
   * @returns the resolved path and its sorted entries.
   */
  @Remote
  async listDir(path: string, cwd?: string): Promise<ConsoleListDirResult> {
    const target = this.resolveTarget(path, cwd)
    const dirents = await readdir(target, { withFileTypes: true })
    const entries: ConsoleDirEntry[] = dirents.map(entry => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
    }))
    // Directories first, then alphabetical (case-insensitive).
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return { path: target, entries }
  }

  /**
   * Read a file's incremental tail for the browser log view. The client keeps
   * an opaque byte offset and passes it back, so each call returns only the
   * bytes appended since — a tiny seek+read, safe to call on a tick while a
   * process is actively appending. Same path resolution/traversal guard as
   * readFile. A vanished file reports `gone` instead of throwing, letting the
   * UI stop polling cleanly.
   * @param path - absolute, `~`-prefixed, or `cwd`-relative file path.
   * @param cwd - base directory for relative paths; defaults to the host cwd.
   * @param offset - byte offset to resume from (0 replays the whole file).
   * @returns the delta, the next offset, and whether the file is gone.
   */
  @Remote
  async readTail(path: string, cwd?: string, offset = 0): Promise<ConsoleTailResult> {
    const target = this.resolveTarget(path, cwd)
    let handle
    try {
      handle = await open(target, 'r')
    } catch {
      // ENOENT/ENOTDIR → the file is gone (rotated/deleted); the UI stops.
      return { path: target, delta: '', offset, gone: true }
    }
    try {
      const statInfo = await handle.stat()
      if (offset >= statInfo.size) {
        // No new bytes: keep the caller's offset (or clamp a stale oversized
        // offset so a truncated log read back in sync).
        return { path: target, delta: '', offset: Math.min(offset, statInfo.size), gone: false }
      }
      const size = statInfo.size - offset
      const buffer = Buffer.alloc(size)
      await handle.read(buffer, 0, size, offset)
      // The tail is streamed as UTF-8; an incomplete multi-byte char at the
      // chunk boundary decodes to U+FFFD but the offset never moves backward,
      // so the next poll resyncs.
      return { path: target, delta: buffer.toString('utf8'), offset: statInfo.size, gone: false }
    } finally {
      await handle.close()
    }
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
    // Cap teardown: each PTY terminate has a 2s grace, but a fan-out of N
    // stuck sessions must not hang the host on plugin unload. Race the
    // allSettled against an overall budget and let the OS reap the losers.
    const teardown = Promise.allSettled(records.map(record => record.handle.terminate()))
    await Promise.race([
      teardown,
      new Promise<void>((resolve) => { setTimeout(resolve, DISPOSE_BUDGET_MS).unref?.() }),
    ])
    // Detach from the in-flight settle so an unref'd timer leak doesn't build.
    void teardown.then(() => {})
  }
}

export default TerminalPanelService
