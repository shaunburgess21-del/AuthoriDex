import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeResolutionSources } from "../shared/lib/resolution-sources";

test("sanitizeResolutionSources keeps labeled sources and optional urls", () => {
  const out = sanitizeResolutionSources([
    { label: "Official UK Parliament result", url: "https://www.parliament.uk/" },
    { label: "  FIFA match report  " },
    { label: "", url: "https://example.com" },
  ]);
  assert.deepEqual(out, [
    { label: "Official UK Parliament result", url: "https://www.parliament.uk/" },
    { label: "FIFA match report" },
  ]);
});

test("sanitizeResolutionSources drops prediction-market platforms", () => {
  const out = sanitizeResolutionSources([
    { label: "Polymarket event page", url: "https://polymarket.com/event/foo" },
    { label: "Kalshi contract", url: "https://kalshi.com/markets/foo" },
    { label: "Box Office Mojo", url: "https://www.boxofficemojo.com/" },
  ]);
  assert.deepEqual(out, [
    { label: "Box Office Mojo", url: "https://www.boxofficemojo.com/" },
  ]);
});

test("sanitizeResolutionSources returns null for empty / invalid input", () => {
  assert.equal(sanitizeResolutionSources(null), null);
  assert.equal(sanitizeResolutionSources([]), null);
  assert.equal(sanitizeResolutionSources([{ url: "https://example.com" }]), null);
});

test("sanitizeResolutionSources dedupes by label (case-insensitive)", () => {
  const out = sanitizeResolutionSources([
    { label: "FIFA match report", url: "https://www.fifa.com/a" },
    { label: "fifa match report", url: "https://www.fifa.com/b" },
    { label: "UEFA.com" },
  ]);
  assert.deepEqual(out, [
    { label: "FIFA match report", url: "https://www.fifa.com/a" },
    { label: "UEFA.com" },
  ]);
});
