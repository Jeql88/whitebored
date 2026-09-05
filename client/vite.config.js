/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep a single React instance. The workspace has React 19 both at the root and
  // in this client; deduping guards component tests (and dev) against loading two
  // Reacts — the classic "Objects are not valid as a React child".
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  // The crop-grouping module is shared with the server (pure, dependency-free) so
  // the client and the recognizer cannot disagree about what a crop is. It is
  // CommonJS and lives OUTSIDE this workspace root, so Rollup skips its usual
  // CJS interop for it; including it here applies the transform and makes its
  // `module.exports` importable as a default binding.
  build: {
    commonjsOptions: {
      include: [/server[\/]recognition/, /node_modules/],
    },
  },
  // Vite refuses to serve files above the project root in dev unless allowed.
  server: {
    fs: { allow: [".."] },
  },
  // Component/behaviour tests run in jsdom via Vitest (see client tests, e.g.
  // src/components/**/*.test.jsx). globals:true so tests read like the server
  // suite (bare test/expect); the setup file registers jest-dom matchers and
  // cleans the rendered DOM between tests.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    css: false,
    // The Testing Library packages are hoisted to the workspace ROOT, while
    // vitest lives in this client workspace. @testing-library/jest-dom's vitest
    // entry does a bare `import "vitest"` which Node can't resolve from the root.
    // Inlining these packages routes that import through Vite's resolver (which
    // finds the client's vitest), so the matchers register. Match resolved file
    // paths — backslashes on Windows.
    server: {
      deps: {
        inline: [/node_modules[\\/]@testing-library[\\/]/],
      },
    },
  },
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
