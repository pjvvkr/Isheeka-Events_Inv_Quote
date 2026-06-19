import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base: "./" → relative asset paths so the build works on GitHub Pages
// (project sub-path), a custom domain, or local preview without edits.
// The PWA manifest uses absolute "/" paths since the ERP is served at the
// Netlify domain root (isheeka-events-erp.netlify.app).
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"],
      manifest: {
        name: "Isheeka Events ERP",
        short_name: "Isheeka",
        description: "Isheeka Events — leads, quotes, invoices, events & vendor sourcing.",
        lang: "en",
        theme_color: "#A0123A",
        background_color: "#A0123A",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // app bundle is ~1.9 MB
      },
    }),
  ],
  build: { outDir: "dist", sourcemap: false },
});
