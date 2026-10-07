import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const serverPort = Number(process.env.PORT ?? 8790)

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
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
