import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.voxdex.app",
  appName: "VoxDex",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
};

export default config;
