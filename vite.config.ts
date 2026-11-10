import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The preview hostname is supplied per-session by the host environment.
// Only that exact hostname is allowed; localhost is always permitted.
const previewHosts = (process.env.PREVIEW_HOST ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  // GitHub Pages serves the app from a sub-path; the Pages build sets this to "./".
  base: process.env.VITE_BASE?.trim() || "/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    strictPort: true,
    allowedHosts: previewHosts,
  },
  build: {
    outDir: process.env.VITE_OUT_DIR?.trim() || "dist",
    sourcemap: false,
  },
});
