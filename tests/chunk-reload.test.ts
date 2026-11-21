import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHUNK_RELOAD_KEY,
  clearChunkReloadGuard,
  isChunkLoadError,
  reloadOnceAfterChunkError,
} from "../client/src/lib/chunkReload";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("chunk reload guard", () => {
  it("recognises dynamic-import failures", () => {
    assert.equal(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/VotePage-abc.js")),
      true,
    );
    assert.equal(isChunkLoadError(new Error("network down")), false);
  });

  it("reloads once and then refuses", () => {
    const storage = memoryStorage();
    let reloads = 0;
    assert.equal(reloadOnceAfterChunkError(storage, () => { reloads += 1; }), true);
    assert.equal(reloads, 1);
    assert.equal(storage.getItem(CHUNK_RELOAD_KEY), "1");
    assert.equal(reloadOnceAfterChunkError(storage, () => { reloads += 1; }), false);
    assert.equal(reloads, 1);
    clearChunkReloadGuard(storage);
    assert.equal(reloadOnceAfterChunkError(storage, () => { reloads += 1; }), true);
    assert.equal(reloads, 2);
  });
});

describe("service worker shell", () => {
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  const main = readFileSync(new URL("../client/src/main.tsx", import.meta.url), "utf8");
  const prompt = readFileSync(new URL("../client/src/components/PWAUpdatePrompt.tsx", import.meta.url), "utf8");

  it("does not precache index.html and uses network-first navigations", () => {
    assert.match(vite, /globIgnores:\s*\["\*\*\/index\.html"\]/);
    assert.match(vite, /navigateFallback:\s*null/);
    assert.match(vite, /handler:\s*"NetworkFirst"/);
    assert.match(vite, /skipWaiting:\s*true/);
    assert.match(vite, /clientsClaim:\s*true/);
    assert.equal(vite.includes("**/*.{js,css,html,"), false);
  });

  it("skips the service worker plugin on Capacitor builds", () => {
    assert.match(vite, /capacitorBuild\s*\?\s*\[\]/);
    assert.match(prompt, /VITE_API_ORIGIN/);
    assert.match(main, /installChunkReloadRecovery/);
    assert.equal(main.includes("serviceWorker.register"), false);
  });

  it("tells Vercel not to cache the worker script", () => {
    assert.match(vercel, /\/sw\.js/);
    assert.match(vercel, /no-cache, no-store, must-revalidate/);
  });
});
