/**
 * @file vite.config.ts
 * @description Vite build configuration bundling the monorepo into ESM entry files for Node 22.
 *
 * @features
 * - Builds Daemon and CLI as separate ESM bundles with sourcemaps
 * - Sets path aliases (@/domain, @/application, @/ports, @/adapters, @/interfaces, @/config, @/shared, @/legacy-bridge)
 *
 * @dependencies vite
 */
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: "./src/interfaces/daemon/Daemon.ts",
        cli: "./src/interfaces/cli/Cli.ts",
      },
      output: {
        entryFileNames: "[name].js",
        format: "esm",
      },
    },
  },
  resolve: {
    alias: {
      "@/domain": new URL("./src/domain/", import.meta.url).pathname,
      "@/application": new URL("./src/application/", import.meta.url).pathname,
      "@/ports": new URL("./src/ports/", import.meta.url).pathname,
      "@/adapters": new URL("./src/adapters/", import.meta.url).pathname,
      "@/interfaces": new URL("./src/interfaces/", import.meta.url).pathname,
      "@/config": new URL("./src/config/", import.meta.url).pathname,
      "@/shared": new URL("./src/shared/", import.meta.url).pathname,
      "@/legacy-bridge": new URL("./src/legacy-bridge/", import.meta.url).pathname,
    },
  },
});
