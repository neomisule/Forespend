import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser only ever talks to this dev server. Any request starting with
// /api is forwarded ("proxied") to FastAPI on port 8000, so the browser never
// sees Nessie, the API key, or a different origin (no CORS needed).
// Set BACKEND_URL only if FastAPI runs somewhere other than port 8000.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
    },
  },
});
