import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "child_process";

const host = process.env.TAURI_DEV_HOST;
const buildDate = new Date().toISOString().slice(0, 16).replace("T", " ");
const buildCommit = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();

// https://tauri.app/start/frontend/vite/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  base: "./",
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  esbuild: {
    charset: "utf8",
  },
  build: {
    charset: "utf8",
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  // Supabase secrets: only VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (anon key).
  // Never expose service_role via VITE_* — it would ship inside the desktop bundle.
}));
