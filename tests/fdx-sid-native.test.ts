import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { Request, Response } from "express";

import {
  fetchWithNativeFdxSid,
  FDX_SID_STORAGE_KEY,
  installNativeOriginPatch,
  readStoredFdxSid,
} from "../client/src/lib/nativeOrigin";
import {
  applyNativeCorsHeaders,
  ensureFdxSid,
  FDX_SID_HEADER,
  NATIVE_CORS_ALLOW_HEADERS,
  NATIVE_CORS_EXPOSE_HEADERS,
  readFdxSid,
} from "../server/lib/anonIdentity";
import { normalizeFdxSid } from "../shared/lib/fdxSid";

const SID = "6829bab2-e65b-4f0c-9854-ce7e143dcf40";
const OTHER = "9486c52b-4208-4079-aff3-148d36178af0";

function mockReq(init: {
  origin?: string;
  cookie?: string;
  fdxSid?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (init.origin) headers.origin = init.origin;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.fdxSid) headers["x-fdx-sid"] = init.fdxSid;
  return {
    headers,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function mockRes(): Response & {
  headers: Map<string, string>;
  cookies: { name: string; value: string }[];
} {
  const headers = new Map<string, string>();
  const cookies: { name: string; value: string }[] = [];
  const res = {
    locals: {} as Record<string, unknown>,
    headersSent: false,
    headers,
    cookies,
    setHeader(name: string, value: number | string | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return res;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    cookie(name: string, value: string) {
      cookies.push({ name, value });
      return res;
    },
    end(..._args: unknown[]) {
      res.headersSent = true;
      return res;
    },
    write(..._args: unknown[]) {
      res.headersSent = true;
      return true;
    },
  };
  return res as unknown as Response & {
    headers: Map<string, string>;
    cookies: { name: string; value: string }[];
  };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  } as Storage;
}

describe("normalizeFdxSid", () => {
  it("accepts a lowercase and uppercase UUID", () => {
    assert.equal(normalizeFdxSid(SID), SID);
    assert.equal(normalizeFdxSid(`  ${SID.toUpperCase()}  `), SID);
  });

  it("rejects non-UUIDs", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      "short",
      "00000000-0000-0000-0000-000000000000",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      `${SID}\r\nSet-Cookie: pwned=1`,
      `${SID}; Path=/`,
    ]) {
      assert.equal(normalizeFdxSid(bad), "", bad);
    }
  });
});

describe("readFdxSid", () => {
  it("uses a strict-UUID X-Fdx-Sid header on native origins when the cookie is absent", () => {
    for (const origin of ["capacitor://localhost", "https://localhost"]) {
      const req = mockReq({ origin, fdxSid: SID.toUpperCase() });
      assert.equal(readFdxSid(req), SID);
      assert.equal(readFdxSid(req) ? `anon_${readFdxSid(req)}` : "", `anon_${SID}`);
    }
  });

  it("rejects a native header that is not a strict UUID", () => {
    const req = mockReq({
      origin: "capacitor://localhost",
      fdxSid: "not-a-uuid",
    });
    assert.equal(readFdxSid(req), "");
  });

  it("ignores the header on web origins", () => {
    for (const origin of [undefined, "https://voxdex.com", "http://localhost:5000"]) {
      const req = mockReq({ origin, fdxSid: SID });
      assert.equal(readFdxSid(req), "");
    }
  });

  it("prefers the cookie over the header", () => {
    const req = mockReq({
      origin: "capacitor://localhost",
      cookie: `fdx_sid=${OTHER}`,
      fdxSid: SID,
    });
    assert.equal(readFdxSid(req), OTHER);
  });
});

describe("ensureFdxSid", () => {
  it("reuses the incoming native header on the same request and echoes it", () => {
    const req = mockReq({ origin: "capacitor://localhost", fdxSid: SID });
    const res = mockRes();
    const sid = ensureFdxSid(req, res);
    assert.equal(sid, SID);
    assert.equal(readFdxSid(req), SID);
    assert.equal(res.headers.get("x-fdx-sid"), SID);
    assert.deepEqual(res.cookies, [{ name: "fdx_sid", value: SID }]);

    res.setHeader("Cache-Control", "public, max-age=30");
    res.end();
    assert.equal(res.headers.get("x-fdx-sid"), SID);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });

  it("mints an id when a native anon-budget request has none", () => {
    const req = mockReq({ origin: "https://localhost" });
    const res = mockRes();
    assert.equal(readFdxSid(req), "");
    const minted = ensureFdxSid(req, res);
    assert.equal(normalizeFdxSid(minted), minted);
    assert.equal(res.headers.get("x-fdx-sid"), minted);
    assert.equal(res.cookies[0]?.value, minted);

    const followUp = mockReq({ origin: "https://localhost", fdxSid: minted });
    assert.equal(readFdxSid(followUp), minted);
    assert.equal(`anon_${readFdxSid(followUp)}`, `anon_${minted}`);
  });

  it("keeps web responses cookie-only", () => {
    const req = mockReq({ origin: "https://voxdex.com", fdxSid: SID });
    const res = mockRes();
    const minted = ensureFdxSid(req, res);
    assert.notEqual(minted, SID);
    assert.equal(normalizeFdxSid(minted), minted);
    assert.equal(res.headers.get("x-fdx-sid"), undefined);
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0]?.name, "fdx_sid");

    res.setHeader("Cache-Control", "public, max-age=30");
    res.end();
    assert.equal(res.headers.get("x-fdx-sid"), undefined);
    assert.equal(res.headers.get("cache-control"), "public, max-age=30");
  });
});

describe("native CORS", () => {
  it("allows and exposes X-Fdx-Sid", () => {
    const res = mockRes();
    applyNativeCorsHeaders(res, "capacitor://localhost");
    assert.equal(res.headers.get("access-control-allow-origin"), "capacitor://localhost");
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.equal(res.headers.get("access-control-allow-headers"), NATIVE_CORS_ALLOW_HEADERS);
    assert.equal(res.headers.get("access-control-expose-headers"), NATIVE_CORS_EXPOSE_HEADERS);
    assert.match(NATIVE_CORS_ALLOW_HEADERS, /X-Fdx-Sid/);
    assert.equal(NATIVE_CORS_EXPOSE_HEADERS, FDX_SID_HEADER);
  });

  it("is applied only after the native-origin check", () => {
    const index = readFileSync("server/index.ts", "utf8");
    assert.match(index, /if \(!isNativeAppOrigin\(req\)\) \{\s*next\(\);\s*return;\s*\}/);
    assert.match(index, /applyNativeCorsHeaders\(res, origin\)/);
    const auth = readFileSync("server/auth-middleware.ts", "utf8");
    assert.match(auth, /const fdxSid = readFdxSid\(req\);\s*if \(fdxSid\) \{\s*req\.sessionId = `anon_\$\{fdxSid\}`;/);
    const routes = readFileSync("server/routes.ts", "utf8");
    assert.match(routes, /const fdxSidForCleanup = readFdxSid\(req\);/);
  });
});

describe("native fetch sid", () => {
  const rewrite = (url: string) =>
    url.startsWith("/") ? `https://voxdex.com${url}` : url;

  it("stores X-Fdx-Sid from /api/anon-budget and sends it on later /api calls", async () => {
    const storage = memoryStorage();
    const seen: { url: string; sid: string | null; authorization: string | null }[] = [];

    const fakeFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        sid: headers.get(FDX_SID_HEADER),
        authorization: headers.get("Authorization"),
      });
      const responseSid = seen.length === 1 ? SID : null;
      return new Response("{}", {
        headers: responseSid ? { [FDX_SID_HEADER]: responseSid.toUpperCase() } : undefined,
      });
    };

    await fetchWithNativeFdxSid(
      fakeFetch,
      "/api/anon-budget",
      undefined,
      storage,
      rewrite,
    );
    assert.equal(seen[0]?.url, "https://voxdex.com/api/anon-budget");
    assert.equal(seen[0]?.sid, null);
    assert.equal(readStoredFdxSid(storage), SID);
    assert.equal(storage.getItem(FDX_SID_STORAGE_KEY), SID);

    await fetchWithNativeFdxSid(
      fakeFetch,
      "/api/polls/pineapple-on-pizza/vote",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      storage,
      rewrite,
    );
    assert.equal(seen[1]?.sid, SID);
    assert.equal(seen[1]?.authorization, null);

    await fetchWithNativeFdxSid(
      fakeFetch,
      "/api/profile/sync",
      {
        method: "POST",
        headers: { Authorization: "Bearer signup-token", "Content-Type": "application/json" },
      },
      storage,
      rewrite,
    );
    assert.equal(seen[2]?.url, "https://voxdex.com/api/profile/sync");
    assert.equal(seen[2]?.sid, SID);
    assert.equal(seen[2]?.authorization, "Bearer signup-token");
    assert.equal(readStoredFdxSid(storage), SID);
  });

  it("does not attach or store the id for non-api fetches", async () => {
    const storage = memoryStorage();
    storage.setItem(FDX_SID_STORAGE_KEY, SID);
    let requestSid: string | null = "unset";
    const fakeFetch: typeof fetch = async (_input, init) => {
      requestSid = new Headers(init?.headers).get(FDX_SID_HEADER);
      return new Response("", { headers: { [FDX_SID_HEADER]: OTHER } });
    };
    await fetchWithNativeFdxSid(
      fakeFetch,
      "/attached_assets/card.png",
      undefined,
      storage,
      rewrite,
    );
    assert.equal(requestSid, null);
    assert.equal(storage.getItem(FDX_SID_STORAGE_KEY), SID);
  });

  it("does not replace a stored id with a non-UUID response header", async () => {
    const storage = memoryStorage();
    storage.setItem(FDX_SID_STORAGE_KEY, SID);
    const fakeFetch: typeof fetch = async () =>
      new Response("{}", { headers: { [FDX_SID_HEADER]: "not-a-uuid" } });
    await fetchWithNativeFdxSid(fakeFetch, "/api/anon-budget", undefined, storage, rewrite);
    assert.equal(readStoredFdxSid(storage), SID);
  });

  it("forgets the stored id after signup creates the account", async () => {
    const storage = memoryStorage();
    storage.setItem(FDX_SID_STORAGE_KEY, SID);
    let sent: string | null = null;
    const fakeFetch: typeof fetch = async (_input, init) => {
      sent = new Headers(init?.headers).get(FDX_SID_HEADER);
      return new Response(JSON.stringify({ created: true, profile: { id: "user" } }), {
        headers: { "Content-Type": "application/json", [FDX_SID_HEADER]: SID },
      });
    };
    await fetchWithNativeFdxSid(
      fakeFetch,
      "/api/profile/sync",
      { method: "POST", headers: { Authorization: "Bearer signup-token" } },
      storage,
      rewrite,
    );
    assert.equal(sent, SID);
    assert.equal(storage.getItem(FDX_SID_STORAGE_KEY), null);

    storage.setItem(FDX_SID_STORAGE_KEY, SID);
    const returning: typeof fetch = async () =>
      new Response(JSON.stringify({ created: false }), {
        headers: { "Content-Type": "application/json", [FDX_SID_HEADER]: SID },
      });
    await fetchWithNativeFdxSid(returning, "/api/profile/sync", { method: "POST" }, storage, rewrite);
    assert.equal(storage.getItem(FDX_SID_STORAGE_KEY), SID);
  });

  it("does not patch fetch on the web build", () => {
    const globalWithWindow = globalThis as { window?: unknown };
    const previous = globalWithWindow.window;
    const fetchSentinel = () => Promise.resolve(new Response(""));
    globalWithWindow.window = {
      fetch: fetchSentinel,
      localStorage: memoryStorage(),
      location: { origin: "https://voxdex.com" },
      EventSource: class {},
    };
    try {
      installNativeOriginPatch();
      assert.equal(
        (globalWithWindow.window as { fetch: unknown }).fetch,
        fetchSentinel,
      );
    } finally {
      globalWithWindow.window = previous;
    }
  });
});
