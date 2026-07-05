/**
 * Throwaway E2E harness for the Market Scout job (Phase 1 verification).
 *
 * Spins up a local mock of the OpenAI Responses API, points the SDK at it
 * via OPENAI_BASE_URL, then runs the real `runMarketScout()` end to end:
 * live Polymarket fetch -> dedupe -> (mocked) curation -> draft insert.
 * Verifies the created draft row + entries + metadata, then deletes it.
 *
 * Run: npx tsx --env-file=.env server/scripts/test-market-scout-e2e.ts
 */

import http from "node:http";

process.env.MARKET_SCOUT_ENABLED = "true";
process.env.MARKET_SCOUT_MAX_DRAFTS_PER_RUN = "1";
process.env.OPENAI_API_KEY = "sk-mock-market-scout-test";

async function main() {
  // ── Mock OpenAI Responses API ──────────────────────────────────────────
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // Pull the first candidate eventId out of the user prompt so the
      // selection maps back to a real fetched candidate.
      const match = body.match(/\\"eventId\\": \\"(\d+)\\"/) || body.match(/"eventId": "(\d+)"/);
      const eventId = match?.[1];
      if (!eventId) {
        console.error("MOCK: could not find an eventId in the request body");
        res.writeHead(500).end();
        return;
      }
      const selections = {
        selections: [
          {
            eventId,
            title: "Mock scout market: will the test pass?",
            slug: "mock-scout-market-e2e-test",
            teaser: "A throwaway draft created by the scout E2E test.",
            summary: "This draft verifies the Market Scout insert path. It should be deleted automatically.",
            category: "politics",
            secondaryCategories: ["misc"],
            resolutionCriteria: ["Resolves per the official announcement."],
            scoutWatch: "Watch for the official announcement.",
            linkedPerson: null,
            fitScore: 77,
            // Wrong count on purpose -> job must fall back to source labels.
            entryLabels: [],
          },
        ],
      };
      const payload = {
        id: "resp_mock",
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        model: "gpt-mock",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_mock",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(selections), annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  console.log(`MOCK: OpenAI mock listening on ${process.env.OPENAI_BASE_URL}`);

  // Import AFTER env is set (lazy OpenAI client picks up base URL).
  const { runMarketScout, SCOUT_PROFILE_ID } = await import("../jobs/market-scout");
  const { db } = await import("../db");
  const { predictionMarkets, marketEntries, profiles } = await import("@shared/schema");
  const { eq, asc } = await import("drizzle-orm");

  // ── Preflight: scout profile exists ────────────────────────────────────
  const [scout] = await db
    .select({ id: profiles.id, username: profiles.username, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, SCOUT_PROFILE_ID));
  console.log("CHECK scout profile:", scout ? `${scout.username} (${scout.role})` : "MISSING");
  if (!scout) throw new Error("Scout profile missing — run db-deploy-migrate first");

  // ── Run the job ────────────────────────────────────────────────────────
  const result = await runMarketScout();
  console.log("RESULT:", JSON.stringify(result, null, 2));

  if (result.created !== 1 || result.drafts.length !== 1) {
    throw new Error("Expected exactly 1 created draft");
  }

  // ── Verify the inserted draft ──────────────────────────────────────────
  const draftId = result.drafts[0].marketId;
  const [market] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, draftId));
  const entries = await db
    .select()
    .from(marketEntries)
    .where(eq(marketEntries.marketId, draftId))
    .orderBy(asc(marketEntries.displayOrder));

  console.log("DRAFT:", {
    title: market.title,
    slug: market.slug,
    marketType: market.marketType,
    engine: market.engine,
    openMarketType: market.openMarketType,
    status: market.status,
    visibility: market.visibility,
    isLive: market.isLive,
    category: market.category,
    secondaryCategories: market.secondaryCategories,
    endAt: market.endAt,
    closeAt: market.closeAt,
    createdBy: market.createdBy,
    coverImageUrl: market.coverImageUrl ? "(set)" : null,
    sourceUrl: market.sourceUrl,
    resolutionCriteria: market.resolutionCriteria,
    cmsDisplayOrder: market.cmsDisplayOrder,
  });
  console.log("METADATA:", JSON.stringify(market.metadata, null, 2));
  console.log("ENTRIES:", entries.map((e) => `${e.displayOrder}: ${e.label} (${e.entryType})`));

  const meta = market.metadata as any;
  const assertions: Array<[string, boolean]> = [
    ["visibility=draft", market.visibility === "draft"],
    ["isLive=false", market.isLive === false],
    ["engine=amm", market.engine === "amm"],
    ["marketType=community", market.marketType === "community"],
    ["createdBy=scout", market.createdBy === SCOUT_PROFILE_ID],
    ["metadata.source.provider=polymarket", meta?.source?.provider === "polymarket"],
    ["metadata.source.externalId set", typeof meta?.source?.externalId === "string"],
    ["outcomeMapping aligned", Array.isArray(meta?.source?.outcomeMapping) && meta.source.outcomeMapping.length === entries.length],
    ["pricesAtImport aligned", Array.isArray(meta?.source?.pricesAtImport) && meta.source.pricesAtImport.length === entries.length],
    ["fitScore=77", meta?.fitScore === 77],
    ["scoutWatch set", typeof meta?.scoutWatch === "string"],
    ["entries >= 2", entries.length >= 2],
    // gameStartTime is always recorded now (value may be null when the source
    // has no kickoff), proving the provider -> scout plumbing is wired.
    ["metadata.source.gameStartTime key present", meta?.source != null && "gameStartTime" in meta.source],
  ];

  // closeAt must sit before endAt and match EITHER the default AMM cutoff
  // (endAt - cooldown, <=1h) OR a recorded kickoff time. A live candidate
  // with a real gameStartTime legitimately closes hours before endAt.
  {
    const closeMs = market.closeAt?.getTime() ?? NaN;
    const endMs = market.endAt?.getTime() ?? NaN;
    const kickoffIso = typeof meta?.source?.gameStartTime === "string" ? meta.source.gameStartTime : null;
    const kickoffMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
    const matchesDefault = Number.isFinite(endMs) && Number.isFinite(closeMs) && endMs - closeMs <= 60 * 60 * 1000;
    const matchesKickoff = Number.isFinite(kickoffMs) && Number.isFinite(closeMs) && Math.abs(closeMs - kickoffMs) < 1000;
    assertions.push([
      "closeAt is a valid cutoff (default cooldown or kickoff, before endAt)",
      Number.isFinite(closeMs) && Number.isFinite(endMs) && closeMs < endMs && (matchesDefault || matchesKickoff),
    ]);
  }
  let failed = 0;
  for (const [name, ok] of assertions) {
    console.log(ok ? `  PASS ${name}` : `  FAIL ${name}`);
    if (!ok) failed += 1;
  }

  // ── Dedupe check: rerun must skip the just-imported event ──────────────
  const rerun = await runMarketScout();
  console.log("RERUN dedupe check: created=", rerun.created, "deduped=", rerun.deduped);
  const rerunCreatedDupe = rerun.drafts.some(
    (d) => (d as any).sourceUrl === result.drafts[0].sourceUrl,
  );
  console.log(rerunCreatedDupe ? "  FAIL rerun re-imported the same event" : "  PASS rerun did not re-import the same event");
  if (rerunCreatedDupe) failed += 1;

  // ── Cleanup: delete all test drafts we created ─────────────────────────
  const toDelete = [draftId, ...rerun.drafts.map((d) => d.marketId)];
  for (const id of toDelete) {
    await db.delete(marketEntries).where(eq(marketEntries.marketId, id));
    await db.delete(predictionMarkets).where(eq(predictionMarkets.id, id));
  }
  console.log(`CLEANUP: deleted ${toDelete.length} test draft(s)`);

  server.close();
  if (failed > 0) {
    console.error(`E2E FAILED — ${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("E2E PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E ERROR:", err);
  process.exit(1);
});
