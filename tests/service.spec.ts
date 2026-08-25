import { afterEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { PassThrough } from 'node:stream'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import TerminalPanelService from '../src/index.ts'

/** Collect every live context so disposal assertions run per test. */
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  vi.restoreAllMocks()
})

/** A controllable stub terminal handle. */
function stubHandle(overrides: Partial<SubprocessTerminalHandle> = {}): SubprocessTerminalHandle {
  const output = new PassThrough()
  return {
    pid: 123,
    output,
    // Never settles by default, so the session stays `running` until a test
    // explicitly resolves a passed-in `done`.
    done: new Promise(() => {}),
    write: vi.fn(async () => {}),
    inspectForeground: vi.fn(async () => ({ processGroupId: 123, inputWaiting: true })),
    signalForeground: vi.fn(async () => 123),
    terminate: vi.fn(async () => { output.end() }),
    ...overrides,
  }
}

/** Mount a TerminalPanelService over a stub subprocess runtime. */
async function mountService(spawnTerminal = vi.fn(async () => stubHandle())) {
  const ctx = new Context()
  contexts.add(ctx)
  ctx.provide('subprocess', { spawnTerminal } as never)
  const service = new TerminalPanelService(ctx)
  return { ctx, service, spawnTerminal }
}

describe('TerminalPanelService', () => {
  it('spawns a PTY through the subprocess service and publishes a session', async () => {
    const { service, spawnTerminal } = await mountService()
    const result = await service.spawn({ argv: ['bash'], cwd: '/tmp', rows: 24, cols: 80 })
    expect(result.pid).toBe(123)
    expect(spawnTerminal).toHaveBeenCalledWith({
      argv: ['bash'],
      cwd: '/tmp',
      rows: 24,
      cols: 80,
      graceMs: 2_000,
    })
    const listed = await service.list()
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0]?.id).toBe(result.id)
    expect(listed.sessions[0]?.status).toEqual({ kind: 'running' })
  })

  it('defaults argv to the system login shell and cwd to the host cwd for an empty cwd', async () => {
    const { service, spawnTerminal } = await mountService()
    await service.spawn({ argv: [], cwd: '', rows: 10, cols: 40 })
    expect(spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      argv: [process.env.SHELL ?? '/bin/sh', '-c', 'export TERM=xterm-256color; exec "${SHELL:-/bin/sh}"'],
      cwd: process.cwd(),
    }))
  })

  it('keeps an explicit ~ as the user home directory', async () => {
    const { service, spawnTerminal } = await mountService()
    await service.spawn({ argv: [], cwd: '~', rows: 10, cols: 40 })
    expect(spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      cwd: homedir(),
    }))
  })

  it('wraps the default shell to force a real TERM so clear and prompt glyphs work', async () => {
    const { service, spawnTerminal } = await mountService()
    const result = await service.spawn({ argv: [], cwd: '', rows: 24, cols: 80 })
    const spec = spawnTerminal.mock.calls[0]?.[0] as { argv: string[] } | undefined
    // The harness forks PTYs with TERM=dumb (clear no-ops, zsh prints '?' for
    // prompt glyphs); the default spawn must export a real TERM before exec.
    expect(spec?.argv[0]).toBe(process.env.SHELL ?? '/bin/sh')
    expect(spec?.argv[1]).toBe('-c')
    expect(spec?.argv[2]).toContain('export TERM=xterm-256color')
    expect(spec?.argv[2]).toContain('exec "${SHELL:-/bin/sh}"')
    // The badge still names the user's shell, not the -c wrapper.
    expect(result.shell).toBe(basename(process.env.SHELL ?? '/bin/sh'))
  })

  it('reads output deltas with an advancing cursor', async () => {
    const output = new PassThrough()
    const { service } = await mountService(vi.fn(async () => stubHandle({ output })))
    const { id } = await service.spawn({ argv: ['bash'], cwd: '', rows: 24, cols: 80 })
    output.write('hello')
    output.write(' world')
    const first = service.read(id)
    expect(first.delta).toBe('hello world')
    const second = service.read(id)
    expect(second.delta).toBe('')
    expect(second.status).toEqual({ kind: 'running' })
  })

  it('writes text to the terminal, appending Enter when submit is true', async () => {
    const handle = stubHandle()
    const { service } = await mountService(vi.fn(async () => handle))
    const { id } = await service.spawn({ argv: ['bash'], cwd: '', rows: 24, cols: 80 })
    await service.write(id, 'echo hi', false)
    await service.write(id, 'ls', true)
    expect(handle.write).toHaveBeenNthCalledWith(1, 'echo hi')
    expect(handle.write).toHaveBeenNthCalledWith(2, 'ls\r')
  })

  it('signals the foreground process group', async () => {
    const handle = stubHandle()
    const { service } = await mountService(vi.fn(async () => handle))
    const { id } = await service.spawn({ argv: ['bash'], cwd: '', rows: 24, cols: 80 })
    const result = await service.signal(id, 'SIGINT')
    expect(handle.signalForeground).toHaveBeenCalledWith('SIGINT')
    expect(result).toEqual({ delivered: true, targetPgid: 123 })
  })

  it('terminates the session and reports exited status after done settles', async () => {
    let settleExit!: () => void
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      settleExit = () => resolve({ exitCode: 0, signal: null })
    })
    const handle = stubHandle({ done })
    const { service } = await mountService(vi.fn(async () => handle))
    const { id } = await service.spawn({ argv: ['bash'], cwd: '', rows: 24, cols: 80 })
    await service.terminate(id)
    expect(handle.terminate).toHaveBeenCalledTimes(1)
    settleExit()
    await done
    await vi.waitFor(() => {
      const listed = service.list()
      expect(listed.sessions[0]?.status).toEqual({ kind: 'exited', exitCode: 0, signal: null })
    })
  })

  it('rejects operations on unknown sessions', async () => {
    const { service } = await mountService()
    // `read` is synchronous and throws; the write/signal/terminate verbs are
    // async and reject.
    expect(() => service.read('missing')).toThrow('unknown session')
    await expect(service.write('missing', 'x', true)).rejects.toThrow('unknown session')
    await expect(service.signal('missing', 'SIGINT')).rejects.toThrow('unknown session')
    await expect(service.terminate('missing')).rejects.toThrow('unknown session')
  })

  it('dispose removes the record and terminates a still-running session', async () => {
    const handle = stubHandle()
    const { service } = await mountService(vi.fn(async () => handle))
    const { id } = await service.spawn({ argv: ['bash'], cwd: '', rows: 24, cols: 80 })
    await service.dispose(id)
    expect(handle.terminate).toHaveBeenCalledTimes(1)
    expect(service.list().sessions).toHaveLength(0)
    await expect(service.dispose(id)).resolves.toEqual({ ok: true })
  })

  it('terminates every session when the owning fiber disposes', async () => {
    const handle = stubHandle()
    const { ctx, service } = await mountService(vi.fn(async () => handle))
    await service.spawn({ argv: ['bash'], cwd: '', rows: 24, cols: 80 })
    await ctx.fiber.dispose()
    expect(handle.terminate).toHaveBeenCalledTimes(1)
  })

  it('reads text files as kind "text" and image files as a base64 data URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-devpanel-'))
    try {
      writeFileSync(join(dir, 'note.txt'), 'hello console')
      // Minimal 1x1 PNG so the image branch reads real bytes.
      writeFileSync(join(dir, 'dot.png'), Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]))
      const { service } = await mountService()

      const text = await service.readFile('note.txt', dir)
      expect(text.kind).toBe('text')
      expect(text.content).toBe('hello console')
      expect(text.dataUrl).toBeUndefined()

      const image = await service.readFile('dot.png', dir)
      expect(image.kind).toBe('image')
      expect(image.dataUrl).toMatch(/^data:image\/png;base64,/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects reading a missing file with the resolved path in the error', async () => {
    const { service } = await mountService()
    await expect(service.readFile('missing.txt', '/tmp')).rejects.toThrow(/missing\.txt/)
  })

  it('lists a directory with directories first, then files, alphabetically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-devpanel-'))
    try {
      mkdirSync(join(dir, 'zeta'))
      mkdirSync(join(dir, 'alpha'))
      writeFileSync(join(dir, 'b.txt'), '')
      writeFileSync(join(dir, 'a.txt'), '')
      const { service } = await mountService()
      const listing = await service.listDir('', dir)
      expect(listing.path).toBe(dir)
      // Directories (alpha, zeta) sort before files (a.txt, b.txt); each
      // group is alphabetical.
      expect(listing.entries.map(entry => entry.name)).toEqual([
        'alpha', 'zeta', 'a.txt', 'b.txt',
      ])
      expect(listing.entries[0]?.kind).toBe('dir')
      expect(listing.entries[3]?.kind).toBe('file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists the user home for a ~ path and rejects a missing directory', async () => {
    const { service } = await mountService()
    const home = await service.listDir('~')
    expect(home.path).toBe(homedir())
    await expect(service.listDir('no-such-dir', '/tmp')).rejects.toThrow(/no-such-dir/)
  })

  it('tails a file incrementally from a byte offset and reports a gone file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-devpanel-'))
    try {
      writeFileSync(join(dir, 'app.log'), 'line one\n')
      const { service } = await mountService()

      // First read replays the whole file and returns the next offset.
      const first = await service.readTail('app.log', dir, 0)
      expect(first.delta).toBe('line one\n')
      expect(first.offset).toBe(9)
      expect(first.gone).toBe(false)

      // Appending more bytes yields only the delta after the previous offset.
      appendFileSync(join(dir, 'app.log'), 'line two\n')
      const second = await service.readTail('app.log', dir, first.offset)
      expect(second.delta).toBe('line two\n')
      expect(second.offset).toBe(18)
      expect(second.gone).toBe(false)

      // No new bytes → empty delta with a stable offset.
      const idle = await service.readTail('app.log', dir, second.offset)
      expect(idle.delta).toBe('')
      expect(idle.offset).toBe(18)

      // A vanished file reports gone instead of throwing, so the UI stops.
      rmSync(join(dir, 'app.log'))
      const gone = await service.readTail('app.log', dir, second.offset)
      expect(gone.gone).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
