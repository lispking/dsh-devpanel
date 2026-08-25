/**
 * Console stylesheet: one injected <style> tag (the client bundle has no CSS
 * pipeline, so styles ship as an inline string — same contract as dsh-qq-skin's
 * layout layer). Colors ride the `--dsw-*` token layer; only tokens that
 * actually exist in the theme are referenced (label-primary/secondary,
 * bg-layer-1/2/3, border-l2, interactive-bg-hover, state-business-primary,
 * state-error-primary), with neutral fallbacks for off-theme contexts.
 * @module dsh-devpanel/client/console.css
 */

import type { Context } from '@deepseek-ai/cordis'

/** Style-tag identity used for diagnostics and test assertions. */
export const CONSOLE_STYLE_PLUGIN = 'dsh-devpanel/styles'

/** Terminal console styles: header icons, right AI sidebar, Terminate dialog. */
export const CONSOLE_CSS = `
.dsh-devpanel-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.dsh-devpanel-header-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  cursor: pointer;
}
.dsh-devpanel-header-icon:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #111827);
}
.dsh-devpanel-header-icon[aria-pressed='true'] {
  color: var(--dsw-alias-state-business-primary, #2563eb);
}

.dsh-devpanel-sidebar {
  /* Fills the harness layout's right details column (the column owns width
     and geometry; this only needs the full-height column layout and its
     internal scrolling regions). */
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dsh-devpanel-sidebar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  flex: none;
}
.dsh-devpanel-sidebar-title {
  font-weight: 600;
}
/* Mode tabs (session files vs directory tree) in the sidebar header. */
.dsh-devpanel-sidebar-modes {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-3, #f3f4f6);
}
.dsh-devpanel-sidebar-modes button {
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-sidebar-modes button[data-active] {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
/* Directory tree: indented rows with a caret, nested inside .dsh-devpanel-files. */
.dsh-devpanel-tree {
  display: flex;
  flex-direction: column;
}
.dsh-devpanel-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 8px;
  padding-left: calc(8px + var(--dsh-tree-depth, 0) * 14px);
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-devpanel-tree-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
/* Directory rows are a wrapper holding a filled toggle + a terminal button,
   so the wrapper carries the hover and the indent moves to the toggle. */
.dsh-devpanel-tree-row.dsh-devpanel-tree-dirrow {
  padding: 0 4px 0 0;
}
.dsh-devpanel-tree-dirrow:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dsh-devpanel-tree-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  padding: 2px 8px;
  padding-left: calc(8px + var(--dsh-tree-depth, 0) * 14px);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-devpanel-tree-open {
  flex: none;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  cursor: pointer;
  opacity: 0;
}
.dsh-devpanel-tree-dirrow:hover .dsh-devpanel-tree-open,
.dsh-devpanel-tree-open:hover {
  opacity: 1;
}
.dsh-devpanel-tree-open:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-state-business-primary, #2563eb);
}
.dsh-devpanel-tree-caret {
  flex: none;
  width: 12px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-size: 10px;
  text-align: center;
}
.dsh-devpanel-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-devpanel-tree-file {
  color: var(--dsw-alias-label-secondary, #4b5563);
}
.dsh-devpanel-tree-status {
  padding: 2px 8px;
  padding-left: calc(8px + var(--dsh-tree-depth, 0) * 14px + 12px);
  color: var(--dsw-alias-label-secondary, #4b5563);
}
.dsh-devpanel-tree-error {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

.dsh-devpanel-dialog {
  box-sizing: border-box;
  /* The composer.dock band sits inside InputBar's centered flex root, which
     pads its children by --dsh-composer-side-clearance (16px) each side and
     8px below; the whole stack rides the conversation scroller, which
     reserves the scrollbar gutter on the right (--dsh-scrollbar-width, 8px)
     via scrollbar-gutter: stable. The terminal must span the WHOLE band
     edge-to-edge, so the negative margins cancel that outer padding AND the
     gutter (with an extra 8px buffer for engine scrollbar-width variance;
     the extra bleeds past the scroller's padding box, where it is clipped).
     Only +/− calc operators are used — the '*' form is not supported in
     every embedded WebView and drops the whole declaration. Note the gutter
     itself can never be covered by width alone: the classic scrollbar's
     track paints above all content, so the scroller's track is themed
     transparent below (see the [data-conversation-scroll] rules). */
  /* Terminal panel surface tokens: dark by default (matching the pre-theme
     behavior and the embedded terminal look); the light override below swaps
     them when the harness palette is light (body has no data-ds-dark-theme). */
  --dsh-term-bg: #1b1b1f;
  --dsh-term-fg: #e4e4e7;
  --dsh-term-border: #2c2c31;
  --dsh-term-surface: #26262c;
  --dsh-term-surface-active: #2c2c33;
  --dsh-term-muted: #9b9ba3;
  --dsh-term-danger: #f26d78;
  --dsh-term-badge-border: #3b3b40;
  --dsh-term-scroll-thumb: rgba(255, 255, 255, 0.22);
  --dsh-term-hover-tint: rgba(255, 255, 255, 0.12);
  width: calc(100% + var(--dsh-composer-side-clearance, 16px) + var(--dsh-composer-side-clearance, 16px) + var(--dsh-scrollbar-width, 8px) + 8px);
  margin: 0 0 -8px;
  margin-left: calc(0px - var(--dsh-composer-side-clearance, 16px));
  margin-right: calc(0px - var(--dsh-composer-side-clearance, 16px) - var(--dsh-scrollbar-width, 8px) - 8px);
  /* Anchor for absolutely-positioned overlays (the Cmd/Ctrl+K snippet palette). */
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  background: var(--dsh-term-bg);
  color: var(--dsh-term-fg);
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
/* Light harness palette (no dark attribute): the panel chrome follows the
   light surface with re-tuned muted/danger/border tints. */
body:not([data-ds-dark-theme]) .dsh-devpanel-dialog {
  --dsh-term-bg: #ffffff;
  --dsh-term-fg: #1f2937;
  --dsh-term-border: #d1d5db;
  --dsh-term-surface: #f3f4f6;
  --dsh-term-surface-active: #e5e7eb;
  --dsh-term-muted: #6b7280;
  --dsh-term-danger: #dc2626;
  --dsh-term-badge-border: #d1d5db;
  --dsh-term-scroll-thumb: rgba(0, 0, 0, 0.22);
  --dsh-term-hover-tint: rgba(0, 0, 0, 0.08);
}
.dsh-devpanel-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsh-term-border);
}
.dsh-devpanel-dialog-header .dsh-devpanel-status {
  margin-left: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-devpanel-title {
  font-weight: 600;
}
.dsh-devpanel-close {
  margin-left: auto;
  padding: 2px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-state-error-primary, #dc2626);
}

/* Multi-tab terminal bar: title + shell badge + one pill per session, with
   trailing "+" (new session) and "×" (close panel) actions. The whole bar
   shares the embedded dark surface with the terminal body. */
.dsh-devpanel-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsh-term-border);
  overflow-x: auto;
  scrollbar-width: thin;
  /* The dialog bleeds ~8px past the scrollport's right edge (see
     .dsh-devpanel-dialog: negative margins cover the reserved gutter plus an
     engine-variance buffer) and that overhang is clipped. The trailing +/×
     actions would otherwise sit flush against the clipped edge and get cut
     off, so extra right padding pulls them back into the visible band while
     the dark background still fills edge-to-edge. */
  padding-right: calc(8px + var(--dsh-scrollbar-width, 8px) + 8px);
}
.dsh-devpanel-shell-badge {
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--dsh-term-badge-border);
  border-radius: 999px;
  color: var(--dsh-term-muted);
  font-size: 11px;
  line-height: 1.5;
}
.dsh-devpanel-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  max-width: 180px;
  padding: 2px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsh-term-muted);
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-tab:hover {
  background: var(--dsh-term-surface);
}
.dsh-devpanel-tab[data-active] {
  background: var(--dsh-term-surface-active);
  color: var(--dsh-term-fg);
}
/* "Completed" flash (BEL byte or the foreground process exiting): the tab
   blinks its border between the idle and a business highlight so the user
   notices output that landed off-screen. The flash is contact/active-bound;
   recomputing the animation is cheap, so it replays from the start whenever
   data-notify is set. */
@keyframes dsh-devpanel-tab-notify {
  0%, 100% { box-shadow: 0 0 0 1px transparent; }
  50% { box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary, #2563eb); }
}
.dsh-devpanel-tab[data-notify] {
  animation: dsh-devpanel-tab-notify 1.2s ease-in-out 2;
}
.dsh-devpanel-tab[data-notify]:hover {
  background: var(--dsh-term-surface-active);
}
.dsh-devpanel-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Inline rename input replacing the label while a tab is being renamed. */
.dsh-devpanel-tab-rename {
  min-width: 60px;
  max-width: 140px;
  padding: 0 4px;
  border: 1px solid var(--dsh-term-border);
  border-radius: 4px;
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
  font: inherit;
  outline: none;
}
.dsh-devpanel-tab-rename:focus {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}
.dsh-devpanel-tab-close {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  color: var(--dsh-term-muted);
  line-height: 1.4;
}
.dsh-devpanel-tab-close:hover {
  background: var(--dsh-term-hover-tint);
  color: var(--dsh-term-danger);
}
.dsh-devpanel-tabs-actions {
  /* Keep the trailing +/× pinned to the visible right edge while the tab
     strip scrolls underneath: without this, margin-left:auto pushes the
     actions past the scrollport when many tabs overflow and the close
     button disappears. Solid background occludes tabs sliding under, with a
     soft left shadow to mask the sliding edge. */
  position: sticky;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex: none;
  background: var(--dsh-term-bg);
  box-shadow: -8px 0 8px -8px rgba(0, 0, 0, 0.55);
}
.dsh-devpanel-tab-add {
  padding: 1px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsh-term-muted);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  cursor: pointer;
}
.dsh-devpanel-tab-add:hover {
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
}
.dsh-devpanel-tabs-actions .dsh-devpanel-close {
  margin-left: 0;
  color: var(--dsh-term-muted);
}
.dsh-devpanel-tabs-actions .dsh-devpanel-close:hover {
  background: var(--dsh-term-surface);
  color: var(--dsh-term-danger);
}

/* Terminal search bar (Cmd/Ctrl+F): input + result counter + prev/next + close,
   a slim dark strip between the tab bar and the terminal band. */
.dsh-devpanel-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 4px 12px;
  background: var(--dsh-term-bg);
  border-bottom: 1px solid var(--dsh-term-border);
}
.dsh-devpanel-search input {
  flex: 1;
  min-width: 0;
  padding: 2px 8px;
  border: 1px solid var(--dsh-term-border);
  border-radius: 4px;
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
  font: inherit;
  outline: none;
}
.dsh-devpanel-search input:focus {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}
.dsh-devpanel-search input::placeholder {
  color: var(--dsh-term-muted);
}
.dsh-devpanel-search-count {
  flex: none;
  color: var(--dsh-term-muted);
  font-size: 11px;
  min-width: 34px;
  text-align: right;
}
.dsh-devpanel-search button {
  flex: none;
  padding: 1px 7px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsh-term-muted);
  font: inherit;
  line-height: 1.5;
  cursor: pointer;
}
.dsh-devpanel-search button:hover {
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
}
.dsh-devpanel-search .dsh-devpanel-search-close:hover {
  color: var(--dsh-term-danger);
}

/* Command snippet palette (Cmd/Ctrl+K): an overlay anchored under the tab
   strip — filter input, snippet rows, and an add-form for user snippets.
   Themed with the terminal tokens so it reads as part of the panel. */
.dsh-devpanel-tabs-actions .dsh-devpanel-palette-open {
  flex: none;
  padding: 1px 7px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsh-term-muted);
  font: inherit;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
}
.dsh-devpanel-tabs-actions .dsh-devpanel-palette-open:hover {
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
}
.dsh-devpanel-palette {
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  width: min(520px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsh-term-border);
  border-radius: 8px;
  background: var(--dsh-term-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.dsh-devpanel-palette-filter {
  flex: none;
  margin: 8px;
  padding: 4px 10px;
  border: 1px solid var(--dsh-term-border);
  border-radius: 6px;
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
  font: inherit;
  outline: none;
}
.dsh-devpanel-palette-filter:focus {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}
.dsh-devpanel-palette-filter::placeholder {
  color: var(--dsh-term-muted);
}
.dsh-devpanel-palette-add {
  display: flex;
  gap: 6px;
  padding: 0 8px 8px;
}
.dsh-devpanel-palette-add input {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border: 1px solid var(--dsh-term-border);
  border-radius: 6px;
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
  font: inherit;
  outline: none;
}
.dsh-devpanel-palette-add input::placeholder {
  color: var(--dsh-term-muted);
}
.dsh-devpanel-palette-save {
  flex: none;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #ffffff;
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-palette-save:disabled {
  opacity: 0.45;
  cursor: default;
}
.dsh-devpanel-palette-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 0 4px 4px;
}
.dsh-devpanel-palette-empty {
  padding: 10px;
  text-align: center;
  color: var(--dsh-term-muted);
}
.dsh-devpanel-palette-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 4px);
  margin: 2px;
  padding: 4px 28px 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.dsh-devpanel-palette-row[data-active] {
  background: var(--dsh-term-surface);
}
.dsh-devpanel-palette-row[data-active] .dsh-devpanel-palette-name {
  color: var(--dsh-term-fg);
}
.dsh-devpanel-palette-name {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsh-term-fg);
}
.dsh-devpanel-palette-command {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsh-term-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.dsh-devpanel-palette-delete {
  position: absolute;
  right: 6px;
  padding: 0 4px;
  border-radius: 4px;
  color: var(--dsh-term-muted);
  cursor: pointer;
}
.dsh-devpanel-palette-delete:hover {
  background: var(--dsh-term-surface-active);
  color: var(--dsh-term-danger);
}
.dsh-devpanel-palette-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 5px 12px;
  border-top: 1px solid var(--dsh-term-border);
  color: var(--dsh-term-muted);
  font-size: 11px;
}
.dsh-devpanel-palette-new {
  padding: 1px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsh-term-muted);
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-palette-new:hover {
  background: var(--dsh-term-surface);
  color: var(--dsh-term-fg);
}

/* Band-height drag handle: a slim strip above the terminals band that the
   user drags vertically (ns-resize); height persists to localStorage. */
.dsh-devpanel-resize {
  flex: none;
  height: 6px;
  cursor: ns-resize;
  touch-action: none;
  background: var(--dsh-term-bg);
}
.dsh-devpanel-resize:hover {
  background: var(--dsh-term-surface-active);
}

/* Every tab's terminal mount lives in one band; only the active one shows. */
.dsh-devpanel-terminals {
  position: relative;
  flex: none;
  height: 240px;
}
.dsh-devpanel-terminal {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: none;
  background: var(--dsh-term-bg);
}
.dsh-devpanel-terminal[data-active] {
  display: block;
}
.dsh-devpanel-terminal .xterm {
  position: relative;
  height: 100%;
  padding: 6px 8px;
  overflow: hidden;
}

.dsh-devpanel-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  flex: none;
}
.dsh-devpanel-toolbar button {
  padding: 2px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-3, #f3f4f6);
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-toolbar button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dsh-devpanel-toolbar button:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-devpanel-status {
  margin-left: auto;
  color: var(--dsw-alias-label-secondary, #4b5563);
}

.dsh-devpanel-output {
  min-height: 96px;
  max-height: 200px;
  overflow-y: auto;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--dsw-alias-bg-layer-1, #f9fafb);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 4px;
}

.dsh-devpanel-input-row {
  display: flex;
  gap: 8px;
  padding: 6px 0 0;
  flex: none;
}
.dsh-devpanel-input-row input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-3, #f3f4f6);
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
}
.dsh-devpanel-input-row input:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
}
.dsh-devpanel-terminal .xterm-viewport {
  background-color: var(--dsh-term-bg) !important;
}
/* The chat scroller's classic scrollbar runs the whole column height, so its
   light track and thumb read as a white strip beside the dark terminal band.
   Hide BOTH fully (the dialog already bleeds under the reserved gutter, so
   the dark surface fills edge-to-edge). The scrollbar keeps its layout width
   — no width:0 — so the reserved gutter and the whole column geometry stay
   put; the transcript still scrolls by wheel/touchpad. Doubled attribute
   selector raises specificity against the harness theme sheet; !important
   wins the cascade regardless of injection order. */
[data-conversation-scroll][data-conversation-scroll] {
  scrollbar-color: transparent transparent !important;
}
[data-conversation-scroll][data-conversation-scroll]::-webkit-scrollbar-track {
  background: transparent !important;
}
[data-conversation-scroll][data-conversation-scroll]::-webkit-scrollbar-thumb {
  background: transparent !important;
}
/* The terminal scrolls inside its own viewport: theme its bar dark too, so no
   engine-default light bar appears within the dark panel. */
.dsh-devpanel-terminal .xterm-viewport {
  scrollbar-color: var(--dsh-term-scroll-thumb) transparent;
  scrollbar-width: thin;
}
.dsh-devpanel-terminal .xterm-viewport::-webkit-scrollbar {
  width: 6px;
}
.dsh-devpanel-terminal .xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}
.dsh-devpanel-terminal .xterm-viewport::-webkit-scrollbar-thumb {
  background: var(--dsh-term-scroll-thumb);
  border-radius: 999px;
}
/* The multi-tab bar scrolls horizontally when tabs overflow: same dark-theme
   bar, or a default light bar would show under the dark tabs row. */
.dsh-devpanel-tabs::-webkit-scrollbar {
  height: 6px;
}
.dsh-devpanel-tabs::-webkit-scrollbar-track {
  background: transparent;
}
.dsh-devpanel-tabs::-webkit-scrollbar-thumb {
  background: var(--dsh-term-scroll-thumb);
  border-radius: 999px;
}
.dsh-devpanel-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary, #4b5563);
}

.dsh-devpanel-ai {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
}
.dsh-devpanel-ai-user {
  color: var(--dsw-alias-label-secondary, #4b5563);
  margin-bottom: 6px;
}
.dsh-devpanel-ai-assistant {
  color: var(--dsw-alias-label-primary, #111827);
  margin-bottom: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-devpanel-files {
  flex: none;
  max-height: 160px;
  overflow-y: auto;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsh-devpanel-file {
  text-align: left;
  padding: 3px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-devpanel-file:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dsh-devpanel-file[data-active] {
  background: var(--dsw-alias-bg-layer-3, #f3f4f6);
  color: var(--dsw-alias-state-business-primary, #2563eb);
}
.dsh-devpanel-file-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dsh-devpanel-file-path {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}
.dsh-devpanel-file-path-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-devpanel-file-maximize {
  flex: none;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-file-maximize:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, #111827);
}
/* "Open in terminal": writes cd + cat into the active PTY session. Same
   ghost-button treatment as the maximize toggle, with a monospace hint. */
.dsh-devpanel-file-terminal {
  flex: none;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  cursor: pointer;
}
.dsh-devpanel-file-terminal:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-state-business-primary, #2563eb);
}
/* Tail (-f like) log-view toggle: text-button state mirrors the maximize
   ghost button, but highlights (pressed) to signal the live-stream is on. */
.dsh-devpanel-file-tail {
  flex: none;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
}
.dsh-devpanel-file-tail:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dsh-devpanel-file-tail[data-active] {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  color: var(--dsw-alias-state-business-primary, #2563eb);
  background: var(--dsw-alias-fill-primary-hover, rgba(37, 99, 235, 0.1));
}
/* Diff mode (this session's edits vs the raw body): the toggle matches the
   tail button's pressed style; the pane is a scrolled diff surface. */
.dsh-devpanel-file-diff {
  flex: none;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
}
.dsh-devpanel-file-diff:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dsh-devpanel-file-diff[data-active] {
  border-color: var(--dsw-alias-state-business-primary, #2563eb);
  color: var(--dsw-alias-state-business-primary, #2563eb);
  background: var(--dsw-alias-fill-primary-hover, rgba(37, 99, 235, 0.1));
}
.dsh-devpanel-file-history {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
/* Live log pane: monospace, scrolls with new lines, wraps long lines. */
.dsh-devpanel-tail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--dsh-term-bg, #1b1b1f);
}
.dsh-devpanel-tail-content {
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsh-term-fg, #e4e4e7);
  white-space: pre-wrap;
  word-break: break-word;
}
.dsh-devpanel-tail-gone {
  color: var(--dsh-term-danger, #f26d78);
  font-style: italic;
}
.dsh-devpanel-file-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 8px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
}
.dsh-devpanel-file-image {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.dsh-devpanel-file-image img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}
.dsh-devpanel-file-code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
}
.dsh-devpanel-file-code pre {
  overflow: auto;
  margin: 0;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1, #f9fafb);
}
/* Fullscreen file viewer: fixed overlay covering the whole frame. */
.dsh-devpanel-file-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dsh-devpanel-file-fullscreen-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  flex: none;
}
.dsh-devpanel-file-fullscreen-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dsh-devpanel-file-fullscreen-body .dsh-devpanel-file-content,
.dsh-devpanel-file-fullscreen-body .dsh-devpanel-file-code,
.dsh-devpanel-file-fullscreen-body .dsh-devpanel-file-image,
.dsh-devpanel-file-fullscreen-body .dsh-devpanel-file-markdown {
  padding: 16px 24px;
}
.dsh-devpanel-file-markdown {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
  color: var(--dsw-alias-label-primary, #111827);
}
.dsh-devpanel-file-markdown pre {
  overflow: auto;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1, #f9fafb);
}

/* xterm.js core styles (inlined from @xterm/xterm/css/xterm.css — the client
   bundle has no CSS pipeline, so the theme ships this string instead). */
.xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
}
.xterm.focus,
.xterm:focus {
    outline: none;
}
.xterm .xterm-helpers {
    position: absolute;
    top: 0;
    z-index: 5;
}
.xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    white-space: nowrap;
    overflow: hidden;
    resize: none;
}
.xterm .composition-view {
    background: #000;
    color: #FFF;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
}
.xterm .composition-view.active {
    display: block;
}
.xterm .xterm-viewport {
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
}
.xterm .xterm-screen {
    position: relative;
}
.xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
}
.xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
}
.xterm.enable-mouse-events {
    cursor: default;
}
.xterm.xterm-cursor-pointer,
.xterm .xterm-cursor-pointer {
    cursor: pointer;
}
.xterm.column-select.focus {
    cursor: crosshair;
}
.xterm .xterm-accessibility:not(.debug),
.xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
}
.xterm .xterm-accessibility-tree:not(.debug) *::selection {
  color: transparent;
}
.xterm .xterm-accessibility-tree {
  font-family: monospace;
  user-select: text;
  white-space: pre;
}
.xterm .xterm-accessibility-tree > div {
  transform-origin: left;
  width: fit-content;
}
.xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
}
.xterm-dim {
    opacity: 1 !important;
}
.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }
.xterm-overline {
    text-decoration: overline;
}
.xterm-overline.xterm-underline-1 { text-decoration: overline underline; }
.xterm-overline.xterm-underline-2 { text-decoration: overline double underline; }
.xterm-overline.xterm-underline-3 { text-decoration: overline wavy underline; }
.xterm-overline.xterm-underline-4 { text-decoration: overline dotted underline; }
.xterm-overline.xterm-underline-5 { text-decoration: overline dashed underline; }
.xterm-strikethrough {
    text-decoration: line-through;
}
.xterm-screen .xterm-decoration-container .xterm-decoration {
	z-index: 6;
	position: absolute;
}
.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer {
	z-index: 7;
}
.xterm-decoration-overview-ruler {
    z-index: 8;
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
}
.xterm-decoration-top {
    z-index: 2;
    position: relative;
}
.xterm .xterm-scrollable-element > .scrollbar {
    cursor: default;
}
.xterm .xterm-scrollable-element > .scrollbar > .scra {
	cursor: pointer;
	font-size: 11px !important;
}
.xterm .xterm-scrollable-element > .visible {
	opacity: 1;
	background: rgba(0,0,0,0);
	transition: opacity 100ms linear;
	z-index: 11;
}
.xterm .xterm-scrollable-element > .invisible {
	opacity: 0;
	pointer-events: none;
}
.xterm .xterm-scrollable-element > .invisible.fade {
	transition: opacity 800ms linear;
}
.xterm .xterm-scrollable-element > .shadow {
	position: absolute;
	display: none;
}
.xterm .xterm-scrollable-element > .shadow.top {
	display: block;
	top: 0;
	left: 3px;
	height: 3px;
	width: 100%;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 0 6px 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.left {
	display: block;
	top: 3px;
	left: 0;
	height: 100%;
	width: 3px;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.top-left-corner {
	display: block;
	top: 0;
	left: 0;
	height: 3px;
	width: 3px;
}
.xterm .xterm-scrollable-element > .shadow.top.left {
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
`

/** Inject the console stylesheet for the plugin's lifetime. */
export function installConsoleStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = CONSOLE_STYLE_PLUGIN
    tag.textContent = CONSOLE_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, `${CONSOLE_STYLE_PLUGIN}: stylesheet`)
}
