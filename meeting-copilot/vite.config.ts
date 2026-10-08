import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const serverPort = Number(process.env.PORT ?? 8790)

export default defineConfig({
  plugins: [react()],
  // The page reads no import.meta.env variables, and .env holds the server's secrets: don't
  // load it. Otherwise editing .env restarts the dev server and can reload a page mid-meeting.
  envDir: false,
  server: {
    port: 5180,
    // A second `npm run dev` must fail loudly instead of moving to 5181 and leaving the
    // user testing the first, stale server (which still has the old .env).
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/health': `http://localhost:${serverPort}`,
      '/api': `http://localhost:${serverPort}`,
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
