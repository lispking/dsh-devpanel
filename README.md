# dsh-devpanel

> A developer toolkit for the DeepSeek Harness (DSH) web console: a real multi-tab PTY terminal plus an AI-output file browser.

`dsh-devpanel` is a plugin for the DeepSeek Harness that brings three things into the browser console:

- **Terminal panel** — a multi-tab, real PTY terminal docked under the composer. Start and stop processes, type commands by hand, and watch live output, just like a native terminal.
- **AI-output sidebar** — a right-hand file viewer that lists every file the AI wrote or edited in the current session, with syntax highlighting, Markdown rendering, and image preview.
- **Usage stats panel** — a modal dashboard that merges TWO usage dimensions into one "how much did I actually work" view: AI activity (tokens, calls, messages, model share) and terminal activity (sessions, submitted commands, wall time — the dimension only dsh-devpanel can see, because it owns the terminal panel).

The terminal and file surfaces are driven by `TerminalPanelService`; the usage panel by `UsageService`. Both wrap harness primitives (`ctx.subprocess.spawnTerminal` for the PTY, the `session/event` firehose + terminal events for usage) and are exposed to the browser over the Typert Remote boundary — **no harness changes required**. The Gateway auto-discovers both services through their `typertRemote` bindings.

## Features

- **Real PTY sessions** — spawns the system login shell (`$SHELL`, falling back to `/bin/sh`) in the session's working directory, wrapped so it exports a real `TERM` (the harness forks PTYs with `TERM=dumb`, which breaks `clear` and prompt glyphs). Colored output from `git`, `ls`, and prompts renders like a native terminal.
- **Multi-tab terminal dialog** — docked under the composer, with tab bar, shell badge, `+` new tab, per-tab close, and a close button that ends every session. Closing the last tab closes the panel; reopening spawns a fresh default tab.
- **Native terminal behavior** — copy-on-select writes the selection to the clipboard, `Cmd/Ctrl+Shift+V` pastes, `clear` works, and multi-byte UTF-8 output survives arbitrary byte-chunk splits without `?` mojibake.
- **Process control** — deliver `SIGINT` / `SIGTERM` / `SIGKILL` / `SIGTSTP` / `SIGHUP` to the verified foreground process group, or terminate the captured process tree with a 2-second grace period.
- **Live output deltas** — the browser polls `read` for incremental output; the host keeps a per-session scrollback (1 MB tail) so long output stays browsable without unbounded memory.
- **AI-output file sidebar** — collects the files the session's `write`/`edit` tool calls produced (from diff views and raw args, de-duplicated in first-seen order), reads them through the remote, and renders them as image, Markdown, highlighted code, or plain text, with a fullscreen mode.
- **Dual-dimension usage stats** — a modal dashboard (session-header bar-chart icon) folding the AI side of the `session/event` firehose (tokens, calls, messages, per-model share, response duration, reasoning effort) and the terminal side (sessions, submitted commands, wall time) into overview cards, a daily dual-series trend, a yearly activity heatmap, paginated call + terminal detail tables, and CSV/JSON export. Historical chat sessions are replayed best-effort through `ctx.sessionQuery`; the index is persisted (debounced, atomic) under `DSH_HOME/devpanel/usage-v1.json`.
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
│    ConsoleHeaderActions   three header icons (terminal + sidebar + usage)    │
│    ConsoleSidebar         AI-output file viewer (right details column)       │
│    TerminateDialog        multi-tab xterm dialog (composer dock)             │
│    UsagePanel             dual-dimension usage dashboard (modal overlay)     │
│    console-store.ts       shared sidebar/dialog/usage open state             │
│    console.css.ts         injected <style> tag (no CSS pipeline)             │
│    locales.ts             zh / en dictionaries (namespace 'toolkit')         │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │  Typert Remote (JSON wire, zod-strict codecs)
┌───────────────┴──────────────────────────── host (node) ────────────────────┐
│  src/index.ts         TerminalPanelService (TypertRemoteService)             │
│  src/usage.ts         UsageService (TypertRemoteService, usagePanel ns)      │
│  src/typert.host.ts   TYPERT manifest for the typert-loader                  │
│  src/types.ts         terminal wire vocabulary (pure data)                   │
│  src/usage-types.ts   usage wire vocabulary (pure data)                      │
│  src/usage-schemas.ts usage zod codecs (pure data)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Host half** — `TerminalPanelService` (`src/index.ts`) extends `TypertRemoteService` and owns an owner-free session map. Each session wraps a `SubprocessTerminalHandle` from `ctx.subprocess.spawnTerminal` with a streaming `TextDecoder` (so a multi-byte char straddling two output chunks stays intact), a bounded scrollback buffer, and a read cursor for delta consumption. It emits terminal lifecycle events (`devpanel/terminal/spawn|command|exit|dispose`) on the shared ctx. Session lifetimes follow the plugin: the constructor registers a fiber effect that terminates every live PTY on dispose. `UsageService` (`src/usage.ts`) extends `TypertRemoteService` under the `usagePanel` namespace: it folds the live `session/event` firehose into per-chat-session AI activity records, folds the terminal events into per-terminal-session records, persists a debounced atomic index cache under `DSH_HOME/devpanel/usage-v1.json`, replays historical chat sessions best-effort through `ctx.sessionQuery`, and serves aggregated snapshots, call/terminal detail pages, and CSV/JSON exports. The plugin's `apply` wires `UsageService` first (so it subscribes before any terminal can spawn), then `TerminalPanelService`.
- **Client half** (`src/client/`) — `apply` mounts the `TYPERT_REMOTE` contribution first (the dialog needs the namespace mounted before it injects it), then contributes **three slots** over one shared console store:
  - `conversation.session.header.utilities` (id `toolkit-actions`, order `10`) — the terminal-dialog, sidebar, and usage-stats toggle icons;
  - `details` (priority `-10`) — the AI-output file viewer; a **lower** priority shadows the harness `DetailsPanel` (lowest renders, so `-10` wins) and drives the right column through `ctx.layout`;
  - `conversation.composer.dock` (id `toolkit-dialog`, order `10`) — the multi-tab terminal dialog.

  The usage-stats toggle renders `UsagePanel` as a fixed modal overlay; it calls the `usagePanel` Remote face for snapshots, detail pages, and exports.

  Because the plugin itself mounts the `remote.terminalPanel` and `remote.usagePanel` namespaces, it reads the live instances out of the service store (`ctx.get`) instead of declaring a static inject entry, avoiding a self-wait deadlock.

- **Wire vocabulary** — `src/types.ts` (terminal) and `src/usage-types.ts` (usage) hold the JSON-safe shapes crossing the Remote boundary, shared by the host encode and the client descriptors; `src/usage-schemas.ts` adds the usage zod codecs. `src/typert.host.ts` ships a strict hand-written manifest so the endpoints are known to the gateway regardless of module identity (out-of-tree bundles would otherwise 404 on the runtime reflection fallback).

## Installation

`dsh-devpanel` is developed as a workspace package next to the harness source. Requirements:

- Node `^22.19.0 || >=24.0.0`
- pnpm workspace including `../deepseek-harness` (see `pnpm-workspace.yaml`)

```bash
# from the workspace root
pnpm install
pnpm --filter dsh-devpanel build
```

The plugin contributes a bundle row via `cordis.patch.yml` (`{ id: toolkit, name: dsh-devpanel }`); enable it in a harness profile that lists this bundle. The published package exposes four entry points:

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
- images (`png`, `jpg`, `gif`, `webp`, `avif`, `svg`, `tiff`, `heic`, …) render inline as data URLs;
- PDFs render in a native embedded viewer; audio (`mp3`, `wav`, `ogg`, `flac`, …) and video (`mp4`, `webm`, `mov`, …) play inline;
- unrecognized binary files show a file-info notice instead of decoded garbage;
- anything else renders as plain text.

Use the `⛶` button to open the current file fullscreen; the `×` button closes the sidebar.

### Usage stats panel

Click the bar-chart icon in the session header to open the usage dashboard as a modal overlay (Esc or `×` closes it). The toolbar lets you pick a range (last 7 / 30 / 90 days), a lineage scope (all / main tasks only / subtasks only), and a workspace (session cwd). The panel shows:

- **Overview cards** — AI tokens, calls, messages, sessions, active days + streak, and the terminal dimension: terminal sessions, submitted commands, and terminal wall time.
- **Daily trend** — a dual-series bar chart of AI tokens and terminal commands per day.
- **Activity heatmap** — a GitHub-style yearly grid colored by a combined AI + terminal activity score (hover a cell for the exact value).
- **Model share** — horizontal bars of tokens per model.
- **Call details** — paginated assistant-call rows (time, model, effort, duration, input/output/cache/reasoning tokens), filterable by the same range/scope/workspace.
- **Terminal details** — paginated terminal sessions (start, shell, directory, duration, exit, command count; hover the count to see the commands).
- **Export** — download the current range as CSV or JSON.

Data is collected from the moment the plugin loads: live AI activity comes from the `session/event` firehose, terminal activity from the terminal panel's own events, and historical chat sessions are replayed on startup (best-effort, via `ctx.sessionQuery`). The index is persisted under `DSH_HOME/devpanel/usage-v1.json`.

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
| `readFile` | `path, cwd?` | `{ path, content, kind, dataUrl?, size? }` | Read one file for the viewer. `~`-prefixed and relative paths resolve against `cwd` (default: host cwd); image/pdf/audio/video return a base64 data URL, unknown binary files return only their byte size (`kind: 'binary'`). |

Session status is `{ kind: 'running' }` or `{ kind: 'exited', exitCode, signal }`. The full TypeScript vocabulary lives in `src/types.ts` and is re-exported from the package's `./types` entry.

The `usagePanel` namespace is available on the client as `ctx.remote.usagePanel.*`, with the same `RemoteResult<T>` contract.

| Method | Parameters | Result | Description |
| --- | --- | --- | --- |
| `snapshot` | `{ from, to, timeZone, scope, workspace? }` | `UsageSnapshot` | Aggregated AI + terminal figures for a date range (totals, day rows, model share, workspaces, index health). |
| `calls` | `{ from, to, timeZone, scope, workspace?, model?, provider?, minInputTokens?, minOutputTokens?, page, pageSize }` | `UsageCallsPage` | Paginated assistant-call detail rows, newest first. |
| `terminals` | `{ from, to, timeZone, workspace?, page, pageSize }` | `UsageTerminalsPage` | Paginated terminal-session detail rows, newest first. |
| `exportCsv` | `{ from, to, timeZone, scope, workspace? }` | `{ filename, body }` | CSV export of the merged day rows. |
| `exportJson` | `{ from, to, timeZone, scope, workspace? }` | `{ filename, body }` | JSON export of the full snapshot. |

`scope` is `'all' | 'main' | 'subtasks'`; `from`/`to` are `YYYY-MM-DD` in the given IANA `timeZone`. The usage vocabulary lives in `src/usage-types.ts`.

## Project structure

```
src/
  index.ts               host: TerminalPanelService (TypertRemoteService)
  usage.ts               host: UsageService (TypertRemoteService, usagePanel ns)
  typert.host.ts         host-face TYPERT manifest for the typert-loader
  types.ts               terminal wire vocabulary (pure data)
  usage-types.ts         usage wire vocabulary (pure data)
  usage-schemas.ts       usage zod codecs (pure data)
  client/
    index.ts             client plugin body (apply/inject)
    remote.ts            TYPERT_REMOTE contribution + ctx.remote typing
    ConsoleHeaderActions.tsx   three session-header icon toggles
    ConsoleSidebar.tsx        AI-output file viewer (details column)
    TerminateDialog.tsx       multi-tab xterm dialog (composer dock)
    UsagePanel.tsx            dual-dimension usage dashboard (modal overlay)
    console-store.ts          shared sidebar/dialog/usage snapshot store
    console.css.ts            injected stylesheet (style tag)
    locales.ts                zh / en dictionaries (namespace 'toolkit')
tests/
  service.spec.ts        TerminalPanelService behavior over a stub subprocess
  usage.spec.ts          usage collector/aggregator + service integration
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
