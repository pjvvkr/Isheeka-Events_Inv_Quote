// vite.config.ts
import { defineConfig } from "file:///sessions/nifty-dazzling-planck/mnt/GitHub/isheeka-vite/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/nifty-dazzling-planck/mnt/GitHub/isheeka-vite/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/nifty-dazzling-planck/mnt/GitHub/isheeka-vite/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"],
      manifest: {
        name: "Isheeka Events ERP",
        short_name: "Isheeka",
        description: "Isheeka Events \u2014 leads, quotes, invoices, events & vendor sourcing.",
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
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
        // app bundle is ~1.9 MB
      }
    })
  ],
  build: { outDir: "dist", sourcemap: false }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvbmlmdHktZGF6emxpbmctcGxhbmNrL21udC9HaXRIdWIvaXNoZWVrYS12aXRlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvbmlmdHktZGF6emxpbmctcGxhbmNrL21udC9HaXRIdWIvaXNoZWVrYS12aXRlL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9uaWZ0eS1kYXp6bGluZy1wbGFuY2svbW50L0dpdEh1Yi9pc2hlZWthLXZpdGUvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gXCJ2aXRlLXBsdWdpbi1wd2FcIjtcblxuLy8gYmFzZTogXCIuL1wiIFx1MjE5MiByZWxhdGl2ZSBhc3NldCBwYXRocyBzbyB0aGUgYnVpbGQgd29ya3Mgb24gR2l0SHViIFBhZ2VzXG4vLyAocHJvamVjdCBzdWItcGF0aCksIGEgY3VzdG9tIGRvbWFpbiwgb3IgbG9jYWwgcHJldmlldyB3aXRob3V0IGVkaXRzLlxuLy8gVGhlIFBXQSBtYW5pZmVzdCB1c2VzIGFic29sdXRlIFwiL1wiIHBhdGhzIHNpbmNlIHRoZSBFUlAgaXMgc2VydmVkIGF0IHRoZVxuLy8gTmV0bGlmeSBkb21haW4gcm9vdCAoaXNoZWVrYS1ldmVudHMtZXJwLm5ldGxpZnkuYXBwKS5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIGJhc2U6IFwiLi9cIixcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgVml0ZVBXQSh7XG4gICAgICByZWdpc3RlclR5cGU6IFwiYXV0b1VwZGF0ZVwiLFxuICAgICAgc3RyYXRlZ2llczogXCJpbmplY3RNYW5pZmVzdFwiLFxuICAgICAgc3JjRGlyOiBcInNyY1wiLFxuICAgICAgZmlsZW5hbWU6IFwic3cuanNcIixcbiAgICAgIGluY2x1ZGVBc3NldHM6IFtcImljb25zL2ljb24tMTkyLnBuZ1wiLCBcImljb25zL2ljb24tNTEyLnBuZ1wiLCBcImljb25zL2ljb24tNTEyLW1hc2thYmxlLnBuZ1wiXSxcbiAgICAgIG1hbmlmZXN0OiB7XG4gICAgICAgIG5hbWU6IFwiSXNoZWVrYSBFdmVudHMgRVJQXCIsXG4gICAgICAgIHNob3J0X25hbWU6IFwiSXNoZWVrYVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJJc2hlZWthIEV2ZW50cyBcdTIwMTQgbGVhZHMsIHF1b3RlcywgaW52b2ljZXMsIGV2ZW50cyAmIHZlbmRvciBzb3VyY2luZy5cIixcbiAgICAgICAgbGFuZzogXCJlblwiLFxuICAgICAgICB0aGVtZV9jb2xvcjogXCIjQTAxMjNBXCIsXG4gICAgICAgIGJhY2tncm91bmRfY29sb3I6IFwiI0EwMTIzQVwiLFxuICAgICAgICBkaXNwbGF5OiBcInN0YW5kYWxvbmVcIixcbiAgICAgICAgb3JpZW50YXRpb246IFwicG9ydHJhaXRcIixcbiAgICAgICAgc3RhcnRfdXJsOiBcIi9cIixcbiAgICAgICAgc2NvcGU6IFwiL1wiLFxuICAgICAgICBpY29uczogW1xuICAgICAgICAgIHsgc3JjOiBcIi9pY29ucy9pY29uLTE5Mi5wbmdcIiwgc2l6ZXM6IFwiMTkyeDE5MlwiLCB0eXBlOiBcImltYWdlL3BuZ1wiLCBwdXJwb3NlOiBcImFueVwiIH0sXG4gICAgICAgICAgeyBzcmM6IFwiL2ljb25zL2ljb24tNTEyLnBuZ1wiLCBzaXplczogXCI1MTJ4NTEyXCIsIHR5cGU6IFwiaW1hZ2UvcG5nXCIsIHB1cnBvc2U6IFwiYW55XCIgfSxcbiAgICAgICAgICB7IHNyYzogXCIvaWNvbnMvaWNvbi01MTItbWFza2FibGUucG5nXCIsIHNpemVzOiBcIjUxMng1MTJcIiwgdHlwZTogXCJpbWFnZS9wbmdcIiwgcHVycG9zZTogXCJtYXNrYWJsZVwiIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgaW5qZWN0TWFuaWZlc3Q6IHtcbiAgICAgICAgZ2xvYlBhdHRlcm5zOiBbXCIqKi8qLntqcyxjc3MsaHRtbCxwbmcsc3ZnLHdvZmYyfVwiXSxcbiAgICAgICAgbWF4aW11bUZpbGVTaXplVG9DYWNoZUluQnl0ZXM6IDQgKiAxMDI0ICogMTAyNCwgLy8gYXBwIGJ1bmRsZSBpcyB+MS45IE1CXG4gICAgICB9LFxuICAgIH0pLFxuICBdLFxuICBidWlsZDogeyBvdXREaXI6IFwiZGlzdFwiLCBzb3VyY2VtYXA6IGZhbHNlIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBdVYsU0FBUyxvQkFBb0I7QUFDcFgsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQU14QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixNQUFNO0FBQUEsRUFDTixTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixRQUFRO0FBQUEsTUFDTixjQUFjO0FBQUEsTUFDZCxZQUFZO0FBQUEsTUFDWixRQUFRO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixlQUFlLENBQUMsc0JBQXNCLHNCQUFzQiw2QkFBNkI7QUFBQSxNQUN6RixVQUFVO0FBQUEsUUFDUixNQUFNO0FBQUEsUUFDTixZQUFZO0FBQUEsUUFDWixhQUFhO0FBQUEsUUFDYixNQUFNO0FBQUEsUUFDTixhQUFhO0FBQUEsUUFDYixrQkFBa0I7QUFBQSxRQUNsQixTQUFTO0FBQUEsUUFDVCxhQUFhO0FBQUEsUUFDYixXQUFXO0FBQUEsUUFDWCxPQUFPO0FBQUEsUUFDUCxPQUFPO0FBQUEsVUFDTCxFQUFFLEtBQUssdUJBQXVCLE9BQU8sV0FBVyxNQUFNLGFBQWEsU0FBUyxNQUFNO0FBQUEsVUFDbEYsRUFBRSxLQUFLLHVCQUF1QixPQUFPLFdBQVcsTUFBTSxhQUFhLFNBQVMsTUFBTTtBQUFBLFVBQ2xGLEVBQUUsS0FBSyxnQ0FBZ0MsT0FBTyxXQUFXLE1BQU0sYUFBYSxTQUFTLFdBQVc7QUFBQSxRQUNsRztBQUFBLE1BQ0Y7QUFBQSxNQUNBLGdCQUFnQjtBQUFBLFFBQ2QsY0FBYyxDQUFDLGtDQUFrQztBQUFBLFFBQ2pELCtCQUErQixJQUFJLE9BQU87QUFBQTtBQUFBLE1BQzVDO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBQ0EsT0FBTyxFQUFFLFFBQVEsUUFBUSxXQUFXLE1BQU07QUFDNUMsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
