// @vitest-environment jsdom
/**
 * Regression: PTY output arrives as UTF-8 BYTES in arbitrary chunks
 * (SubprocessTerminalHandle.output is a byte Readable). Multi-byte characters
 * that straddle two chunks must survive intact — per-chunk toString() would
 * decode each half as U+FFFD, painting "?" where a prompt glyph belongs.
 * Also guards the escape-sequence path (`clear`) stays raw end-to-end.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { Terminal } from '@xterm/xterm'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import TerminalPanelService from '../src/index.ts'

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// xterm v6 open() calls window.matchMedia; jsdom lacks it.
window.matchMedia = (() => ({
  matches: false,
  media: '',
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as never

const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountService(output: PassThrough): Promise<TerminalPanelService> {
  const ctx = new Context()
  contexts.add(ctx)
  const handle: SubprocessTerminalHandle = {
    pid: 123,
    output,
    done: new Promise(() => {}),
    write: vi.fn(async () => {}),
    inspectForeground: vi.fn(async () => ({ processGroupId: 123, inputWaiting: true })),
    signalForeground: vi.fn(async () => 123),
    terminate: vi.fn(async () => { output.end() }),
  }
  ctx.provide('subprocess', { spawnTerminal: vi.fn(async () => handle) } as never)
  return new TerminalPanelService(ctx)
}

describe('terminal output handling', () => {
  it('preserves multi-byte UTF-8 characters split across output chunks', async () => {
    const output = new PassThrough()
    const service = await mountService(output)
    const { id } = await service.spawn({ argv: ['zsh'], cwd: '', rows: 24, cols: 80 })
    // '❯' (U+276F) is 3 bytes (E2 9D AF); split it mid-character across chunks.
    const bytes = Buffer.from('❯ test\r\n')
    output.write(bytes.subarray(0, 1))
    output.write(bytes.subarray(1))
    const { delta } = service.read(id)
    expect(delta).toBe('❯ test\r\n')
    expect(delta).not.toContain('\uFFFD')
  })

  it('keeps the clear escape sequence raw in the delta', async () => {
    const output = new PassThrough()
    const service = await mountService(output)
    const { id } = await service.spawn({ argv: ['zsh'], cwd: '', rows: 24, cols: 80 })
    output.write('one\r\ntwo\r\n')
    output.write('\x1b[H\x1b[2J')
    const { delta } = service.read(id)
    expect(delta).toBe('one\r\ntwo\r\n\x1b[H\x1b[2J')
  })

  it('a real xterm clears its buffer on the macOS clear sequence', async () => {
    const output = new PassThrough()
    const service = await mountService(output)
    const { id } = await service.spawn({ argv: ['zsh'], cwd: '', rows: 24, cols: 80 })

    const terminal = new Terminal({ rows: 5, cols: 20, scrollback: 5000 })
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    terminal.open(mount)

    output.write('one\r\ntwo\r\n')
    terminal.write(service.read(id).delta)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(terminal.buffer.active.getLine(1)?.translateToString()).toContain('two')

    // macOS /usr/bin/clear emits \x1b[3J\x1b[H\x1b[2J (E3 + home + ED2).
    output.write('\x1b[3J\x1b[H\x1b[2J')
    terminal.write(service.read(id).delta)
    await new Promise(resolve => setTimeout(resolve, 50))
    const after = terminal.buffer.active
    expect(after.cursorY).toBe(0)
    expect(after.getLine(0)?.translateToString().trim()).toBe('')
  })

  it('keeps the real robbyrussell prompt glyph intact at every chunk split', async () => {
    // Bytes captured from an actual zsh (oh-my-zsh robbyrussell) PTY prompt:
    //   \x1b[J\x1b[01;32m➜  \x1b[36m/tmp\x1b[00m \x1b[K
    // The '➜' (U+279C) is 3 bytes (E2 9E 9C). Split the byte stream at EVERY
    // possible position and verify the arrow survives (no U+FFFD anywhere).
    const prompt = Buffer.from('\x1b[J\x1b[01;32m➜  \x1b[36m/tmp\x1b[00m \x1b[K')
    for (let split = 1; split < prompt.length; split++) {
      const output = new PassThrough()
      const service = await mountService(output)
      const { id } = await service.spawn({ argv: ['zsh'], cwd: '', rows: 24, cols: 80 })
      output.write(prompt.subarray(0, split))
      output.write(prompt.subarray(split))
      const { delta } = service.read(id)
      expect(delta).not.toContain('\uFFFD')
      expect(delta).toContain('➜')
      expect(delta).toBe(prompt.toString('utf-8'))
    }
  })

  it('keeps the real clear sequence intact at every chunk split and clears xterm', async () => {
    const clearSeq = Buffer.from('\x1b[3J\x1b[H\x1b[2J')
    for (let split = 1; split < clearSeq.length; split++) {
      const output = new PassThrough()
      const service = await mountService(output)
      const { id } = await service.spawn({ argv: ['zsh'], cwd: '', rows: 24, cols: 80 })
      output.write('one\r\ntwo\r\n')
      output.write(clearSeq.subarray(0, split))
      output.write(clearSeq.subarray(split))
      const { delta } = service.read(id)
      expect(delta).toBe('one\r\ntwo\r\n' + clearSeq.toString('utf-8'))
      expect(delta).not.toContain('\uFFFD')

      const terminal = new Terminal({ rows: 5, cols: 20, scrollback: 5000 })
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      terminal.open(mount)
      terminal.write(delta)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(terminal.buffer.active.cursorY).toBe(0)
      expect(terminal.buffer.active.getLine(0)?.translateToString().trim()).toBe('')
    }
  })
})
