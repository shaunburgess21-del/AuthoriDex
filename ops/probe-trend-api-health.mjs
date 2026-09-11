/**
 * Live credential + quota probe for every external API in the trend score path.
 *
 * Read-only: makes one cheap call per provider and writes nothing to the DB.
 * Never prints a key — only whether one is configured, and what the provider
 * says back. Where a provider exposes an account balance or remaining quota
 * (DataForSEO, SerpApi) it is reported, since that is the number that decides
 * whether an account needs topping up.
 *
 * Usage:
 *   node ops/probe-trend-api-health.mjs
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

/** Probe subject — a well-known name that should return data everywhere. */
const SUBJECT = "Taylor Swift";
const TIMEOUT_MS = 20_000;

const results = [];

function record(row) {
  results.push(row);
  const status = row.ok === true ? "OK  " : row.ok === false ? "FAIL" : "SKIP";
  console.log(
    `${status}  ${row.provider.padEnd(26)} ${String(row.http ?? "-").padEnd(5)} ${row.detail}`,
  );
}

async function withTimeout(fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a probe so one provider's failure never aborts the sweep. */
async function probe(provider, role, fn) {
  try {
    await withTimeout(async (signal) => {
      const out = await fn(signal);
      record({ provider, role, ...out });
    });
  } catch (err) {
    record({
      provider,
      role,
      ok: false,
      http: null,
      detail: `threw: ${err?.name === "AbortError" ? `timeout after ${TIMEOUT_MS / 1000}s` : err?.message ?? err}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Wikimedia — no key. Largest single input to the score.
// ---------------------------------------------------------------------------
await probe("Wikimedia Pageviews", "score: wiki mass + velocity", async (signal) => {
  const end = new Date(Date.now() - 24 * 3600 * 1000);
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/` +
    `all-access/all-agents/Taylor_Swift/daily/${fmt(start)}/${fmt(end)}`;
  const res = await fetch(url, {
    signal,
    headers: { "User-Agent": "VoxDex-HealthProbe/1.0 (ops)" },
  });
  const json = await res.json().catch(() => null);
  const days = json?.items?.length ?? 0;
  const total = json?.items?.reduce((a, i) => a + (i.views ?? 0), 0) ?? 0;
  return {
    ok: res.ok && days > 0,
    http: res.status,
    detail: res.ok
      ? `${days} days returned, ${total.toLocaleString()} views for ${SUBJECT}`
      : `${json?.title ?? "error"}`,
  };
});

// ---------------------------------------------------------------------------
// Serper — web search (persisted, zero score weight) and news (in score).
// ---------------------------------------------------------------------------
const serperKey = process.env.SERPER_API_KEY;
for (const [label, endpoint, role] of [
  ["Serper /search", "https://google.serper.dev/search", "persisted only (score weight 0)"],
  ["Serper /news", "https://google.serper.dev/news", "score: news count (union member)"],
]) {
  await probe(label, role, async (signal) => {
    if (!serperKey) return { ok: null, http: null, detail: "SERPER_API_KEY not set" };
    const res = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: SUBJECT, num: 10 }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    // NB: these are THROTTLE headers, not an account balance. Serper exposes
    // no remaining-credit endpoint or header — the plan balance is visible
    // only on the dashboard, so it cannot be alarmed on from here.
    const rlRemaining = res.headers.get("x-ratelimit-remaining");
    const rlLimit = res.headers.get("x-ratelimit-limit");
    const n = json?.news?.length ?? json?.organic?.length ?? 0;
    return {
      ok: res.ok && n > 0,
      http: res.status,
      detail: res.ok
        ? `${n} results` +
          (rlRemaining ? ` | rate limit ${rlRemaining}/${rlLimit} left (throttle, not balance)` : "")
        : `${text.slice(0, 160)}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Mediastack — union news member.
// ---------------------------------------------------------------------------
await probe("Mediastack", "score: news count (union member)", async (signal) => {
  const key = process.env.MEDIASTACK_API_KEY;
  if (!key) return { ok: null, http: null, detail: "MEDIASTACK_API_KEY not set" };
  const params = new URLSearchParams({
    access_key: key,
    keywords: SUBJECT,
    languages: "en",
    sort: "published_desc",
    limit: "1",
  });
  const res = await fetch(`https://api.mediastack.com/v1/news?${params}`, { signal });
  const json = await res.json().catch(() => null);
  if (json?.error) {
    return {
      ok: false,
      http: res.status,
      detail: `${json.error.code}: ${json.error.message ?? ""}`.slice(0, 160),
    };
  }
  const total = json?.pagination?.total ?? 0;
  return {
    ok: res.ok && json != null,
    http: res.status,
    detail: `pagination.total=${total} for ${SUBJECT}`,
  };
});

// ---------------------------------------------------------------------------
// Currents — union news member.
// ---------------------------------------------------------------------------
await probe("Currents", "score: news count (union member)", async (signal) => {
  const key = process.env.CURRENTS_API_KEY;
  if (!key) return { ok: null, http: null, detail: "CURRENTS_API_KEY not set" };
  const params = new URLSearchParams({
    keywords: SUBJECT,
    language: "en",
    apiKey: key,
  });
  const res = await fetch(`https://api.currentsapi.services/v1/search?${params}`, { signal });
  const json = await res.json().catch(() => null);
  const remaining =
    res.headers.get("x-api-limit-remaining") ??
    res.headers.get("ratelimit-remaining") ??
    null;
  if (!res.ok || json?.status === "error") {
    return {
      ok: false,
      http: res.status,
      detail: `${json?.message ?? json?.status ?? "error"}`.slice(0, 160),
    };
  }
  return {
    ok: true,
    http: res.status,
    credits: remaining,
    detail: `${json?.news?.length ?? 0} articles${remaining ? `, daily calls left: ${remaining}` : ""}`,
  };
});

// ---------------------------------------------------------------------------
// GDELT — no key. Only active in tiered/cascade, disabled inside union.
// ---------------------------------------------------------------------------
await probe("GDELT DOC", "news fallback (off in union mode)", async (signal) => {
  const params = new URLSearchParams({
    query: `"${SUBJECT}"`,
    mode: "artlist",
    maxrecords: "10",
    format: "json",
    timespan: "24h",
  });
  const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    signal,
    headers: { "User-Agent": "VoxDex-HealthProbe/1.0 (ops)" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* GDELT returns HTML/plaintext on error */
  }
  const n = json?.articles?.length ?? 0;
  return {
    ok: res.ok && json != null,
    http: res.status,
    detail: json ? `${n} articles` : `non-JSON body: ${text.slice(0, 100).replace(/\s+/g, " ")}`,
  };
});

// ---------------------------------------------------------------------------
// DataForSEO — the account most likely to need funding. Balance first, then
// one live call per endpoint the ingest actually uses.
// ---------------------------------------------------------------------------
const dfsLogin = process.env.DATAFORSEO_LOGIN;
const dfsPass = process.env.DATAFORSEO_PASSWORD;
const dfsAuth =
  dfsLogin && dfsPass
    ? "Basic " + Buffer.from(`${dfsLogin}:${dfsPass}`).toString("base64")
    : null;
const dfsLocation = Number(process.env.DATAFORSEO_LOCATION_CODE || 2840);

await probe("DataForSEO — account", "billing", async (signal) => {
  if (!dfsAuth) return { ok: null, http: null, detail: "DATAFORSEO_LOGIN/PASSWORD not set" };
  const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
    signal,
    headers: { Authorization: dfsAuth },
  });
  const json = await res.json().catch(() => null);
  const task = json?.tasks?.[0]?.result?.[0];
  if (!res.ok || !task) {
    return {
      ok: false,
      http: res.status,
      detail: `${json?.status_message ?? "no result"}`.slice(0, 160),
    };
  }
  const balance = Number(task?.money?.balance ?? 0);
  const spentToday = task?.money?.spent?.today ?? task?.money?.spent?.day;
  const spentMonth = task?.money?.spent?.month;
  // Rough runway: today's spend is the best available daily burn estimate.
  const burn = Number(spentToday ?? 0);
  const runway = burn > 0 ? `~${Math.floor(balance / burn)} days at today's burn` : "burn unknown";
  return {
    ok: true,
    http: res.status,
    balance,
    detail: `balance $${balance.toFixed(2)} | spent today $${spentToday ?? "?"} | this month $${spentMonth ?? "?"} | ${runway}`,
  };
});

for (const [label, endpoint, body, role, pick] of [
  [
    "DataForSEO — search volume",
    "https://api.dataforseo.com/v3/keywords_data/clickstream_data/bulk_search_volume/live",
    [{ keywords: [SUBJECT], location_code: dfsLocation, language_code: "en" }],
    "score: 30% of attention mass slot",
    (r) => `volume=${r?.items?.[0]?.search_volume ?? r?.[0]?.search_volume ?? "null"}`,
  ],
  [
    "DataForSEO — trends",
    "https://api.dataforseo.com/v3/keywords_data/dataforseo_trends/explore/live",
    // Must mirror buildTaskPayload() in server/providers/dataforseo-trends.ts —
    // the endpoint rejects a language field, and the window is past_30_days.
    [{ keywords: [SUBJECT], location_code: dfsLocation, type: "web", time_range: "past_30_days" }],
    "display only (momentum chip)",
    (r) => {
      const pts = r?.items?.[0]?.data?.length ?? 0;
      return `${pts} interest points`;
    },
  ],
  [
    "DataForSEO — sentiment",
    "https://api.dataforseo.com/v3/content_analysis/summary/live",
    [{ keyword: SUBJECT, page_type: ["news"], internal_list_limit: 1 }],
    "display only (sentiment card)",
    (r) => `${r?.total_count ?? 0} docs analysed`,
  ],
]) {
  await probe(label, role, async (signal) => {
    if (!dfsAuth) return { ok: null, http: null, detail: "DATAFORSEO creds not set" };
    const res = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: { Authorization: dfsAuth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    const task = json?.tasks?.[0];
    // DataForSEO returns HTTP 200 with a per-task status code on failure, so
    // the task code is the real signal — 20000 is success.
    const taskCode = task?.status_code;
    const cost = json?.cost;
    if (taskCode !== 20000) {
      return {
        ok: false,
        http: res.status,
        detail: `task ${taskCode}: ${task?.status_message ?? json?.status_message ?? "unknown"}`.slice(0, 160),
      };
    }
    return {
      ok: true,
      http: res.status,
      detail: `${pick(task?.result?.[0])} | cost $${cost ?? 0}`,
    };
  });
}

// ---------------------------------------------------------------------------
// SerpApi — admin topic-ID tooling only, NOT in the ingest path.
// ---------------------------------------------------------------------------
await probe("SerpApi", "admin tooling only (not ingest)", async (signal) => {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return { ok: null, http: null, detail: "SERPAPI_API_KEY not set" };
  const res = await fetch(`https://serpapi.com/account?api_key=${encodeURIComponent(key)}`, {
    signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, http: res.status, detail: `${json?.error ?? "error"}`.slice(0, 160) };
  }
  return {
    ok: true,
    http: res.status,
    credits: json?.total_searches_left,
    detail:
      `plan=${json?.plan_name ?? "?"} | searches left this month: ` +
      `${json?.total_searches_left ?? "?"} of ${json?.searches_per_month ?? "?"}`,
  };
});

// ---------------------------------------------------------------------------
console.log("\n--- summary ---");
const ok = results.filter((r) => r.ok === true);
const bad = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
console.log(`working: ${ok.length}   failing: ${bad.length}   not configured: ${skipped.length}`);
if (bad.length) {
  console.log("\nFAILING:");
  for (const r of bad) console.log(`  - ${r.provider} [${r.role}] → ${r.detail}`);
}
if (skipped.length) {
  console.log("\nNOT CONFIGURED:");
  for (const r of skipped) console.log(`  - ${r.provider} [${r.role}] → ${r.detail}`);
}
console.log(
  `\nNEWS_AGGREGATION_MODE (this shell): ${process.env.NEWS_AGGREGATION_MODE ?? "unset → 'tiered' default"}`,
);
