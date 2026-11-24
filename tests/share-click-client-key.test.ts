import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ipKeyGenerator } from "express-rate-limit";
import { shareClickClientKey } from "../server/services/share-click-client-key";

describe("share click client key", () => {
  it("uses req.ip and ignores a caller-supplied X-Forwarded-For hop", () => {
    const req = {
      ip: "203.0.113.10",
      headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.4" },
    };

    assert.equal(shareClickClientKey(req), ipKeyGenerator("203.0.113.10"));
    assert.notEqual(shareClickClientKey(req), ipKeyGenerator("198.51.100.7"));
  });

  it("normalises a missing ip to unknown and keeps an IPv6 key grouped", () => {
    assert.equal(shareClickClientKey({ ip: undefined }), "unknown");
    assert.equal(shareClickClientKey({ ip: "   " }), "unknown");
    assert.equal(shareClickClientKey({ ip: "2001:db8::1" }), ipKeyGenerator("2001:db8::1"));
  });

  it("wires the track-click limiter and the hash to that key", () => {
    const source = readFileSync(
      new URL("../server/route-modules/share-routes.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /keyGenerator:\s*shareClickClientKey/);
    assert.match(source, /ipKey:\s*shareClickClientKey\(req\)/);
    assert.match(source, /limit:\s*60/);
    assert.doesNotMatch(source, /x-forwarded-for/i);
  });
});
