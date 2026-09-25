import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.voxdex.app",
  appName: "VoxDex",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SystemBars: {
      // Bundled with @capacitor/core (not a new plugin). Pin "css" so Android
      // keeps injecting --safe-area-inset-* even if a future Capacitor major
      // defaults insetsHandling to "native". Android-only.
      insetsHandling: "css",
      // index.html already sets viewport-fit=cover. Hint it so the first
      // inset pass is edge-to-edge instead of a padded frame that then jumps.
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
