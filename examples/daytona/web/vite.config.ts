import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

export default defineConfig(({ command }) => ({
  root: here,
  base: "./",
  publicDir: false,
  plugins: command === "build" ? [viteSingleFile()] : [],
  resolve: {
    alias: {
      "@atomic-content-protocol/core": path.resolve(here, "shims/core.ts"),
      "@atomic-content-protocol/enrichment": path.resolve(here, "shims/enrichment.ts"),
      fs: path.resolve(here, "shims/fs.ts"),
      "node:fs": path.resolve(here, "shims/fs.ts"),
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: path.resolve(here, "site"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
  },
}));
