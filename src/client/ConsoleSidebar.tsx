/**
 * Right-side file viewer: the details-column entry for dsh-devpanel. Lists the
 * files the current session's AI output touched — write/edit tool calls and
 * diffs, PLUS files created or modified by shell commands (paths extracted
 * from the shell tools' model-facing command arguments and their captured
 * result content, verified against the host filesystem) — and shows the
 * selected file's content in the browser through
 * the terminalPanel readFile Remote. Renders inside the harness layout's
 * right details column (inline, non-floating, squeezes the center column) and
 * is driven by the shared store; while closed it renders nothing but stays
 * mounted (slot entries keep identity).
 * @module dsh-devpanel/client/ConsoleSidebar
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeBlock, DiffBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the 'sidebar.right.pane.tab' SlotMap row (declared by
// ui-sidebar-right) into this program so PropsRuntime resolves.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the Session-standard props (sessionId, useSession,
// useSessions) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the Session-standard `useConversation` (and its snapshot
// vocabulary) into this program so the sidebar can read the Chat target.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the Chat target's `useChat` standard prop and the Chat
// snapshot/node vocabulary (ChatSnapshot, ChatNodeStore rows, ToolCallBlock).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ConsoleListDirResult, ConsoleReadFileResult } from '../types.ts'
import type { ConsolePanelState } from './console-store.ts'
import { activeTerminalFor } from './console-store.ts'
import type { TerminalPanelFace } from './TerminateDialog.tsx'
import { NS, type ConsoleKey } from './locales.ts'

/** Injected business face of the sidebar. */
export interface ConsoleSidebarInjected {
  /** Shared open state; the header button renders its pressed state from this. */
  store: SnapshotStore<ConsolePanelState>
  /** The mounted terminalPanel Remote namespace (file content reads). */
  terminalPanel: TerminalPanelFace
}

/** Full component props: the right-Sidebar tab seat + locale seat + injected face. */
export type ConsoleSidebarProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & ConsoleSidebarInjected

/** One selectable file entry. */
interface FileEntry {
  /** The model-facing path as surfaced in the session. */
  path: string
  /** Display name (the last path segment). */
  name: string
}

/** A diff block's applied hunk (the shape the harness DiffBlock draws). */
interface DiffHunk {
  path: string
  oldText: string | null
  newText: string
}

/** Per-file with-edits: the artifact list plus each file's applied hunks. */
interface SessionArtifacts {
  /** De-duplicated write/edit artifacts in first-seen order. */
  files: FileEntry[]
  /** Every applied hunk, keyed by file path, in first-seen order. */
  history: Map<string, DiffHunk[]>
}

/**
 * Pull the file path out of a tool call's raw JSON args: the write/edit
 * family all carry a `path` (or `file_path`) argument. Returns the first
 * string-valued path found, or null.
 * @param argsRaw - the tool call's raw arguments JSON.
 * @returns the argument path, or null when absent/not a string.
 */
function pathFromArgs(argsRaw: string): string | null {
  if (argsRaw === '') return null
  try {
    const args = JSON.parse(argsRaw) as unknown
    if (typeof args !== 'object' || args === null) return null
    const candidate = (args as Record<string, unknown>)
    for (const key of ['path', 'file_path', 'filePath']) {
      const value = candidate[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return null
  } catch {
    return null
  }
}

/** Tool names that CREATE or MODIFY files — the only artifact producers. */
const WRITE_EDIT_TOOLS = new Set(['write', 'edit'])

/**
 * Visit every tool-call root the Chat target exposes — each materialized
 * `tool-call` row of the Chat node store (a running or settled root) plus
 * each flat `tool-result` row of the legacy compatibility projection the
 * store rows do not cover — and walk nested subCalls in dispatch order.
 * callId de-duplicates blocks that appear both nested under a root and as
 * their own projected row.
 * @param snapshot - the Chat snapshot (via the current Conversation view).
 * @param visit - per-block visitor.
 */
function forEachToolBlock(snapshot: ChatSnapshot | undefined, visit: (block: ToolCallBlock) => void): void {
  if (snapshot === undefined) return
  const visited = new Set<string>()
  const walk = (block: ToolCallBlock): void => {
    if (visited.has(block.callId)) return
    visited.add(block.callId)
    visit(block)
    for (const child of block.subCalls) walk(child)
  }
  for (const node of snapshot.nodes.values()) {
    if (node.kind !== 'tool-call') continue
    // The ChatNodeDataMap row for 'tool-call' lives in ui-chat's declaration
    // merging; narrow the union here.
    const root = (node as { data: { root: ToolCallBlock } }).data.root
    walk(root)
  }
  for (const node of snapshot.legacy.nodes) {
    // Settled tool rows only: a running call has no legacy projection, and
    // the recursion above already visited roots (and nested children) that
    // the store materialized.
    if (node.kind !== 'tool-result') continue
    walk(node)
  }
}

/**
 * Extract the file ARTIFACTS a session's nodes produced — the write/edit
 * family only, PLUS the applied hunk history for each file. Walks every
 * materialized tool-call root in the Chat target and keeps only write/edit
 * signals: the raw-args `path` of write/edit calls, and the diff hunks a
 * settled mutation result carries. The harness no longer rides presentation
 * views on the nodes, so card intent is derived from the tool NAME and the
 * model-facing result blocks; read/search calls never enter the list. Each
 * hunk's `oldText`/`newText` is recorded in first-seen order so the sidebar
 * can render a version diff.
 * @param snapshot - the current Chat snapshot.
 * @returns the de-duplicated artifact list and per-file hunk history.
 */
export function collectArtifacts(snapshot: ChatSnapshot | undefined): SessionArtifacts {
  const seen = new Set<string>()
  const files: FileEntry[] = []
  const history = new Map<string, DiffHunk[]>()
  const record = (hunk: DiffHunk): void => {
    if (hunk.path === '' || seen.has(hunk.path)) return
    seen.add(hunk.path)
    files.push({ path: hunk.path, name: hunk.path.split('/').pop() ?? hunk.path })
    history.set(hunk.path, [hunk])
  }
  const append = (hunk: DiffHunk): void => {
    const list = history.get(hunk.path)
    if (list === undefined) record(hunk)
    else list.push(hunk)
  }
  const absorb = (diffs: DiffHunk[] | undefined): void => {
    if (diffs === undefined) return
    for (const hunk of diffs) {
      if (hunk.oldText === null && hunk.newText === '') {
        // A pure deletion with no added side still names the file.
        record(hunk)
      } else {
        append(hunk)
      }
    }
  }
  const visitBlock = (block: ToolCallBlock): void => {
    const raw = blockArgsRaw(block)
    const name = blockName(block)
    if (WRITE_EDIT_TOOLS.has(name)) {
      // Raw-args fallback: write/edit tools carry a path argument; only their
      // names count, so a read call's path never leaks into the artifact list.
      const fromArgs = pathFromArgs(raw)
      if (fromArgs !== null) record({ path: fromArgs, oldText: null, newText: '' })
      // A settled mutation returns hunks in its result content: the edit tool
      // (and family) names the file(s) it changed. Non-mutation tools (bash
      // and friends) never enter the artifact list, whatever their result text
      // says — a shell tool's single-line notice is NOT a file path.
      const settle = 'content' in block ? block.content : undefined
      const diffs = mutationDiffsFrom(settle)
      if (diffs !== undefined) absorb(diffs)
    }
  }
  // Traversal (roots + nested subCalls) lives in forEachToolBlock.
  forEachToolBlock(snapshot, visitBlock)
  return { files, history }
}

/**
 * Extract applied diff hunks from one settled tool-result block. The harness
 * no longer attaches a `diff` result view to the node, so the plugin parses
 * the model-facing text envelope the mutation tools emit: a verbatim patch
 * when the result is a unified diff, otherwise a bare-text fallback that
 * names a single changed file — but ONLY when the text is the mutation
 * envelope ("The file X has been created/updated."). Arbitrary single-line
 * results (a shell tool's todo notice, echoed prose) are not file paths and
 * are ignored.
 * @param content - the settled tool result's content blocks.
 * @returns the applied hunks, or undefined when the result carries none.
 */
function mutationDiffsFrom(content: readonly ContentBlock[] | undefined): DiffHunk[] | undefined {
  if (content === undefined || content.length !== 1) return undefined
  const block = content[0]
  if (block === undefined || block.type !== 'text') return undefined
  const text = block.text
  if (text.startsWith('--- ') && text.includes('\n+++ ')) {
    return hunksFromPatch(text)
  }
  // The envelope must actually match — never fall through with arbitrary text.
  if (!/^The file .* has been (?:created|updated)\.?\s*$/.test(text)) return undefined
  const raw = text.replace(/^The file .* has been (?:created|updated)\.?\s*/i, '').trim()
  const path = pathFromArgs(JSON.stringify({ path: raw }))
  if (path === null || path === '') return undefined
  return [{ path, oldText: null, newText: '' }]
}

/**
 * Convert a unified diff text into per-file hunks. A whole-file create patch
 * carries no `---`/`+++` headers, so it is treated as one add-side hunk.
 * @param patch - the result's unified-diff text.
 * @returns one hunk per changed file.
 */
function hunksFromPatch(patch: string): DiffHunk[] {
  const files: DiffHunk[] = []
  const lines = patch.split('\n')
  const delimiters = new Set(['--- ', '+++ ', '@@', 'diff --git '])
  let current: { path: string; old: string[]; added: string[] } | null = null
  const flush = (): void => {
    if (current === null) return
    files.push({
      path: current.path,
      oldText: current.old.length > 0 ? current.old.join('\n') : null,
      newText: current.added.join('\n'),
    })
    current = null
  }
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      flush()
      const target = line.slice(4).replace(/\s+\(revision.*\)$/, '')
      // A '/dev/null' old side is a whole-file create: the trailing '+++ ' line names it.
      current = { path: target === '/dev/null' ? '' : target, old: [], added: [] }
      continue
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/\s+\(revision.*\)$/, '')
      if (target !== '/dev/null' && current !== null) current.path = target
      continue
    }
    if (current === null) {
      // Whole-file create: no hunk header — the sole text names the file.
      if (!delimiters.has(line.trimStart().slice(0, 4)) && line.includes('.') && !line.includes(' ')) {
        current = { path: line.trim(), old: [], added: [] }
      }
      continue
    }
    if (line.startsWith('@@')) continue
    if (line.startsWith('+') && !line.startsWith('+++')) current.added.push(line.slice(1))
    else if (line.startsWith('-') && !line.startsWith('---')) current.old.push(line.slice(1))
    else if (line === '\\ No newline at end of file') continue
    else { current.old.push(line); current.added.push(line) }
  }
  flush()
  return files.filter(hunk => hunk.path !== '')
}

/** A file path mentioned by a shell command or its output, not yet verified. */
interface ShellCandidate {
  /** The path exactly as it appeared; relative paths resolve against `base`. */
  path: string
  /** Base directory for a relative path; undefined means the session workspace. */
  base: string | undefined
  /** Host-clock epoch ms of the producing tool call (the mtime window's floor). */
  time: number
  /** Host-clock epoch ms of the settled result (the mtime window's ceiling). */
  end?: number
}

/** Slack (ms) around the tool-call window, absorbing mtime/clock granularity. */
const MTIME_WINDOW_SLACK_MS = 2_000

/**
 * Whether a tool-card cwd is already absolute (`/…`, `~…`, a UNC path, or a
 * Windows drive). A RELATIVE card cwd is resolved by the UI bridge against the
 * session workspace, so it resolves to the same base the session supplies.
 */
function isAbsolutePathish(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~') || path.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * Pull file-path candidates out of one shell command or its captured output.
 * Tokens are split on whitespace and shell punctuation; flags, URLs, globs,
 * and shell/environment expansions are dropped; a survivor must carry a path
 * separator or a plausible file extension. Extraction is deliberately
 * aggressive — every candidate is later verified against the host filesystem
 * (existence + mtime window) before it reaches the artifact list.
 * @param text - the command line or the command output to scan.
 * @returns unique candidate paths in first-seen order.
 */
export function pathsFromText(text: string): string[] {
  const found: string[] = []
  for (const raw of text.split(/[\s'"`()[\]{};,|<>&]+/)) {
    let token = raw
    // A flag's inline value stays a candidate: --output=clip.mp4 -> clip.mp4.
    if (token.startsWith('-')) {
      const eq = token.indexOf('=')
      if (eq <= 0) continue
      token = token.slice(eq + 1)
    }
    // Skip URLs, globs, and shell/environment expansions outright.
    if (token === '' || token.includes('://') || /[*?$%]/.test(token)) continue
    // Trailing sentence punctuation is not part of the path.
    token = token.replace(/[.,:;!?]+$/, '')
    // A trailing separator names a directory, not a file.
    if (token === '' || /[\\/]$/.test(token)) continue
    const dot = token.lastIndexOf('.')
    const hasExt = dot > 0 && /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(token.slice(dot + 1))
    if (!/[\\/]/.test(token) && !hasExt) continue
    if (!found.includes(token)) found.push(token)
  }
  return found
}

/** Tool names that RUN a foreground shell command — shell-artifact producers. */
const SHELL_TOOLS = new Set(['bash', 'pwsh'])

/** Shell tools whose command comes from a `command` argument (bash/pwsh). */
function shellCommandFrom(args: Record<string, unknown> | null): string | undefined {
  if (args === null) return undefined
  const command = args.command
  return typeof command === 'string' ? command : undefined
}

/**
 * Shell programs that only READ files: their path mentions are sources, never
 * products. A bash call running one of these (cat/head/grep of a log) must not
 * register the files it merely read — the mtime window alone cannot tell a
 * quoted-but-fresh file (a log some other process keeps appending) from a real
 * command product.
 */
const READER_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'awk', 'sed',
  'find', 'ls', 'stat', 'file', 'du', 'df', 'wc', 'echo', 'printf', 'env',
  'export', 'type', 'which', 'whereis', 'whoami', 'id', 'pwd', 'uname', 'date',
  'man', 'diff', 'cmp', 'strings', 'md5', 'md5sum', 'shasum', 'sha1sum',
  'sha256sum', 'sort', 'uniq', 'cut', 'tr', 'jq',
  // PowerShell read aliases (lower-cased).
  'get-content', 'select-string', 'get-item', 'get-childitem', 'write-output',
])

/** Strip leading `cd <dir> &&|;` chains (bounded) and common wrappers. */
function unwrapShellPrefix(command: string): string {
  let text = command.trim()
  for (let depth = 0; depth < 3; depth += 1) {
    const cd = /^cd\s+[^\s&;]+(\s*&&|\s*;)\s*/.exec(text)
    if (cd !== null) { text = text.slice(cd[0].length).trim(); continue }
    const wrapper = /^(sudo|env|time|nohup|command|builtin)\s+/.exec(text)
    if (wrapper !== null) { text = text.slice(wrapper[0].length).trim(); continue }
    break
  }
  return text
}

/** The leading program of a shell command (first word, lower-cased). */
function shellProgram(command: string): string {
  const first = unwrapShellPrefix(command).split(/\s+/)[0] ?? ''
  return first.replace(/^['"]|['"]$/g, '').toLowerCase()
}

/** Whether the command writes files in place (`sed -i`, `perl -i`): its file
 *  arguments ARE the products. */
function hasInPlaceFlag(text: string): boolean {
  return /\s-i(?:$|\s)|\s--in-place(?:\s|=)/.test(text)
}

/** Whether the command text carries an output redirection or a `tee`. */
function hasWriteSide(text: string): boolean {
  return /(?:^|[;&|\s(])(?:>>|[12&]?>)|(?:^|[;&|\s(])>|\btee\b/.test(text)
}

/**
 * The write policy for one shell command line.
 * - 'none': a pure reader (no redirection) — it produced nothing; drop every
 *   candidate, including the paths its echoed output merely quotes.
 * - 'targets': a reader with a redirection/`tee` write side — only the write
 *   targets can be products.
 * - 'all': a producer or unknown program — scan the command and its output.
 */
export function commandWritePolicy(command: string): 'none' | 'targets' | 'all' {
  if (hasInPlaceFlag(command)) return 'all'
  if (READER_COMMANDS.has(shellProgram(command))) {
    return hasWriteSide(command) ? 'targets' : 'none'
  }
  return 'all'
}

/**
 * Pull only the WRITE-side path tokens out of a command line: the targets of
 * redirections (`>`, `>>`, `1>`, `2>`, `&>`) and of `tee`. Read sources
 * (`cat a > b` names `a` too) are left out.
 * @param text - the command line.
 * @returns unique target candidates in first-seen order.
 */
export function writeTargetsFrom(text: string): string[] {
  const found: string[] = []
  const tokens = text.split(/\s+/)
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    const operator = /^>>|^[12&]?>/.exec(token)
    // Redirection operators optionally glue their target (`>out.txt`); `tee`
    // takes its target as the next token.
    const head = operator !== null ? operator[0].length : token === 'tee' ? token.length : -1
    if (head < 0) continue
    const rest = token.slice(head)
    const target = rest !== '' && rest !== '&1' ? rest : tokens[i + 1]
    if (target === undefined || target.trim() === '') continue
    for (const path of pathsFromText(target)) {
      if (!found.includes(path)) found.push(path)
    }
  }
  return found
}

/** Settled call head (name + raw args), or null for a running call. */
function settledHead(block: ToolCallBlock): { name: string; argsRaw: string; callTime: number } | null {
  if (!('call' in block)) return null
  const call = block.call
  if (call === null) return null
  const time = block.callTime ?? block.time
  return { name: call.name, argsRaw: call.argsRaw, callTime: time }
}

/**
 * The call's tool name. A settled row keeps its head on `call`; a running call
 * carries the name directly, whether or not its arguments have been dispatched.
 * @param block - one tool-call lifecycle value.
 * @returns the tool name, or '' when a truncated window left the head out.
 */
function blockName(block: ToolCallBlock): string {
  return 'call' in block ? block.call?.name ?? '' : block.name
}

/**
 * Model-facing raw arguments. 0.2 splits a running call into `preparing` (named,
 * arguments not yet visible) and `start` (arguments dispatched), so only the
 * latter exposes `argsRaw`.
 * @param block - one tool-call lifecycle value.
 * @returns the raw arguments, or '' before they are dispatched.
 */
function blockArgsRaw(block: ToolCallBlock): string {
  if ('call' in block) return block.call?.argsRaw ?? ''
  return block.phase === 'start' ? block.argsRaw : ''
}

/** All text blocks of a settled result's content. */
function resultTexts(block: ToolCallBlock): string[] {
  if (!('content' in block)) return []
  const texts: string[] = []
  for (const part of block.content) {
    if (part.type === 'text') texts.push(part.text)
  }
  return texts
}

/** The `cwd` the tool itself declares (bash runs under the workspace by default). */
function toolCwd(block: ToolCallBlock): string | undefined {
  if (!('call' in block)) return undefined
  const call = block.call
  if (call === null) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as unknown
    if (typeof args === 'object' && args !== null) {
      const cwd = (args as Record<string, unknown>).cwd
      if (typeof cwd === 'string' && isAbsolutePathish(cwd)) return cwd
    }
  } catch {
    // Malformed args: fall through to the session workspace.
  }
  return undefined
}

/**
 * Collect file-path candidates from the session's shell tool calls — the
 * `bash`/`pwsh` tools whose model-facing arguments carry a `command`, plus
 * the command's captured result output. Shell-created binaries
 * (video/audio/archives) surface here, so the media previews become
 * reachable. Read-only commands (cat/head/grep of a log) produce nothing, so
 * their file mentions are dropped outright — echoed output only quotes
 * sources. The host-side existence + mtime window check rejects whatever
 * still slips through.
 * @param snapshot - the current Chat snapshot.
 * @returns unverified candidates in call-dispatch order.
 */
export function collectShellCandidates(snapshot: ChatSnapshot | undefined): ShellCandidate[] {
  const candidates: ShellCandidate[] = []
  const visitBlock = (block: ToolCallBlock): void => {
    const runningName = !('call' in block) ? block.name : null
    const runningRaw = !('call' in block) && block.phase === 'start' ? block.argsRaw : null
    const settled = settledHead(block)
    const name = settled?.name ?? runningName ?? ''
    const raw = settled?.argsRaw ?? runningRaw ?? ''
    if (SHELL_TOOLS.has(name)) {
      let args: Record<string, unknown> | null = null
      try {
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>
      } catch {
        // Mid-stream truncation: rely on the command line alone.
      }
      // The mtime window spans CALL to RESULT: files land while the command
      // runs, and the result bounds when it finished. A still-running call has
      // no ceiling yet; a settled result whose paired call was window-truncated
      // falls back to its own time for the floor.
      const time = settled?.callTime ?? block.time
      const end = settled === null ? undefined : block.time
      const base = toolCwd(block)
      const command = shellCommandFrom(args)
      const policy = command === undefined ? 'all' : commandWritePolicy(command)
      if (policy !== 'none') {
        const push = (path: string): void => {
          candidates.push({ path, base, time, ...(end === undefined ? {} : { end }) })
        }
        if (command !== undefined) {
          const fromCommand = policy === 'targets' ? writeTargetsFrom(command) : pathsFromText(command)
          for (const path of fromCommand) push(path)
        }
        // A reader's captured output only echoes its sources; the write side of
        // a targets-only command was already collected above.
        if (policy === 'all') {
          for (const text of resultTexts(block)) {
            for (const path of pathsFromText(text)) push(path)
          }
        }
      }
    }
  }
  // Traversal (roots + nested subCalls) lives in forEachToolBlock.
  forEachToolBlock(snapshot, visitBlock)
  return candidates
}

/** Single-quote-shell quote a path so spaces/globs stay literal. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Code-language hint for a file path, or undefined for plain text. */
function codeLangOf(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': return 'ts'
    case 'tsx': return 'tsx'
    case 'js': return 'js'
    case 'jsx': return 'jsx'
    case 'json': return 'json'
    case 'css': return 'css'
    case 'html': return 'html'
    case 'py': return 'python'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'yaml': return 'yaml'
    case 'yml': return 'yaml'
    case 'toml': return 'toml'
    case 'sh': return 'bash'
    case 'bash': return 'bash'
    case 'zsh': return 'bash'
    case 'md': return 'markdown'
    case 'mdx': return 'markdown'
    case 'sql': return 'sql'
    case 'java': return 'java'
    case 'c': return 'c'
    case 'cpp': return 'cpp'
    case 'h': return 'cpp'
    case 'rb': return 'ruby'
    case 'php': return 'php'
    case 'xml': return 'xml'
    case 'svg': return 'xml'
    case 'vue': return 'vue'
    case 'svelte': return 'svelte'
    case 'kt': return 'kotlin'
    case 'kts': return 'kotlin'
    case 'swift': return 'swift'
    case 'dart': return 'dart'
    case 'lua': return 'lua'
    case 'cs': return 'csharp'
    case 'scala': return 'scala'
    case 'pl': return 'perl'
    case 'pm': return 'perl'
    case 'r': return 'r'
    case 'ps1': return 'powershell'
    case 'hs': return 'haskell'
    case 'ex': return 'elixir'
    case 'exs': return 'elixir'
    case 'clj': return 'clojure'
    case 'cljs': return 'clojure'
    case 'groovy': return 'groovy'
    case 'gradle': return 'gradle'
    case 'ini': return 'ini'
    case 'conf': return 'ini'
    default: return undefined
  }
}

/** Human-readable byte size for the binary-file notice. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    value /= 1024
    unit = next
    if (value < 1024) break
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

/**
 * Per-chat-session sidebar panel state: the file each session last opened,
 * plus the browse mode and expanded directories it was viewed in. Strict
 * session-scope slots REMOUNT per session (key=sessionId), so the component's
 * useState resets on every switch — the state survives here and is restored
 * when the session's sidebar opens again.
 */
const sidebarSelections = new Map<string, {
  active: string | null
  browse: boolean
  expanded: string[]
  dismissed: string[]
}>()

/**
 * Render one read file: media (image/pdf/audio/video) natively, markdown
 * rendered, code highlighted, a binary notice, else plain text.
 */
function FileBody({ result, t }: { result: ConsoleReadFileResult; t: (key: ConsoleKey) => string }) {
  if (result.kind === 'image' && result.dataUrl !== undefined) {
    return (
      <div className="dsh-devpanel-file-image">
        <img src={result.dataUrl} alt={result.path} />
      </div>
    )
  }
  if (result.kind === 'pdf' && result.dataUrl !== undefined) {
    return (
      <div className="dsh-devpanel-file-pdf">
        <iframe src={result.dataUrl} title={result.path} />
      </div>
    )
  }
  if (result.kind === 'audio' && result.dataUrl !== undefined) {
    return (
      <div className="dsh-devpanel-file-audio">
        <audio controls src={result.dataUrl} />
      </div>
    )
  }
  if (result.kind === 'video' && result.dataUrl !== undefined) {
    return (
      <div className="dsh-devpanel-file-video">
        <video controls src={result.dataUrl} />
      </div>
    )
  }
  if (result.kind === 'binary') {
    return (
      <div className="dsh-devpanel-file-binary">
        <p className="dsh-devpanel-file-binary-title">{t('sidebar.binary')}</p>
        <p className="dsh-devpanel-file-binary-hint">{t('sidebar.binaryHint')}</p>
        <p className="dsh-devpanel-file-binary-size">{t('sidebar.binarySize')}: {formatSize(result.size ?? 0)}</p>
      </div>
    )
  }
  const ext = result.path.split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'mdx') {
    return (
      <div className="dsh-devpanel-file-markdown">
        <MarkdownText
          text={result.content}
          fileMentions={undefined}
          labels={{ code: { copyLabel: t('sidebar.copy'), copiedLabel: t('sidebar.copied') }, footnotes: '' }}
        />
      </div>
    )
  }
  const lang = codeLangOf(result.path)
  if (lang !== undefined) {
    return (
      <div className="dsh-devpanel-file-code">
        <CodeBlock code={result.content} lang={lang} copyLabel={t('sidebar.copy')} copiedLabel={t('sidebar.copied')} />
      </div>
    )
  }
  return <pre className="dsh-devpanel-file-content">{result.content}</pre>
}

/** One lazily-loaded directory listing in the tree cache. */
interface DirCacheEntry {
  state: 'loading' | 'ready' | 'error'
  result?: ConsoleListDirResult
  error?: string
}

/** Tree props shared by every node (driven from the sidebar's state). */
interface DirTreeProps {
  path: string
  name: string
  depth: number
  terminalPanel: TerminalPanelFace
  sessionCwd: string | undefined
  cache: ReadonlyMap<string, DirCacheEntry>
  loadDir: (path: string) => void
  expanded: ReadonlySet<string>
  toggleDir: (path: string) => void
  onFile: (path: string) => void
  onOpenDir: (path: string) => void
  t: ConsoleSidebarProps['t']
}

/** One directory node: a toggle row that lazily lists its children on expand. */
function DirNode({ path, name, depth, terminalPanel, sessionCwd, cache, loadDir, expanded, toggleDir, onFile, onOpenDir, t }: DirTreeProps) {
  const entry = cache.get(path)
  const isOpen = expanded.has(path)
  const children = entry?.state === 'ready' ? entry.result?.entries ?? [] : []
  const childProps = {
    terminalPanel, sessionCwd, cache, loadDir, expanded, toggleDir, onFile, onOpenDir, t,
  }
  // Open body: loading / error / empty / children rows (computed as a plain
  // value so the JSX keeps one flat `{body}` slot instead of nested ternaries).
  let body: React.JSX.Element | null = null
  if (isOpen) {
    if (entry === undefined || entry.state === 'loading') {
      body = <div className="dsh-devpanel-tree-status" style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}>{t('sidebar.browse.loading')}</div>
    } else if (entry.state === 'error') {
      body = <div className="dsh-devpanel-tree-status dsh-devpanel-tree-error" style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}>{entry.error ?? t('sidebar.browse.error')}</div>
    } else if (children.length === 0) {
      body = <div className="dsh-devpanel-tree-status" style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}>{t('sidebar.browse.empty')}</div>
    } else {
      body = (
        <>
          {children.map(child => child.kind === 'dir'
            ? <DirNode key={child.name} {...childProps} path={`${path}/${child.name}`} name={child.name} depth={depth + 1} />
            : (
              <button
                key={child.name}
                type="button"
                className="dsh-devpanel-tree-row dsh-devpanel-tree-file"
                data-depth={depth + 1}
                style={{ '--dsh-tree-depth': depth + 1 } as React.CSSProperties}
                onClick={() => onFile(`${path}/${child.name}`)}
                title={`${path}/${child.name}`}
              >
                <span className="dsh-devpanel-tree-caret" />
                <span className="dsh-devpanel-tree-name">{child.name}</span>
              </button>
            ))}
        </>
      )
    }
  }
  return (
    <div className="dsh-devpanel-tree">
      <div className="dsh-devpanel-tree-row dsh-devpanel-tree-dirrow"
        data-depth={depth}
        style={{ '--dsh-tree-depth': depth } as React.CSSProperties}
        title={path}
      >
        <button
          type="button"
          className="dsh-devpanel-tree-toggle"
          onClick={() => {
            toggleDir(path)
            if (!isOpen && entry === undefined) loadDir(path)
          }}
        >
          <span className="dsh-devpanel-tree-caret">{isOpen ? '▾' : '▸'}</span>
          <span className="dsh-devpanel-tree-name">{name}</span>
        </button>
        <button
          type="button"
          className="dsh-devpanel-tree-open"
          aria-label={t('sidebar.enterDir')}
          title={t('sidebar.enterDir')}
          onClick={() => { onOpenDir(path) }}
        >
          &gt;_
        </button>
      </div>
      {body}
    </div>
  )
}

/**
 * Render the file viewer in the right details column.
 * @param props - details standard kit (useSession), locale seat, injected face.
 * @returns the viewer while open, null while closed.
 */
export function ConsoleSidebar({ store, terminalPanel, useTabInfo, useConversation, useSessions, sessionId, t }: ConsoleSidebarProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { tab } = useTabInfo()
  // The right Sidebar owns whether this panel is shown: its tab's visibility
  // replaces the old details-column flag as the gate for the polling effects
  // below (and makes a tab reopened from the Sidebar's own UI render again).
  const sidebarOpen = tab.visible
  // The selected file, restored from this session's saved selection (the
  // harness REMOUNTS session-scope slots per session, so a plain useState
  // would reset on every switch).
  const [active, setActive] = useState<string | null>(
    () => sessionId === undefined ? null : sidebarSelections.get(sessionId)?.active ?? null,
  )
  const [result, setResult] = useState<ConsoleReadFileResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  // Tail (-f like) log view: a toggle that streams incremental chunks of the
  // currently active file into a monospace pane, aborting the poll when off.
  const [tailOn, setTailOn] = useState(false)
  const [tailText, setTailText] = useState('')
  const [tailOffset, setTailOffset] = useState(0)
  const [tailGone, setTailGone] = useState(false)
  // Diff view: when the active file has applied hunks in this session, a mode
  // toggle renders those before/after pairs (the harness DiffBlock) instead of
  // the raw file body.
  const [diffOn, setDiffOn] = useState(false)
  // Browse mode: the session-artifact list vs a lazily-expanded directory tree
  // rooted at the session's project directory (or the user home). The mode
  // and the expanded directories restore per session (sidebarSelections).
  const [browse, setBrowse] = useState(
    () => sessionId === undefined ? false : sidebarSelections.get(sessionId)?.browse ?? false,
  )
  const [cache, setCache] = useState<Map<string, DirCacheEntry>>(new Map())
  const [expanded, setExpanded] = useState(
    () => new Set(sessionId === undefined ? [] : sidebarSelections.get(sessionId)?.expanded ?? []),
  )
  // Shell-derived entries the user removed from this session's list (noise such
  // as redirect-dropped transcripts); like the other panel state, dismissals
  // survive remounts through sidebarSelections.
  const [dismissed, setDismissed] = useState(
    () => new Set(sessionId === undefined ? [] : sidebarSelections.get(sessionId)?.dismissed ?? []),
  )

  // Chat snapshot: the Session-standard `useConversation` hands the
  // Conversation assembly, whose `chat` target owns the materialized nodes.
  const conversation = useConversation((s) => s)
  const chat = conversation?.views.get('chat')
  const snapshot = chat
  const { files: editFiles, history } = collectArtifacts(snapshot)
  // Shell-created files, verified through the host (existence + mtime window);
  // they append after the write/edit artifacts, de-duplicated by path.
  const [shellFiles, setShellFiles] = useState<FileEntry[]>([])
  // One verdict per (call time, base, path) candidate, so an unchanged
  // transcript never re-probes the host filesystem.
  const verdictsRef = useRef(new Map<string, boolean>())
  const shellCandidates = useMemo(() => collectShellCandidates(snapshot), [snapshot])
  // The active file's hunk history, or empty when it has no recorded edits.
  const activeHunks = active === null ? undefined : history.get(active)
  // Relative file paths surface against the session's project directory.
  const sessionCwd = useSessions((list) => sessionId === undefined ? undefined : list.byId[sessionId]?.cwd)
  const rootPath = sessionCwd === undefined || sessionCwd === '' ? '~' : sessionCwd

  // Verify shell-artifact candidates against the host filesystem: a candidate
  // enters the list only when the file EXISTS (as a file) and its mtime falls
  // INSIDE the producing tool call's window — between the call and its settled
  // result (± slack) — the false-positive filter that lets the aggressive text
  // extraction name only real command products. Files some other process keeps
  // touching AFTER the command finished (session logs, todo state) fall
  // outside the ceiling and never enter the list. Verdicts cache per
  // candidate; each accepted probe resolves to an absolute host path.
  useEffect(() => {
    if (!sidebarOpen) return
    const verdicts = verdictsRef.current
    const pending = shellCandidates.filter((candidate) => {
      const key = `${candidate.time}\u0000${candidate.base ?? ''}\u0000${candidate.path}`
      return !verdicts.has(key)
    })
    if (pending.length === 0) return
    let cancelled = false
    void Promise.all(pending.map(async (candidate) => {
      const key = `${candidate.time}\u0000${candidate.base ?? ''}\u0000${candidate.path}`
      const res = await terminalPanel.statFile(candidate.path, candidate.base ?? sessionCwd)
      const accepted = res.ok
        && res.value.exists
        && res.value.kind === 'file'
        && (res.value.mtimeMs === undefined
          || (res.value.mtimeMs >= candidate.time - MTIME_WINDOW_SLACK_MS
            && (candidate.end === undefined || res.value.mtimeMs <= candidate.end + MTIME_WINDOW_SLACK_MS)))
      verdicts.set(key, accepted)
      return accepted ? res.value : null
    })).then((stats) => {
      if (cancelled) return
      const fresh = stats.filter((stat): stat is NonNullable<typeof stat> => stat !== null)
      if (fresh.length === 0) return
      setShellFiles(prev => {
        const merged = [...prev]
        for (const stat of fresh) {
          if (merged.some(file => file.path === stat.path)) continue
          merged.push({ path: stat.path, name: stat.path.split(/[\\/]/).pop() ?? stat.path })
        }
        return merged
      })
    })
    return () => { cancelled = true }
  }, [shellCandidates, sessionCwd, sidebarOpen, terminalPanel])

  // The displayed list: write/edit artifacts first, then verified shell files
  // the artifacts don't already name. Only SHELL-only entries can be dismissed
  // — a path write/edit also produced is a certain artifact, not noise.
  const files = [...editFiles]
  const shellOnly = new Set<string>()
  for (const file of shellFiles) {
    if (!files.some(entry => entry.path === file.path)) {
      files.push(file)
      shellOnly.add(file.path)
    }
  }
  const visibleFiles = files.filter(file => !dismissed.has(file.path))

  // Fetch one directory's listing into the cache (idempotent; the node shows a
  // loading/error state from the cache entry while it settles).
  const loadDir = (path: string): void => {
    if (cache.has(path)) return
    setCache(prev => new Map(prev).set(path, { state: 'loading' }))
    void terminalPanel.listDir(path, sessionCwd).then((res) => {
      setCache(prev => new Map(prev).set(path, res.ok
        ? { state: 'ready', result: res.value }
        : { state: 'error', error: res.error?.message }))
    })
  }
  const toggleDir = (path: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const openFile = (path: string): void => { setActive(path) }
  // Hide one shell-derived entry from this session's list (the file itself is
  // not touched); a dismissed active file closes its preview.
  const dismissFile = (path: string): void => {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
    if (active === path) { setActive(null); setTailOn(false) }
  }

  // Write "cd <dir> && cat <file>" into the terminal tab the dialog currently
  // shows (the shared store's activeTerminalId), so the AI's output file can
  // be inspected inside the real PTY. With no terminal open, just open the
  // dialog so the user can start one (spawn is async; a later click writes).
  const openInTerminal = (): void => {
    if (result === null) return
    const activeId = activeTerminalFor(state, sessionId)
    if (activeId === null) {
      if (sessionId !== undefined) store.update(draft => { draft.dialogOpen[sessionId] = true })
      return
    }
    const path = result.path
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const dir = slash <= 0 ? '.' : path.slice(0, slash)
    const base = slash <= 0 ? path : path.slice(slash + 1)
    void terminalPanel.write(activeId, `cd ${shellQuote(dir)} && cat ${shellQuote(base)}`, true)
  }

  // "cd <dir>" into the terminal tab the dialog currently shows. With no
  // terminal open, just open the dialog (spawn is async; a later click lands).
  const enterDir = (path: string): void => {
    const target = path === '~' ? '~' : path
    const activeId = activeTerminalFor(state, sessionId)
    if (activeId === null) {
      if (sessionId !== undefined) store.update(draft => { draft.dialogOpen[sessionId] = true })
      return
    }
    void terminalPanel.write(activeId, `cd ${shellQuote(target)}`, true)
    window.requestAnimationFrame(() => { void store.subscribe })
  }

  // Poll the active file's tail (-f like) while the log view is on: each tick
  // reads only the bytes appended since the last offset, appends them to the
  // pane, and stops on a vanished file or when the mode / selection changes.
  useEffect(() => {
    if (!sidebarOpen || !tailOn || active === null) {
      if (!tailOn) setTailGone(false)
      return
    }
    const controller = new AbortController()
    let offset = tailOffset
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (cancelled) return
      const res = await terminalPanel.tail(active, sessionCwd, offset, controller.signal)
      if (cancelled || !res.ok) return
      setTailText(prev => prev + res.value.delta)
      offset = res.value.offset
      if (res.value.gone) {
        setTailGone(true)
        return
      }
      setTailOffset(offset)
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 1500)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [sidebarOpen, tailOn, active, sessionCwd, terminalPanel])

  // Read the active file's content through the Remote; abort a stale read when
  // the selection changes or the sidebar closes.
  useEffect(() => {
    if (!sidebarOpen || active === null) {
      setResult(null)
      setError(null)
      return
    }
    const controller = new AbortController()
    setResult(null)
    setError(null)
    void terminalPanel.readFile(active, sessionCwd, controller.signal).then((res) => {
      if (res.ok) setResult(res.value)
      else setError(res.error?.message ?? t('sidebar.readError'))
    }, () => {
      setError(t('sidebar.readError'))
    })
    return () => { controller.abort() }
  }, [sidebarOpen, active, sessionCwd, terminalPanel, t])

  // Record this session's last panel state (file selection, browse mode,
  // expanded directories) so a later remount (session switch) restores it.
  useEffect(() => {
    if (sessionId === undefined) return
    sidebarSelections.set(sessionId, {
      active, browse, expanded: [...expanded], dismissed: [...dismissed],
    })
  }, [sessionId, active, browse, expanded, dismissed])

  // Load listings for the restored expanded directories so the tree renders
  // their children instead of hanging on the loading placeholder.
  useEffect(() => {
    if (sessionId === undefined) return
    for (const path of expanded) loadDir(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore-time only
  }, [])

  if (!sidebarOpen) return null
  const treeProps = {
    terminalPanel, sessionCwd, cache, loadDir, expanded, toggleDir,
    onFile: openFile, onOpenDir: enterDir, t,
  }
  return (
    <>
      <div className="dsh-devpanel-sidebar" role="region" aria-label={t('sidebar.title')}>
        <div className="dsh-devpanel-sidebar-header">
          <span className="dsh-devpanel-sidebar-title">{t('sidebar.title')}</span>
          <div className="dsh-devpanel-sidebar-modes" role="tablist" aria-label={t('sidebar.modes.aria')}>
            <button
              type="button"
              role="tab"
              aria-selected={!browse}
              data-active={!browse || undefined}
              onClick={() => { setBrowse(false) }}
            >
              {t('sidebar.modes.files')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={browse}
              data-active={browse || undefined}
              onClick={() => { setBrowse(true) }}
            >
              {t('sidebar.modes.browse')}
            </button>
          </div>
          <button
            type="button"
            className="dsh-devpanel-close"
            aria-label={t('sidebar.close')}
            onClick={() => {
              if (sessionId !== undefined) store.update(draft => { draft.sidebarOpen[sessionId] = false })
              tab.actions.close()
            }}
          >
            ×
          </button>
        </div>
      <div className="dsh-devpanel-files">
        {browse
          ? (
            <DirNode
              {...treeProps}
              path={rootPath}
              name={rootPath}
              depth={0}
            />
          )
          : visibleFiles.length === 0
            ? <div className="dsh-devpanel-empty">{t('sidebar.empty')}</div>
            : visibleFiles.map((file) => (
              <div key={file.path} className="dsh-devpanel-file-row">
                <button
                  type="button"
                  className="dsh-devpanel-file"
                  data-active={file.path === active || undefined}
                  onClick={() => { setActive(file.path) }}
                  title={file.path}
                >
                  {file.name}
                </button>
                {shellOnly.has(file.path) && (
                  <button
                    type="button"
                    className="dsh-devpanel-file-dismiss"
                    aria-label={t('sidebar.dismiss')}
                    title={t('sidebar.dismiss')}
                    onClick={() => { dismissFile(file.path) }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
      </div>
      <div className="dsh-devpanel-file-view">
        {error !== null
          ? <div className="dsh-devpanel-empty">{error}</div>
          : result === null
            ? <div className="dsh-devpanel-empty">{t('sidebar.select')}</div>
            : (
              <>
                <div className="dsh-devpanel-file-path">
                  <span className="dsh-devpanel-file-path-text">{result.path}</span>
                  <button
                    type="button"
                    className="dsh-devpanel-file-terminal"
                    aria-label={t('sidebar.openInTerminal')}
                    title={t('sidebar.openInTerminal')}
                    onClick={openInTerminal}
                  >
                    &gt;_
                  </button>
                  {activeHunks !== undefined && activeHunks.length > 0 && (
                    <button
                      type="button"
                      className="dsh-devpanel-file-diff"
                      aria-pressed={diffOn || undefined}
                      data-active={diffOn || undefined}
                      aria-label={t('sidebar.diff')}
                      title={t('sidebar.diff')}
                      onClick={() => { setDiffOn(prev => !prev) }}
                    >
                      {t('sidebar.diffLabel')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="dsh-devpanel-file-tail"
                    aria-pressed={tailOn || undefined}
                    data-active={tailOn || undefined}
                    aria-label={t('sidebar.tail')}
                    title={t('sidebar.tail')}
                    onClick={() => {
                      // Toggling on re-streams from the top of this file.
                      setTailText('')
                      setTailOffset(0)
                      setTailGone(false)
                      setTailOn(prev => !prev)
                    }}
                  >
                    {t('sidebar.tailLabel')}
                  </button>
                  <button
                    type="button"
                    className="dsh-devpanel-file-maximize"
                    aria-label={t('sidebar.maximize')}
                    title={t('sidebar.maximize')}
                    onClick={() => { setMaximized(true) }}
                  >
                    ⛶
                  </button>
                </div>
                {tailOn
                  ? (
                    <div className="dsh-devpanel-tail" role="log" aria-live="polite">
                      <div className="dsh-devpanel-tail-content">
                        {tailGone ? <span className="dsh-devpanel-tail-gone">{t('sidebar.tailGone')}</span> : null}
                        {tailText}
                      </div>
                    </div>
                  )
                  : diffOn && activeHunks !== undefined && activeHunks.length > 0
                    ? (
                      <div className="dsh-devpanel-file-history">
                        <DiffBlock
                          diffs={activeHunks}
                          labels={{
                            codeLabel: t('sidebar.codeLabel'),
                            wrapLabel: t('sidebar.wrapLabel'),
                            unwrapLabel: t('sidebar.unwrapLabel'),
                            copy: t('sidebar.copy'),
                            copied: t('sidebar.copied'),
                            collapseAria: t('sidebar.diffCollapseAria'),
                            expandAria: (hidden) => t('sidebar.diffExpandAria').replace('{count}', String(hidden)),
                            collapse: t('sidebar.diffCollapse'),
                            expand: (hidden) => t('sidebar.diffExpand').replace('{count}', String(hidden)),
                          }}
                        />
                      </div>
                    )
                    : <FileBody result={result} t={t} />}
              </>
            )}
      </div>
    </div>
    {maximized && result !== null && (
      <div className="dsh-devpanel-file-fullscreen" role="dialog" aria-label={result.path}>
        <div className="dsh-devpanel-file-fullscreen-header">
          <span className="dsh-devpanel-file-path-text">{result.path}</span>
          <button
            type="button"
            className="dsh-devpanel-close"
            aria-label={t('sidebar.close')}
            onClick={() => { setMaximized(false) }}
          >
            ×
          </button>
        </div>
        <div className="dsh-devpanel-file-fullscreen-body">
          <FileBody result={result} t={t} />
        </div>
      </div>
    )}
    </>
  )
}
