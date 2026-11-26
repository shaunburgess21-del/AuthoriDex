import test from "node:test";
import assert from "node:assert/strict";

import { ogDocumentMetaCacheKey, type OgDocumentMeta } from "../shared/og-document";
import {
  clearOgDocumentMetaCache,
  documentMetaCachePolicy,
  readOrLoadOgDocumentMeta,
  setOgDocumentMetaCacheLimit,
  writeOgDocumentMetaCache,
  readOgDocumentMetaCache,
} from "../server/services/og-document-meta-cache";

const META: OgDocumentMeta = {
  title: "Novak Djokovic: Up or Down? | VoxDex",
  description: "UP 61% · DOWN 39%",
  canonicalUrl: "https://voxdex.com/predict/updown/abc",
};

function entry(title = META.title) {
  return {
    meta: { ...META, title },
    cacheControl: "public, max-age=120",
  };
}

test("document meta cache key ignores ref and keeps insights filters", () => {
  assert.equal(
    ogDocumentMetaCacheKey("/vote/matchups/seal-team-6-vs-delta-force?ref=VXABCDEF"),
    "/vote/matchups/seal-team-6-vs-delta-force",
  );
  assert.equal(
    ogDocumentMetaCacheKey("/vote/matchups/seal-team-6-vs-delta-force/?ref=VXZZZZZZ"),
    ogDocumentMetaCacheKey("/vote/matchups/seal-team-6-vs-delta-force?utm_source=share"),
  );
  assert.equal(ogDocumentMetaCacheKey("/insights?tab=discover&type=breakout"), "/insights?tab=discover&type=breakout");
  assert.equal(ogDocumentMetaCacheKey("/explore?type=breakout"), "/explore?type=breakout");
  assert.notEqual(
    ogDocumentMetaCacheKey("/insights?tab=rankings"),
    ogDocumentMetaCacheKey("/insights?tab=discover"),
  );
});

test("document meta cache policy matches the public cache-control windows", () => {
  assert.deepEqual(documentMetaCachePolicy(0), {
    cacheControl: "public, max-age=120",
    ttlMs: 120_000,
  });
  assert.deepEqual(documentMetaCachePolicy(2), {
    cacheControl: "public, max-age=60",
    ttlMs: 60_000,
  });
});

test("in-memory document meta cache expires, evicts, and does not store failures", async () => {
  clearOgDocumentMetaCache();
  writeOgDocumentMetaCache("a", entry("A"), 1_000, 0);
  assert.equal(readOgDocumentMetaCache("a", 999)?.meta.title, "A");
  assert.equal(readOgDocumentMetaCache("a", 1_000), undefined);

  setOgDocumentMetaCacheLimit(2);
  writeOgDocumentMetaCache("a", entry("A"), 5_000, 0);
  writeOgDocumentMetaCache("b", entry("B"), 5_000, 0);
  writeOgDocumentMetaCache("c", entry("C"), 5_000, 0);
  assert.equal(readOgDocumentMetaCache("a", 0), undefined);
  assert.equal(readOgDocumentMetaCache("b", 0)?.meta.title, "B");
  assert.equal(readOgDocumentMetaCache("c", 0)?.meta.title, "C");

  clearOgDocumentMetaCache();
  let calls = 0;
  await assert.rejects(() =>
    readOrLoadOgDocumentMeta("k", async () => {
      calls += 1;
      throw new Error("db down");
    }, 0),
  );
  await assert.rejects(() =>
    readOrLoadOgDocumentMeta("k", async () => {
      calls += 1;
      throw new Error("db down");
    }, 0),
  );
  assert.equal(calls, 2);
  assert.equal(readOgDocumentMetaCache("k", 0), undefined);

  const loaded = await readOrLoadOgDocumentMeta(
    "k",
    async () => ({ entry: entry(), ttlMs: 5_000 }),
    0,
  );
  assert.equal(loaded?.cache, "miss");
  const again = await readOrLoadOgDocumentMeta(
    "k",
    async () => {
      throw new Error("should be cached");
    },
    1,
  );
  assert.equal(again?.cache, "hit");
  assert.equal(again?.entry.meta.title, META.title);
  clearOgDocumentMetaCache();
});

test("concurrent document-meta loads share one fetch", async () => {
  clearOgDocumentMetaCache();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = async () => {
    calls += 1;
    await gate;
    return { entry: entry(), ttlMs: 5_000 };
  };
  const first = readOrLoadOgDocumentMeta("shared", load, 0);
  const second = readOrLoadOgDocumentMeta("shared", load, 0);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a?.cache, "miss");
  assert.equal(b?.cache, "hit");
  assert.equal(a?.entry.meta.canonicalUrl, META.canonicalUrl);
  clearOgDocumentMetaCache();
});
