import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "voxdex-logo.svg",
        "voxdex-favicon.svg",
        "fonts/vox-mark.woff2",
      ],
      manifest: {
        name: "VoxDex - Vox Populi",
        short_name: "VoxDex",
        description:
          "Track how famous people are trending. Vote, predict, and earn XP.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/voxdex-logo.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Prompt mode: new SW stays waiting until the user accepts via PWAUpdatePrompt.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        // Do not serve the SPA for /api/* navigations (e.g. opening OG JPG URLs in a tab).
        navigateFallbackDenylist: [/^\/api\//, /^\/attached_assets\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Function-form manualChunks: gives Rollup per-module control based on
        // the actual (async-only) import graph and matches nested deps the
        // object form misses (recharts' d3-*, react/jsx-runtime). The object
        // form was dragging recharts into the entry chunk (eagerly preloaded)
        // and leaving vendor-react empty.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Tiny class utilities behind the eagerly-used cn() helper (every
          // shadcn component). recharts ALSO depends on clsx, so if left
          // unassigned Rollup co-locates clsx into vendor-recharts and the
          // entry's static clsx import drags the whole 117 kB-gzip recharts
          // chunk into first paint. Pin them to the always-eager vendor-react.
          if (
            id.includes("/clsx/") ||
            id.includes("/tailwind-merge/") ||
            id.includes("/class-variance-authority/")
          )
            return "vendor-react";
          if (
            id.includes("recharts") ||
            id.includes("d3-") ||
            id.includes("victory-vendor")
          )
            return "vendor-recharts";
          if (id.includes("framer-motion") || id.includes("/motion/"))
            return "vendor-motion";
          if (id.includes("swiper")) return "vendor-swiper";
          if (id.includes("@tanstack/react-query")) return "vendor-query";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("react/jsx-runtime")
          )
            return "vendor-react";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
