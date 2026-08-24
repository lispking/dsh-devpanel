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
  width: calc(100% + var(--dsh-composer-side-clearance, 16px) + var(--dsh-composer-side-clearance, 16px) + var(--dsh-scrollbar-width, 8px) + 8px);
  margin: 0 0 -8px;
  margin-left: calc(0px - var(--dsh-composer-side-clearance, 16px));
  margin-right: calc(0px - var(--dsh-composer-side-clearance, 16px) - var(--dsh-scrollbar-width, 8px) - 8px);
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  background: #1b1b1f;
  color: #e4e4e7;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dsh-devpanel-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  padding: 6px 12px;
  border-bottom: 1px solid #2c2c31;
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
  border-bottom: 1px solid #2c2c31;
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
  border: 1px solid #3b3b40;
  border-radius: 999px;
  color: #9b9ba3;
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
  color: #9b9ba3;
  font: inherit;
  cursor: pointer;
}
.dsh-devpanel-tab:hover {
  background: #26262c;
}
.dsh-devpanel-tab[data-active] {
  background: #2c2c33;
  color: #e4e4e7;
}
.dsh-devpanel-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-devpanel-tab-close {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  color: #9b9ba3;
  line-height: 1.4;
}
.dsh-devpanel-tab-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #f26d78;
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
  background: #1b1b1f;
  box-shadow: -8px 0 8px -8px rgba(0, 0, 0, 0.55);
}
.dsh-devpanel-tab-add {
  padding: 1px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #9b9ba3;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  cursor: pointer;
}
.dsh-devpanel-tab-add:hover {
  background: #26262c;
  color: #e4e4e7;
}
.dsh-devpanel-tabs-actions .dsh-devpanel-close {
  margin-left: 0;
  color: #9b9ba3;
}
.dsh-devpanel-tabs-actions .dsh-devpanel-close:hover {
  background: #26262c;
  color: #f26d78;
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
  background: #1b1b1f;
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
  background-color: #1b1b1f !important;
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
  scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  scrollbar-width: thin;
}
.dsh-devpanel-terminal .xterm-viewport::-webkit-scrollbar {
  width: 6px;
}
.dsh-devpanel-terminal .xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}
.dsh-devpanel-terminal .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.22);
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
  background: rgba(255, 255, 255, 0.22);
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
