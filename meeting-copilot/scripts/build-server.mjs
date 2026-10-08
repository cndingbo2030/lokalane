// Bundles the standalone server for production (`npm start`, Docker). Runtime
// dependencies (ws, the Anthropic SDK, ical.js) stay in node_modules.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist-server/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
