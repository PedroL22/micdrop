import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// A interface compilada fica em web/dist e é servida pelo Flask (app.py).
// No desenvolvimento (npm run dev), as chamadas /api e /media vão para o Flask na porta 5000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      "/api": "http://localhost:5000",
      "/media": "http://localhost:5000",
      "/qr.svg": "http://localhost:5000",
    },
  },
})
