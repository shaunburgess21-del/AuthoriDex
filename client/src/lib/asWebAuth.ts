import { registerPlugin } from "@capacitor/core";

/**
 * Local iOS plugin (`ios/App/App/AsWebAuthPlugin.swift`).
 * Opens Google's OAuth URL in ASWebAuthenticationSession and resolves with
 * the `com.voxdex.app://login` callback. Android and web never call it.
 */
export interface AsWebAuthPlugin {
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

export const AsWebAuth = registerPlugin<AsWebAuthPlugin>("AsWebAuth");
