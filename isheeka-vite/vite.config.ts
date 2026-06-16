import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" → relative asset paths so the build works on GitHub Pages
// (project sub-path), a custom domain, or local preview without edits.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
