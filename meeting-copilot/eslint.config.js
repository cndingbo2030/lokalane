import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'dist-server', 'release', 'node_modules']),
  {
    files: ['src/web/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'src/eval/**/*.ts', 'src/desktop/**/*.ts', '*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.audioWorklet } },
  },
])
