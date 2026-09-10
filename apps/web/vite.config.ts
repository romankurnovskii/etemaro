import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The daemon serves the built `dist/` at http://127.0.0.1:8765/.
// `pnpm dev` runs this app on :5173 and talks to the daemon on :8765.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173 },
})
