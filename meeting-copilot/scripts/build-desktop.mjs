// Bundles the Electron main process (which embeds the copilot server) and the preload script.
import { build } from 'esbuild'

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: true, logLevel: 'info' }

await build({
  ...common,
  entryPoints: ['src/desktop/main.ts'],
  outfile: 'dist-electron/main.js',
  format: 'esm',
  // electron, ws and the Anthropic SDK are loaded from node_modules at runtime.
  packages: 'external',
})

await build({
  ...common,
  entryPoints: ['src/desktop/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
  // Sandboxed preloads must be CommonJS and may only require('electron').
  format: 'cjs',
  external: ['electron'],
})
