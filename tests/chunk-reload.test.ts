import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHUNK_RELOAD_KEY,
  boundaryRecovery,
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
    assert.equal(isChunkLoadError(new Error("Failed to fetch")), false);
    assert.equal(
      isChunkLoadError(
        new Error(
          'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
        ),
      ),
      true,
    );
    const named = new Error("module rejected");
    named.name = "ChunkLoadError";
    assert.equal(isChunkLoadError(named), true);
  });

  it("reloads a chunk failure once, then asks for a retry", () => {
    const storage = memoryStorage();
    let reloads = 0;
    const reload = () => {
      reloads += 1;
    };
    const chunk = new Error("Failed to fetch dynamically imported module: /assets/VotePage-abc.js");
    assert.equal(boundaryRecovery(new Error("network down"), storage, reload), "generic");
    assert.equal(reloads, 0);
    assert.equal(boundaryRecovery(chunk, storage, reload), "reload");
    assert.equal(reloads, 1);
    assert.equal(boundaryRecovery(chunk, storage, reload), "retry");
    assert.equal(reloads, 1);
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
  const boundary = readFileSync(new URL("../client/src/components/ErrorBoundary.tsx", import.meta.url), "utf8");
  const offline = readFileSync(new URL("../public/offline.html", import.meta.url), "utf8");

  it("does not precache index.html and uses network-first navigations", () => {
    assert.match(vite, /globIgnores:\s*\["\*\*\/index\.html"\]/);
    assert.match(vite, /globPatterns:\s*\["\*\*\/\*\.\{js,css,svg,png,woff2\}", "offline\.html"\]/);
    assert.match(vite, /navigateFallback:\s*null/);
    assert.match(vite, /handler:\s*"NetworkFirst"/);
    assert.match(vite, /networkTimeoutSeconds:\s*3/);
    assert.match(vite, /precacheFallback:\s*\{\s*fallbackURL:\s*"\/offline\.html"\s*\}/);
    assert.match(vite, /cleanupOutdatedCaches:\s*true/);
    assert.match(vite, /skipWaiting:\s*true/);
    assert.match(vite, /clientsClaim:\s*true/);
    assert.match(vite, /!path\.startsWith\("\/api\/"\)/);
    assert.match(vite, /!path\.startsWith\("\/attached_assets\/"\)/);
    assert.equal(vite.includes("**/*.{js,css,html,"), false);
  });

  it("falls back to a document with no app chunks", () => {
    assert.match(offline, /Can't reach VoxDex/);
    assert.match(offline, /location\.reload\(\)/);
    assert.equal(offline.includes("/assets/"), false);
    assert.equal(/<script\s+src=/i.test(offline), false);
    assert.match(boundary, /boundaryRecovery/);
    assert.match(boundary, /This page didn't load/);
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
