import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Excalidraw checks process.env.IS_PREACT at runtime; Vite strips process.env
  // so we must define it or the editor throws "process is not defined".
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
    // Forward API + WebSocket traffic to the monolith node server in dev,
    // so the frontend's same-origin assumption holds.
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
});
