# dsh-toolkit

> A developer toolkit for the DeepSeek Harness (DSH) web console: a real multi-tab PTY terminal plus an AI-output file browser.

`dsh-toolkit` is a plugin for the DeepSeek Harness that brings two things into the browser console:

- **Terminal panel** — a multi-tab, real PTY terminal docked under the composer. Start and stop processes, type commands by hand, and watch live output, just like a native terminal.
- **AI-output sidebar** — a right-hand file viewer that lists every file the AI wrote or edited in the current session, with syntax highlighting, Markdown rendering, and image preview.

Both surfaces are driven by a single host-side service, `TerminalPanelService`, which wraps the harness's `ctx.subprocess.spawnTerminal` PTY primitive and is exposed to the browser over the Typert Remote boundary — **no harness changes required**. The Gateway auto-discovers the service through its `typertRemote` binding.

## Features

- **Real PTY sessions** — spawns the system login shell (`$SHELL`, falling back to `/bin/sh`) in the session's working directory, wrapped so it exports a real `TERM` (the harness forks PTYs with `TERM=dumb`, which breaks `clear` and prompt glyphs). Colored output from `git`, `ls`, and prompts renders like a native terminal.
- **Multi-tab terminal dialog** — docked under the composer, with tab bar, shell badge, `+` new tab, per-tab close, and a close button that ends every session. Closing the last tab closes the panel; reopening spawns a fresh default tab.
- **Native terminal behavior** — copy-on-select writes the selection to the clipboard, `Cmd/Ctrl+Shift+V` pastes, `clear` works, and multi-byte UTF-8 output survives arbitrary byte-chunk splits without `?` mojibake.
- **Process control** — deliver `SIGINT` / `SIGTERM` / `SIGKILL` / `SIGTSTP` / `SIGHUP` to the verified foreground process group, or terminate the captured process tree with a 2-second grace period.
- **Live output deltas** — the browser polls `read` for incremental output; the host keeps a per-session scrollback (1 MB tail) so long output stays browsable without unbounded memory.
- **AI-output file sidebar** — collects the files the session's `write`/`edit` tool calls produced (from diff views and raw args, de-duplicated in first-seen order), reads them through the remote, and renders them as image, Markdown, highlighted code, or plain text, with a fullscreen mode.
- **Session-scoped cwd** — the terminal and relative file reads resolve against the session's project directory (falling back to the user home / host cwd).
- **Bilingual UI** — Simplified Chinese and English dictionaries, registered in the `toolkit` locale namespace.
- **Clean lifecycle** — every live PTY is terminated when the plugin unloads; the client unregisters its slots, removes the injected stylesheet, and unmounts the Remote namespace.

## Architecture

The plugin is a two-face bundle, mirroring the harness client preset:

```
┌─────────────────────────── browser (web platform) ───────────────────────────┐
│  src/client/                                                                 │
│    index.ts               plugin body: mounts the Remote, registers slots    │
│    remote.ts              TYPERT_REMOTE contribution + ctx.remote typing     │
│    ConsoleHeaderActions   two header icons (terminal + sidebar toggles)      │
│    ConsoleSidebar         AI-output file viewer (right details column)       │
│    TerminateDialog        multi-tab xterm dialog (composer dock)             │
│    console-store.ts       shared sidebar/dialog open state                   │
│    console.css.ts         injected <style> tag (no CSS pipeline)             │
│    locales.ts             zh / en dictionaries (namespace 'toolkit')         │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │  Typert Remote (JSON wire, zod-strict codecs)
┌───────────────┴──────────────────────────── host (node) ────────────────────┐
│  src/index.ts         TerminalPanelService (TypertRemoteService)             │
│  src/typert.host.ts   TYPERT manifest for the typert-loader                  │
│  src/types.ts         shared wire vocabulary (pure data, no runtime imports) │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Host half** (`src/index.ts`) — `TerminalPanelService` extends `TypertRemoteService` and owns an owner-free session map. Each session wraps a `SubprocessTerminalHandle` from `ctx.subprocess.spawnTerminal` with a streaming `TextDecoder` (so a multi-byte char straddling two output chunks stays intact), a bounded scrollback buffer, and a read cursor for delta consumption. Session lifetimes follow the plugin: the constructor registers a fiber effect that terminates every live PTY on dispose.
- **Client half** (`src/client/`) — `apply` mounts the `TYPERT_REMOTE` contribution first (the dialog needs the namespace mounted before it injects it), then contributes **three slots** over one shared console store:
  - `conversation.session.header.utilities` (id `toolkit-actions`, order `10`) — the terminal-dialog and sidebar toggle icons;
  - `details` (priority `-10`) — the AI-output file viewer; a **lower** priority shadows the harness `DetailsPanel` (lowest renders, so `-10` wins) and drives the right column through `ctx.layout`;
  - `conversation.composer.dock` (id `toolkit-dialog`, order `10`) — the multi-tab terminal dialog.

  Because the plugin itself mounts `remote.terminalPanel`, it reads the live instance out of the service store (`ctx.get`) instead of declaring a static inject entry, avoiding a self-wait deadlock.

- **Wire vocabulary** (`src/types.ts`) — the JSON-safe shapes crossing the Remote boundary, shared by the host encode and the client descriptors. `src/typert.host.ts` ships a strict hand-written manifest so the endpoints are known to the gateway regardless of module identity (out-of-tree bundles would otherwise 404 on the runtime reflection fallback).

## Installation

`dsh-toolkit` is developed as a workspace package next to the harness source. Requirements:

- Node `^22.19.0 || >=24.0.0`
- pnpm workspace including `../deepseek-harness` (see `pnpm-workspace.yaml`)

```bash
# from the workspace root
pnpm install
pnpm --filter dsh-toolkit build
```

The plugin contributes a bundle row via `cordis.patch.yml` (`{ id: toolkit, name: dsh-toolkit }`); enable it in a harness profile that lists this bundle. The published package exposes four entry points:

| Export | Path | Purpose |
| --- | --- | --- |
| `.` | `lib/index.js` | host service entry (default export `TerminalPanelService`) |
| `./client` | `lib/client.js` | browser CJS closure-factory bundle |
| `./types` | `lib/types/types.js` | shared wire types |
| `./typert` | `lib/typert.host.js` | host-face Typert manifest |

## Usage

### Terminal panel

Click the terminal icon (`>_`) in the session header to toggle the terminal dialog docked under the composer. The first open spawns a default tab in the session's working directory (the user home when the session has none). Use the tab bar to switch between sessions, `+` to open a new tab, and the `×` on each tab to close it — closing the last tab closes the whole panel, and reopening starts a fresh default tab.

Input is delivered keystroke-by-keystroke into the PTY (Enter included, no newline conversion), so interactive programs (`vim`, `top`, REPLs) behave as expected. Select text to copy it; press `Cmd/Ctrl+Shift+V` to paste. The shell badge next to the tab bar shows the running shell program (e.g. `zsh`).

### AI-output sidebar

Click the panel icon in the session header to toggle the file sidebar in the right details column. It lists every file the current session's `write` / `edit` tool calls produced (in first-seen order, de-duplicated). Click a file to read it through the host:

- `.md` / `.mdx` renders as Markdown;
- common code extensions get syntax-highlighted blocks;
- images (`png`, `jpg`, `gif`, `webp`, `avif`, `svg`, …) render inline as data URLs;
- anything else renders as plain text.

Use the `⛶` button to open the current file fullscreen; the `×` button closes the sidebar.

## Remote API

The `terminalPanel` namespace is available on the client as `ctx.remote.terminalPanel.*`. All methods take an optional trailing `AbortSignal` and return a `RemoteResult<T>` (`{ ok: true, value }` or `{ ok: false, error }`).

| Method | Parameters | Result | Description |
| --- | --- | --- | --- |
| `spawn` | `{ argv, cwd, rows, cols, name? }` | `{ id, pid, shell }` | Spawn one PTY session. Empty `argv` resolves the system login shell with a real `TERM`; empty or `~` cwd lands in the user home. |
| `write` | `id, text, submit` | `{ ok: true }` | Write text to the terminal; `submit` appends the Enter sequence (`\r`). |
| `read` | `id` | `{ delta, status }` | Consume the output produced since the previous read, plus the current session status. |
| `signal` | `id, sig` | `{ delivered: true, targetPgid }` | Deliver `SIGINT`/`SIGTERM`/`SIGKILL`/`SIGTSTP`/`SIGHUP` to the verified foreground process group. |
| `terminate` | `id` | `{ ok: true }` | Terminate the captured process tree (2 s grace) and await quiescence; the record stays listed as exited. |
| `list` | — | `{ sessions }` | List live sessions in creation order. |
| `dispose` | `id` | `{ ok: true }` | Remove the session record, terminating it first if still running; unknown ids are idempotently ok. |
| `readFile` | `path, cwd?` | `{ path, content, kind, dataUrl? }` | Read one file for the viewer. `~`-prefixed and relative paths resolve against `cwd` (default: host cwd); images return a base64 data URL. |

Session status is `{ kind: 'running' }` or `{ kind: 'exited', exitCode, signal }`. The full TypeScript vocabulary lives in `src/types.ts` and is re-exported from the package's `./types` entry.

## Project structure

```
src/
  index.ts               host: TerminalPanelService (TypertRemoteService)
  typert.host.ts         host-face TYPERT manifest for the typert-loader
  types.ts               shared JSON wire vocabulary (pure data)
  client/
    index.ts             client plugin body (apply/inject)
    remote.ts            TYPERT_REMOTE contribution + ctx.remote typing
    ConsoleHeaderActions.tsx   two session-header icon toggles
    ConsoleSidebar.tsx        AI-output file viewer (details column)
    TerminateDialog.tsx       multi-tab xterm dialog (composer dock)
    console-store.ts          shared sidebar/dialog snapshot store
    console.css.ts            injected stylesheet (style tag)
    locales.ts                zh / en dictionaries (namespace 'toolkit')
tests/
  service.spec.ts        TerminalPanelService behavior over a stub subprocess
  apply.client.spec.ts   client apply: slots, Remote mount, stylesheet
  clear-repro.spec.ts    UTF-8 chunk-split + clear escape-sequence regressions
  terminate-reopen.spec.ts  tab lifecycle: close-last-tab / reopen re-spawns
cordis.patch.yml         bundle-row patch contributed to harness profiles
tsdown.config.ts         two-face build (host ESM + client CJS closure bundle)
vitest.config.ts         resolves @deepseek-ai/* to the harness source
```

## Development

```bash
pnpm build          # tsc -p tsconfig.json && tsdown (host + client bundles)
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm test:watch     # vitest (watch mode)
```

Notes for contributors:

- **Never bundle the runtime** — the client bundle keeps `react`, `@deepseek-ai/*` (and friends) external via `CLIENT_EXTERNALS` in `tsdown.config.ts`; they resolve through the module loader's injected `require` at runtime.
- **The two Remote contributions must stay in sync** — `src/client/remote.ts` (browser descriptors) and `src/typert.host.ts` (host manifest) both hand-write what the generator would emit; their zod schemas and wire names must match the `@Remote` methods in `src/index.ts`.
- **The client stylesheet is a string** — there is no CSS pipeline in the client bundle, so styles ship as one injected `<style>` tag (see `console.css.ts`), colored via the `--dsw-*` token layer with neutral fallbacks.
- **Regression tests cover real byte streams** — `clear-repro.spec.ts` splits real prompt/clear byte sequences at every possible position to guarantee no `U+FFFD` mojibake.

## License

MIT — see [LICENSE](./LICENSE).
