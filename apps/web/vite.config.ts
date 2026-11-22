import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The daemon serves the built `dist/` at http://127.0.0.1:8765/.
// `pnpm dev` runs this app on :5173 and talks to the daemon on :8765.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // Bind IPv4 loopback explicitly: the default resolves to `[::1]` only, so
  // `http://127.0.0.1:5173` is refused and browsers that prefer IPv4 fail.
  server: { host: '127.0.0.1', port: 5173 },
})
