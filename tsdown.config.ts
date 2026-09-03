import { defineConfig } from 'tsdown'

/** Plugin id used by the client closure-factory loader registration. */
const PLUGIN_ID = 'dsh-devpanel'

/**
 * Module-table specifiers the client bundle must keep EXTERNAL: they resolve
 * through the injected require at runtime (the loader's module table), never
 * by bundling a second copy. Mirrors PLATFORM_MODULES + PRELOADED_CLIENT_EXTERNALS
 * in packages/client/web/src/platform.ts.
 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

/**
 * Two-face build mirroring the harness client preset (`clientBundle`):
 * - Host half: plain ESM node library (`lib/index.js`) — registers
 *   TerminalPanelService (a TypertRemoteService) so the browser can drive a
 *   real PTY through `ctx.subprocess.spawnTerminal`.
 * - Client half: browser CJS bundle wrapped in the `window.__ModuleLoader__`
 *   closure-factory format (`lib/client.js`) the web boot consumes. Externals
 *   resolve through the injected require; everything else (zod) is inlined.
 */
export default [
  defineConfig({
    name: `${PLUGIN_ID}/host`,
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }),
  defineConfig({
    name: `${PLUGIN_ID}/typert-host`,
    entry: { 'typert.host': 'lib/types/typert.host.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }),
  defineConfig({
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      // Requested module-table rows stay imports (the injected require answers
      // them); everything else (zod, local helpers) is bundled. A require the
      // table cannot answer is a guaranteed runtime throw, so this list is the
      // whole external surface.
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // Closure-factory contract from packages/client/tsdown.client.ts: the
      // bundle registers its factory with the module loader instead of
      // executing module bodies; externals resolve through the injected
      // require.
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }),
]
