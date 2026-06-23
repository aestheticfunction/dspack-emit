import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Allow importing the generated catalog + surface from the repo root (outside demo/).
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Ensure a single React instance is shared with @a2ui/react (avoids "Invalid hook call").
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"] },
  server: { fs: { allow: [repoRoot] } },
});
