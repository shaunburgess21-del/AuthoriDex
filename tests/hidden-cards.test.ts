import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CARD_REACTION_SURFACES, type CardReactionSurface } from "../shared/constants";
import { stripHiddenCardFromFeedCache } from "../client/src/lib/hiddenCardCache";
import {
  EMPTY_VIEWER_HIDDEN,
  MISSING_TABLE_RETRY_MS,
  executeHideCard,
  executeListHiddenCards,
  executeUnhideCard,
  filterFeedByHidden,
  filterNativeMarkets,
  filterWrappedFeed,
  hiddenCardHref,
  hiddenCardKey,
  isUndefinedTableError,
  nativeHideCardType,
  omitHiddenCards,
  presentHiddenCards,
  readViewerHiddenCards,
  type HiddenCardRecord,
  type HiddenCardSource,
  type HiddenCardStore,
} from "../server/services/hidden-cards";

class MemoryHiddenStore implements HiddenCardStore {
  readonly rows = new Map<string, HiddenCardRecord>();

  private key(userId: string, cardType: string, cardId: string): string {
    return `${userId}\0${cardType}\0${cardId}`;
  }

  async insert(record: HiddenCardRecord): Promise<"inserted" | "exists"> {
    const key = this.key(record.userId, record.cardType, record.cardId);
    if (this.rows.has(key)) return "exists";
    this.rows.set(key, { ...record });
    return "inserted";
  }

  async delete(userId: string, cardType: CardReactionSurface, cardId: string): Promise<boolean> {
    return this.rows.delete(this.key(userId, cardType, cardId));
  }

  async list(userId: string): Promise<HiddenCardRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

function missingTable(): Error {
  const error = new Error('relation "user_hidden_cards" does not exist');
  (error as Error & { code: string }).code = "42P01";
  return error;
}

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("hidden card filtering", () => {
  it("drops only the viewer's hidden cards and leaves an empty set unchanged", async () => {
    const hidden = await readViewerHiddenCards("user", {
      state: { missingUntil: 0 },
      load: async () => [
        { cardType: "sentiment_poll", cardId: "poll-1" },
        { cardType: "market_world", cardId: "world-1" },
      ],
    });

    const polls = [{ id: "poll-1", headline: "Hidden" }, { id: "poll-2", headline: "Shown" }];
    assert.deepEqual(
      filterFeedByHidden(polls, hidden, "sentiment_poll").map((poll) => poll.id),
      ["poll-2"],
    );
    assert.equal(filterFeedByHidden(polls, EMPTY_VIEWER_HIDDEN, "sentiment_poll"), polls);
    assert.deepEqual(omitHiddenCards(polls, new Set(), (poll) => hiddenCardKey("sentiment_poll", poll.id)), polls);

    const markets = [{ id: "world-1" }, { id: "world-2" }];
    assert.deepEqual(filterNativeMarkets("gainer", markets, hidden).map((market) => market.id), ["world-1", "world-2"]);
    assert.deepEqual(
      filterNativeMarkets("jackpot", [{ id: "world-1" }], hidden),
      [{ id: "world-1" }],
    );
    assert.equal(nativeHideCardType("jackpot"), null);
    assert.equal(nativeHideCardType("updown"), "market_updown");
    assert.deepEqual(hidden.idsFor("market_world"), ["world-1"]);

    const ratings = filterWrappedFeed(
      { data: [{ id: "person-1" }, { id: "person-2" }], totalCount: 2 },
      await readViewerHiddenCards("user", {
        state: { missingUntil: 0 },
        load: async () => [{ cardType: "value_person", cardId: "person-1" }],
      }),
      "value_person",
    );
    assert.deepEqual(ratings.data.map((person) => person.id), ["person-2"]);
    assert.equal(ratings.totalCount, 1);
  });

  it("fails open when the table is missing and does not throw on other lookup errors", async () => {
    const state = { missingUntil: 0 };
    let calls = 0;
    let now = 1_000;
    const missing = async () => {
      calls += 1;
      throw missingTable();
    };

    const first = await readViewerHiddenCards("user", { load: missing, state, now: () => now });
    assert.equal(first.keys.size, 0);
    assert.equal(calls, 1);
    assert.equal(isUndefinedTableError(missingTable()), true);
    assert.equal(isUndefinedTableError(new Error("connection reset")), false);

    const wrapped = new Error("drizzle wrap");
    (wrapped as Error & { cause: unknown }).cause = missingTable();
    assert.equal(isUndefinedTableError(wrapped), true);

    const second = await readViewerHiddenCards("user", { load: missing, state, now: () => now });
    assert.equal(second.keys.size, 0);
    assert.equal(calls, 1);

    now += MISSING_TABLE_RETRY_MS + 1;
    await readViewerHiddenCards("user", { load: missing, state, now: () => now });
    assert.equal(calls, 2);

    const other = await readViewerHiddenCards("user", {
      state: { missingUntil: 0 },
      load: async () => {
        throw new Error("connection reset");
      },
    });
    assert.equal(other.keys.size, 0);
    assert.equal((await readViewerHiddenCards(null, { load: missing, state: { missingUntil: 0 } })).keys.size, 0);
  });
});

describe("hidden card routes", () => {
  it("hides idempotently, unhides idempotently, and skips cards that no longer exist", async () => {
    const store = new MemoryHiddenStore();
    const created = await executeHideCard(store, "user", { cardType: "matchup", cardId: "m1" });
    assert.equal(created.status, 200);
    assert.deepEqual(created.body, {
      data: { cardType: "matchup", cardId: "m1", alreadyHidden: false },
    });

    const again = await executeHideCard(store, "user", { cardType: "matchup", cardId: "m1" });
    assert.equal((again.body.data as { alreadyHidden: boolean }).alreadyHidden, true);
    assert.equal(store.rows.size, 1);

    const invalid = await executeHideCard(store, "user", { cardType: "nope", cardId: "" });
    assert.equal(invalid.status, 400);

    const sources = new Map<string, HiddenCardSource>([
      [hiddenCardKey("matchup", "m1"), { title: "A vs B", category: "music", href: hiddenCardHref("matchup", "m1", { slug: "a-vs-b" }) }],
    ]);
    await executeHideCard(store, "user", { cardType: "opinion_poll", cardId: "gone" });
    const listed = await executeListHiddenCards(store, "user", async () => sources);
    assert.equal(listed.status, 200);
    const data = listed.body.data as Array<{ cardId: string; title: string; href: string; typeLabel: string }>;
    assert.deepEqual(data.map((row) => row.cardId), ["m1"]);
    assert.equal(data[0]?.title, "A vs B");
    assert.equal(data[0]?.href, "/vote/matchups/a-vs-b");
    assert.equal(data[0]?.typeLabel, "Matchup");

    const removed = await executeUnhideCard(store, "user", { cardType: "matchup", cardId: "m1" });
    assert.deepEqual(removed.body, { data: { cardType: "matchup", cardId: "m1", unhidden: true } });
    const againRemoved = await executeUnhideCard(store, "user", { cardType: "matchup", cardId: "m1" });
    assert.deepEqual((againRemoved.body.data as { unhidden: boolean }).unhidden, false);
  });

  it("returns 503 when the table is missing and 500 for other write failures", async () => {
    const missingStore: HiddenCardStore = {
      async insert() {
        throw missingTable();
      },
      async delete() {
        throw missingTable();
      },
      async list() {
        throw missingTable();
      },
    };
    const hide = await executeHideCard(missingStore, "user", { cardType: "sentiment_poll", cardId: "p1" });
    const unhide = await executeUnhideCard(missingStore, "user", { cardType: "sentiment_poll", cardId: "p1" });
    const list = await executeListHiddenCards(missingStore, "user", async () => new Map());
    assert.equal(hide.status, 503);
    assert.equal(unhide.status, 503);
    assert.equal(list.status, 503);
    assert.equal((hide.body as { code: string }).code, "hidden_cards_unavailable");

    const broken: HiddenCardStore = {
      async insert() {
        throw new Error("boom");
      },
      async delete() {
        throw new Error("boom");
      },
      async list() {
        throw new Error("boom");
      },
    };
    assert.equal((await executeHideCard(broken, "user", { cardType: "matchup", cardId: "m" })).status, 500);
  });

  it("builds detail links and skips a card the lookup cannot find", async () => {
    assert.equal(hiddenCardHref("sentiment_poll", "1", { slug: "hot take" }), "/polls/hot%20take");
    assert.equal(hiddenCardHref("opinion_poll", "1", { slug: "best" }), "/vote/opinion-polls/best");
    assert.equal(hiddenCardHref("value_person", "p1"), "/vote/all-ratings?focus=p1");
    assert.equal(hiddenCardHref("market_updown", "u1"), "/predict/updown/u1");
    assert.equal(hiddenCardHref("market_h2h", "h1"), "/predict/h2h/h1");
    assert.equal(hiddenCardHref("market_gainer", "g1"), "/predict/race/g1");
    assert.equal(hiddenCardHref("market_world", "w1", { slug: "finals" }), "/markets/finals");
    assert.equal(hiddenCardHref("curate_person", "c1"), "/person/c1");

    const row: HiddenCardRecord = {
      userId: "user",
      cardType: "matchup",
      cardId: "missing",
      createdAt: new Date("2026-11-21T00:00:00.000Z"),
    };
    const items = await presentHiddenCards([row], async () => new Map());
    assert.deepEqual(items, []);
  });
});

describe("hidden card migration and wiring", () => {
  it("adds an additive RLS table and journals it", () => {
    const sql = read("migrations/0105_user_hidden_cards.sql");
    const journal = read("migrations/meta/_journal.json");
    const schema = read("shared/schema.ts");

    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.user_hidden_cards/);
    assert.match(sql, /PRIMARY KEY \(user_id, card_type, card_id\)/);
    assert.match(sql, /REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
    assert.doesNotMatch(sql, /DROP TABLE/i);
    for (const surface of CARD_REACTION_SURFACES) {
      assert.ok(sql.includes(`'${surface}'`), `SQL check list is missing ${surface}`);
    }
    assert.match(journal, /"tag": "0105_user_hidden_cards"/);
    assert.match(schema, /pgTable\("user_hidden_cards"/);
    assert.match(schema, /CARD_REACTION_SURFACES\.map/);

    const statements = sql
      .split(/-->\s*statement-breakpoint/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    assert.equal(statements.length, 2);
    for (const chunk of statements) {
      const commands = chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      assert.equal(commands.length, 1);
    }
  });

  it("requires auth and filters feeds after shared memos, not inside them", () => {
    const routes = read("server/route-modules/hidden-cards-routes.ts");
    assert.match(routes, /requireAuth/);
    assert.match(routes, /app\.get\("\/api\/me\/hidden-cards"/);
    assert.match(routes, /app\.post\("\/api\/me\/hidden-cards"/);
    assert.match(routes, /app\.delete\("\/api\/me\/hidden-cards"/);

    const serverRoutes = read("server/routes.ts");
    const nativeMarkets = read("server/services/predict/native-markets.ts");
    assert.equal(nativeMarkets.includes("hidden-cards"), false);
    assert.equal(nativeMarkets.includes("userHiddenCards"), false);

    const leaderboard = serverRoutes.slice(
      serverRoutes.indexOf('app.get("/api/leaderboard"'),
      serverRoutes.indexOf('app.get("/api/leaderboard/users"'),
    );
    assert.equal(leaderboard.includes("loadViewerHiddenCards"), false);

    const matchupDetail = serverRoutes.slice(
      serverRoutes.indexOf('app.get("/api/matchups/by-slug/:slug"'),
      serverRoutes.indexOf('app.get("/api/matchups/user-votes"'),
    );
    assert.equal(matchupDetail.includes("loadViewerHiddenCards"), false);

    const pollDetail = serverRoutes.slice(
      serverRoutes.indexOf('app.get("/api/polls/:slug"'),
      serverRoutes.indexOf('app.post("/api/polls/:slug/vote"'),
    );
    assert.equal(pollDetail.includes("loadViewerHiddenCards"), false);

    const openList = serverRoutes.slice(
      serverRoutes.indexOf('app.get("/api/open-markets"'),
      serverRoutes.indexOf('app.get("/api/open-markets/:slug"'),
    );
    const hideAt = openList.indexOf("notInArray(predictionMarkets.id");
    const limitAt = openList.indexOf(".limit(");
    assert.ok(hideAt > 0 && limitAt > hideAt);

    const native = serverRoutes.slice(
      serverRoutes.indexOf('app.get("/api/native-markets/:type"'),
      serverRoutes.indexOf('app.get("/api/predict/recent-activity"'),
    );
    const memoAt = native.indexOf("loadNativeMarkets");
    const filterAt = native.indexOf("loadViewerHiddenCards");
    assert.ok(memoAt > 0 && filterAt > memoAt);
    assert.match(native, /if \(!nativeHideCardType\(type\)\)/);
  });
});

describe("hide card menu", () => {
  it("adds Hide card at the bottom of the category menu without browse handlers", () => {
    const pill = read("client/src/components/InteractiveCategoryPill.tsx");
    const lessAt = pill.lastIndexOf("Less like this");
    const hideAt = pill.lastIndexOf("Hide card");
    assert.ok(lessAt > 0 && hideAt > lessAt);

    const hideButton = pill.slice(Math.max(0, hideAt - 700), hideAt);
    assert.match(hideButton, /data-testid="menu-hide-card"/);
    assert.equal(hideButton.includes("onTouchStart"), false);
    assert.equal(hideButton.includes("onPointerDown"), false);
    assert.equal(hideButton.includes("onBrowse"), false);
    assert.match(pill, /Sign in to hide cards/);
    assert.match(pill, /reactionTarget[\s\S]{0,80}\?/);
  });

  it("strips a card from list caches and leaves a detail object in place", () => {
    assert.deepEqual(
      stripHiddenCardFromFeedCache([{ id: "a" }, { id: "b" }], "a"),
      [{ id: "b" }],
    );
    assert.deepEqual(
      stripHiddenCardFromFeedCache({ data: [{ id: "a" }, { id: "b" }], totalCount: 2 }, "a"),
      { data: [{ id: "b" }], totalCount: 1 },
    );
    const detail = { id: "a", title: "Still here", slug: "still-here" };
    assert.equal(stripHiddenCardFromFeedCache(detail, "a"), detail);
  });
});
