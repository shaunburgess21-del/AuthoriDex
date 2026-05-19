/**
 * One-off verification for matchup OG (run: node scripts/verify-matchup-og.mjs)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLUG = "football-goat";
const BASES = [
  { label: "local", base: process.env.VERIFY_BASE ?? "http://127.0.0.1:5000" },
  { label: "production-voxdex", base: "https://voxdex.com" },
  { label: "production-railway", base: "https://authoridex-production.up.railway.app" },
];

const CRAWLER_UAS = [
  "facebookexternalhit/1.1",
  "Twitterbot/1.0",
  "WhatsApp/2.23.20.0",
  "LinkedInBot/1.0",
];

function extractMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)="${prop.replace(/:/g, "\\:")}"[^>]+content="([^"]*)"`,
    "i",
  );
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(
    `content="([^"]*)"[^>]+(?:property|name)="${prop.replace(/:/g, "\\:")}"`,
    "i",
  );
  return html.match(re2)?.[1] ?? null;
}

async function fetchInfo(label, url, opts = {}) {
  try {
    const res = await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(30_000),
    });
    const ct = res.headers.get("content-type") ?? "";
    const cc = res.headers.get("cache-control") ?? "";
    const buf =
      ct.includes("image") || url.endsWith(".png")
        ? Buffer.from(await res.arrayBuffer())
        : null;
    const text = buf ? null : await res.text();
    return { label, url, status: res.status, ct, cc, buf, text, ok: res.ok };
  } catch (err) {
    return { label, url, error: String(err?.message ?? err) };
  }
}

async function main() {
  const sharp = (await import("sharp")).default;
  const outDir = path.join(__dirname, "..", "tmp", "og-verify");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("=== Matchup OG verification ===\n");

  for (const { label, base } of BASES) {
    console.log(`--- ${label} (${base}) ---`);
    const pngUrl = `${base}/api/og/vote/matchups/${SLUG}.png`;
    const htmlUrl = `${base}/api/og/matchups/${SLUG}`;
    const pageUrl = `${base}/vote/matchups/${SLUG}`;

    const png = await fetchInfo(label, pngUrl);
    if (png.error) {
      console.log(`  PNG: ERROR ${png.error}`);
    } else {
      console.log(`  PNG: ${png.status} ${png.ct} cache=${png.cc} bytes=${png.buf?.length ?? 0}`);
      if (png.buf?.length > 1000 && png.ct.includes("png")) {
        const meta = await sharp(png.buf).metadata();
        console.log(`       dimensions: ${meta.width}x${meta.height}`);
        if (label === "local" || label === "production-railway") {
          const out = path.join(outDir, `matchup-${label}.png`);
          fs.writeFileSync(out, png.buf);
          console.log(`       saved: ${out}`);
        }
      }
    }

    const html = await fetchInfo(label, htmlUrl);
    if (html.error) {
      console.log(`  HTML: ERROR ${html.error}`);
    } else {
      console.log(`  HTML: ${html.status} ${html.ct}`);
      if (html.text) {
        const fields = [
          "og:title",
          "og:description",
          "og:image",
          "og:url",
          "twitter:card",
          "twitter:image",
        ];
        for (const f of fields) {
          console.log(`       ${f}: ${extractMeta(html.text, f)}`);
        }
      }
    }

    for (const ua of CRAWLER_UAS.slice(0, 1)) {
      const crawl = await fetchInfo(
        `${label}-crawler`,
        pageUrl,
        { headers: { "User-Agent": ua } },
      );
      if (crawl.error) {
        console.log(`  Crawler (${ua.split("/")[0]}): ERROR ${crawl.error}`);
      } else {
        const isOgHtml =
          crawl.text?.includes('property="og:image"') &&
          crawl.text?.includes("/api/og/vote/matchups/");
        const isSpa =
          crawl.text?.includes('id="root"') ||
          crawl.text?.includes("/assets/index");
        console.log(
          `  Crawler page: ${crawl.status} og-html=${!!isOgHtml} spa=${!!isSpa}`,
        );
      }
    }
    console.log("");
  }

  // Timeout/fallback unit check (no network to bad host needed for crash test)
  const { renderMatchupOgImage } = await import(
    "../server/services/matchup-og-image.ts"
  );
  const badUrlPng = await renderMatchupOgImage({
    slug: "test-timeout",
    title: "Test",
    promptText: "Who wins?",
    optionAText: "Player A",
    optionBText: "Player B",
    category: "Sports",
    optionAImageUrl: "http://127.0.0.1:9/invalid.png",
    optionBImageUrl: "http://127.0.0.1:9/invalid.png",
  });
  const badMeta = await sharp(badUrlPng).metadata();
  assert.equal(badMeta.width, 1200);
  assert.equal(badMeta.height, 630);
  console.log("--- timeout/fallback render ---");
  console.log(`  invalid URLs -> ${badMeta.width}x${badMeta.height} PNG OK`);

  // Regression: default OG PNG
  for (const url of [
    "http://127.0.0.1:5000/api/og/image/default.png",
    "http://127.0.0.1:5000/api/og/site",
  ]) {
    const r = await fetchInfo("regression", url);
    console.log(`  ${url}: ${r.status ?? "ERR"} ${r.ct ?? r.error}`);
  }

  console.log("\nDone. Check tmp/og-verify/*.png visually.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
