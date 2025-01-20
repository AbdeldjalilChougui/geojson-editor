import { defineConfig } from "vite";

export default defineConfig({
  // Served from GitHub Pages at https://abdeldjalilchougui.github.io/geojson-editor/
  base: "/geojson-editor/",
  // The MapLibre worker is bundled explicitly (see src/maplibre-worker.ts).
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1500 },
  test: { include: ["test/**/*.test.ts"] },
} as never);
