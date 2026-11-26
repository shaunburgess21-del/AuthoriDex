import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  attemptTimeoutMs,
  BROWSER_BUDGET_MS,
  CRAWLER_BUDGET_MS,
  handleOgDocument,
  HTML_TIMEOUT_MS,
  INJECTED_HTML_CACHE_CONTROL,
  INJECTED_HTML_CDN_CACHE_CONTROL,
  isOgCrawlerUserAgent,
  JSON_TIMEOUT_MS,
  resolveUpstreamBudget,
  SHELL_TIMEOUT_MS,
  type OgFetch,
  type OgInjectDeps,
} from "../shared/og-inject";
import type { OgDocumentMeta } from "../shared/og-document";

const SHELL = fs.readFileSync("client/index.html", "utf8");

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GOOGLEBOT =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const META: OgDocumentMeta = {
  title: "Seal Team 6 vs Delta Force | VoxDex",
  description: "Delta Force leads with 57% of 7 votes.",
  canonicalUrl: "https://voxdex.com/vote/matchups/seal-team-6-vs-delta-force",
  imageUrl: "https://voxdex.com/api/og/vote/matchups/seal-team-6-vs-delta-force.png",
  imageType: "image/png",
};

const PASS = new Response(null, {
  status: 204,
  headers: { "x-og-passthrough": "1" },
});

function isPass(response: Response): boolean {
  return response.headers.get("x-og-passthrough") === "1";
}

function detailRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://voxdex.com${path}`, {
    headers: {
      "user-agent": CHROME,
      "sec-fetch-dest": "document",
      ...headers,
    },
  });
}

function hang(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    // AbortSignal.timeout() uses an unref'd timer. Hold a ref'd timer so the
    // test process stays alive until that signal actually fires.
    const backup = setTimeout(() => reject(new Error("abort signal did not fire")), 2_000);
    const fail = (err: unknown) => {
      clearTimeout(backup);
      reject(err);
    };
    if (!signal) {
      fail(new Error("missing abort signal"));
      return;
    }
    if (signal.aborted) {
      fail(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => fail(signal.reason), { once: true });
  });
}

interface Call {
  url: string;
  headers: Headers;
}

function deps(
  fetchImpl: OgFetch,
  extra: Partial<OgInjectDeps> = {},
): { deps: OgInjectDeps; calls: Call[] } {
  const calls: Call[] = [];
  const wrapped: OgFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return fetchImpl(input, init);
  };
  return {
    calls,
    deps: {
      fetch: wrapped,
      now: () => Date.now(),
      readCache: async () => null,
      writeCache: async () => undefined,
      passThrough: () => PASS,
      origin: "https://og.test",
      ...extra,
    },
  };
}

test("budgets: browsers are capped, crawlers keep the long windows", () => {
  assert.equal(BROWSER_BUDGET_MS, 1_200);
  assert.equal(JSON_TIMEOUT_MS, 900);
  assert.equal(HTML_TIMEOUT_MS, 4_000);
  assert.equal(SHELL_TIMEOUT_MS, 1_000);
  assert.equal(CRAWLER_BUDGET_MS, JSON_TIMEOUT_MS + HTML_TIMEOUT_MS);
  assert.equal(resolveUpstreamBudget(CHROME), BROWSER_BUDGET_MS);
  assert.equal(resolveUpstreamBudget(null), BROWSER_BUDGET_MS);
  assert.equal(resolveUpstreamBudget("Twitterbot/1.0"), CRAWLER_BUDGET_MS);
  assert.equal(resolveUpstreamBudget("facebookexternalhit/1.1"), CRAWLER_BUDGET_MS);
  assert.equal(resolveUpstreamBudget("WhatsApp/2.23"), CRAWLER_BUDGET_MS);
  assert.equal(resolveUpstreamBudget(GOOGLEBOT), CRAWLER_BUDGET_MS);
  assert.equal(isOgCrawlerUserAgent(GOOGLEBOT), true);
  assert.equal(isOgCrawlerUserAgent(CHROME), false);
  assert.equal(resolveUpstreamBudget(GOOGLEBOT, 40), 40);

  assert.equal(attemptTimeoutMs({ phase: "json", timeLeftMs: 5_000, crawler: false }), 5_000);
  assert.equal(attemptTimeoutMs({ phase: "json", timeLeftMs: 5_000, crawler: true }), 900);
  assert.equal(attemptTimeoutMs({ phase: "html", timeLeftMs: 5_000, crawler: true }), 4_000);
  assert.equal(attemptTimeoutMs({ phase: "html", timeLeftMs: 250, crawler: true }), 250);
  assert.equal(attemptTimeoutMs({ phase: "shell", timeLeftMs: 9_000, crawler: false }), 1_000);
  assert.equal(attemptTimeoutMs({ phase: "shell", timeLeftMs: 0, crawler: false }), 0);
  assert.equal(attemptTimeoutMs({ phase: "json", timeLeftMs: -5, crawler: false }), 0);
});

test("a hung JSON meta fetch falls through inside the browser budget", async () => {
  const { deps: injectDeps, calls } = deps((_input, init) => hang(init?.signal), { budgetMs: 80 });
  const started = Date.now();
  const response = await handleOgDocument(
    detailRequest("/vote/matchups/seal-team-6-vs-delta-force"),
    injectDeps,
  );
  const elapsed = Date.now() - started;
  assert.equal(isPass(response), true);
  assert.ok(elapsed < 400, `waited ${elapsed}ms`);
  assert.equal(calls.some((call) => call.url.includes("/index.html")), false);
  assert.equal(response.status, 204);
});

test("a fast JSON miss does not wait out the old HTML timeout", async () => {
  const { deps: injectDeps, calls } = deps(async (input, init) => {
    const url = String(input);
    if (url.includes("/api/og/document-meta")) return new Response("nope", { status: 404 });
    return hang(init?.signal);
  }, { budgetMs: 120 });
  const started = Date.now();
  const response = await handleOgDocument(
    detailRequest("/vote/opinion-polls/best-female-body-type"),
    injectDeps,
  );
  const elapsed = Date.now() - started;
  assert.equal(isPass(response), true);
  assert.ok(elapsed < 500, `waited ${elapsed}ms`);
  assert.ok(elapsed < HTML_TIMEOUT_MS);
  assert.equal(calls.some((call) => call.url.includes("/api/og/opinion-polls/")), true);
  assert.equal(calls.some((call) => call.url.includes("/index.html")), false);
});

test("a hung shell fetch falls through and does not reject", async () => {
  const { deps: injectDeps } = deps(async (input, init) => {
    const url = String(input);
    if (url.includes("/api/og/document-meta")) {
      return Response.json(META);
    }
    return hang(init?.signal);
  }, { budgetMs: 5_000, shellTimeoutMs: 80 });
  const started = Date.now();
  const response = await handleOgDocument(
    detailRequest("/predict/updown/b8e77db3-7a25-4a90-bf51-e3be7f42997b"),
    injectDeps,
  );
  const elapsed = Date.now() - started;
  assert.equal(isPass(response), true);
  assert.ok(elapsed < 400, `waited ${elapsed}ms`);
  assert.notEqual(response.status, 500);
});

test("shell HTTP errors, non-app HTML, and thrown fetches fall through", async () => {
  const cases: Array<{ name: string; shell: () => Promise<Response> | Response }> = [
    { name: "http", shell: () => new Response("down", { status: 503 }) },
    { name: "login", shell: () => new Response("<html><title>Login</title></html>", { status: 200 }) },
    {
      name: "throw",
      shell: () => {
        throw new Error("socket hang up");
      },
    },
  ];
  for (const item of cases) {
    const { deps: injectDeps } = deps(async (input) => {
      const url = String(input);
      if (url.includes("/api/og/document-meta")) return Response.json(META);
      return item.shell();
    });
    const response = await handleOgDocument(detailRequest("/polls/example-poll"), injectDeps);
    assert.equal(isPass(response), true, item.name);
  }
});

test("a zero budget does not fetch and falls through", async () => {
  let fetched = false;
  const { deps: injectDeps } = deps(async () => {
    fetched = true;
    return Response.json(META);
  }, { budgetMs: 0 });
  const response = await handleOgDocument(detailRequest("/markets/will-it-rain"), injectDeps);
  assert.equal(isPass(response), true);
  assert.equal(fetched, false);
});

test("successful injection caches shared HTML and ignores cookies and ref", async () => {
  const seen: string[] = [];
  const { deps: injectDeps, calls } = deps(async (input, init) => {
    const url = String(input);
    if (url.includes("/api/og/document-meta")) return Response.json(META);
    assert.equal(new Headers(init?.headers).get("x-og-shell"), "1");
    return new Response(SHELL, { status: 200, headers: { "content-type": "text/html" } });
  });
  injectDeps.writeCache = async (key) => {
    seen.push(key);
  };

  const first = await handleOgDocument(
    detailRequest("/vote/matchups/seal-team-6-vs-delta-force?ref=VXABCDEF", {
      cookie: "session=super-secret-session",
      "x-vercel-protection-bypass": "bypass-token",
      authorization: "Bearer user-token",
    }),
    injectDeps,
  );
  const html = await first.text();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-og-document"), "1");
  assert.equal(first.headers.get("cache-control"), INJECTED_HTML_CACHE_CONTROL);
  assert.equal(first.headers.get("cdn-cache-control"), INJECTED_HTML_CDN_CACHE_CONTROL);
  assert.equal(first.headers.get("vercel-cdn-cache-control"), INJECTED_HTML_CDN_CACHE_CONTROL);
  assert.equal(first.headers.get("cache-control")?.includes("no-store"), false);
  assert.match(html, /Seal Team 6 vs Delta Force \| VoxDex/);
  assert.match(html, /id="root"/);
  assert.equal(html.includes("super-secret-session"), false);
  assert.equal(html.includes("user-token"), false);
  assert.equal(html.includes("VXABCDEF"), false);
  assert.equal(html.includes("bypass-token"), false);
  assert.equal(seen[0], "/vote/matchups/seal-team-6-vs-delta-force");
  const shellCall = calls.find((call) => call.url.includes("/index.html"));
  assert.ok(shellCall);
  assert.equal(shellCall?.headers.get("cookie"), "session=super-secret-session");
  assert.equal(shellCall?.headers.get("x-vercel-protection-bypass"), "bypass-token");

  const { deps: secondDeps } = deps(async (input) => {
    const url = String(input);
    if (url.includes("/api/og/document-meta") || url.includes("og.test")) {
      throw new Error("railway should not be called on a meta cache hit");
    }
    return new Response(SHELL, { status: 200 });
  });
  secondDeps.readCache = async () => META;
  const second = await handleOgDocument(
    detailRequest("/vote/matchups/seal-team-6-vs-delta-force?ref=VXZZZZZZ", {
      cookie: "session=someone-else",
    }),
    secondDeps,
  );
  const secondHtml = await second.text();
  assert.equal(secondHtml, html);
});

test("HTML fallback still injects when JSON misses inside the budget", async () => {
  const htmlDoc = `<!DOCTYPE html><title>From HTML | VoxDex</title>
<meta name="description" content="html fallback" />
<link rel="canonical" href="https://voxdex.com/vote/matchups/from-html" />
<meta property="og:image" content="https://voxdex.com/card.png" />`;
  const { deps: injectDeps } = deps(async (input) => {
    const url = String(input);
    if (url.includes("/api/og/document-meta")) return new Response("missing", { status: 404 });
    if (url.includes("/api/og/matchups/")) return new Response(htmlDoc, { status: 200 });
    return new Response(SHELL, { status: 200 });
  }, { budgetMs: 1_000 });
  const response = await handleOgDocument(detailRequest("/vote/matchups/from-html"), injectDeps);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /From HTML \| VoxDex/);
  assert.match(html, /id="root"/);
});

test("link-preview bots and Google still receive first-response meta", async () => {
  const fetchImpl: OgFetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/og/document-meta")) return Response.json(META);
    return new Response(SHELL, { status: 200 });
  };
  for (const ua of ["Twitterbot/1.0", "Slackbot-LinkExpanding 1.0", GOOGLEBOT]) {
    const { deps: injectDeps } = deps(fetchImpl);
    const response = await handleOgDocument(
      detailRequest("/vote/matchups/seal-team-6-vs-delta-force", { "user-agent": ua }),
      injectDeps,
    );
    const html = await response.text();
    assert.equal(response.headers.get("x-og-document"), "1", ua);
    assert.match(html, /Seal Team 6 vs Delta Force \| VoxDex/);
  }
});

test("a link-preview bot that misses the budget falls through for the Railway rewrite", async () => {
  const { deps: injectDeps } = deps((_input, init) => hang(init?.signal), { budgetMs: 80 });
  const response = await handleOgDocument(
    detailRequest("/vote/matchups/seal-team-6-vs-delta-force", {
      "user-agent": "Twitterbot/1.0",
    }),
    injectDeps,
  );
  assert.equal(isPass(response), true);
  assert.equal(response.headers.get("content-type"), null);
});

test("non-document and non-detail requests skip injection", async () => {
  let fetched = false;
  const { deps: injectDeps } = deps(async () => {
    fetched = true;
    return Response.json(META);
  });
  const image = await handleOgDocument(
    detailRequest("/person/abc", { "sec-fetch-dest": "image" }),
    injectDeps,
  );
  const home = await handleOgDocument(detailRequest("/vote"), injectDeps);
  const loop = await handleOgDocument(
    detailRequest("/explore", { "x-og-shell": "1" }),
    injectDeps,
  );
  assert.equal(isPass(image), true);
  assert.equal(isPass(home), true);
  assert.equal(isPass(loop), true);
  assert.equal(fetched, false);
});
