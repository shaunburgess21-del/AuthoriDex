import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  crowdSharesFromCounts,
  crowdSharesFromPercents,
  ratingBucketShare,
  type CrowdShare,
} from "../server/services/my-votes-crowd";

const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");

const CROWD_FIELDS = ["targetId", "slug", "crowdPercent", "choiceLabel", "optionPercents"] as const;

function handlerBetween(startMark: string, endMark: string): string {
  const start = routes.indexOf(startMark);
  const end = routes.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, `missing handler ${startMark}`);
  return routes.slice(start, end);
}

/** Each owner's vote list ends in `.limit(50)`. Aggregates do not. */
function limitQueries(handler: string): string[] {
  const queries: string[] = [];
  let from = 0;
  const token = ".limit(50)";
  while (from < handler.length) {
    const at = handler.indexOf(token, from);
    if (at < 0) break;
    const dbAt = handler.lastIndexOf("db", at);
    assert.ok(dbAt >= 0);
    queries.push(handler.slice(dbAt, at + token.length));
    from = at + token.length;
  }
  return queries;
}

function selectBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(".select({", from);
    if (start < 0) break;
    const end = source.indexOf("})", start);
    assert.ok(end > start);
    blocks.push(source.slice(start, end + 2));
    from = end + 2;
  }
  return blocks;
}

function pushBlocks(source: string): string[] {
  const blocks: string[] = [];
  const token = "results.push({";
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(token, from);
    if (start < 0) break;
    let depth = 0;
    let end = start + token.length - 1;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, end + 1));
    from = end + 1;
  }
  return blocks;
}

function responseHasCrowdField(block: string, field: string): boolean {
  return new RegExp(`(^|[\\n,{])\\s*${field}\\s*:`).test(block);
}

/** Walk a crowd payload. Voter ids must not appear as keys or values. */
function assertAggregateOnly(share: CrowdShare, voterIds: readonly string[]): void {
  const json = JSON.stringify(share);
  for (const voterId of voterIds) {
    assert.equal(json.includes(voterId), false, `crowd payload includes ${voterId}`);
  }
  if (share.optionPercents) {
    for (const option of share.optionPercents) {
      assert.deepEqual(Object.keys(option).sort(), ["key", "label", "percent"]);
      assert.equal(typeof option.percent, "number");
      assert.equal(Object.prototype.hasOwnProperty.call(option, "userId"), false);
    }
  }
  assert.equal(Object.prototype.hasOwnProperty.call(share, "userId"), false);
}

const OWN = "user-owner";
const OTHER = "user-other";

describe("GET /api/me/votes stays on the signed-in user", () => {
  const handler = handlerBetween('app.get("/api/me/votes"', 'app.get("/api/me/predictions"');

  it("reads req.userId and scopes every vote list to that id", () => {
    assert.match(handler, /const userId = req\.userId!/);
    assert.doesNotMatch(handler, /req\.(query|body|params)\.userId/);
    assert.doesNotMatch(handler, /userId\s*=\s*req\.(query|body|params)/);

    const lists = limitQueries(handler);
    assert.equal(lists.length, 8);
    for (const query of lists) {
      assert.match(query, /\.userId, userId\)/);
      assert.doesNotMatch(query, /req\.(query|body|params)/);
    }
  });

  it("does not put another user's id on the rows it returns", () => {
    const pushes = pushBlocks(handler);
    assert.ok(pushes.length >= 8);
    for (const block of pushes) {
      assert.equal(responseHasCrowdField(block, "userId"), false);
      assert.equal(block.includes(OTHER), false);
    }
  });
});

describe("GET /api/profile/u/:username/votes keeps private and hidden votes off the wire", () => {
  const handler = handlerBetween(
    'app.get("/api/profile/u/:username/votes"',
    'app.get("/api/profile/is-admin"',
  );

  it("returns 403 for a private profile before any vote list is read", () => {
    const denied = handler.indexOf('if (!user.isPublic) return res.status(403)');
    const firstList = handler.indexOf(".limit(50)");
    assert.ok(denied > 0);
    assert.ok(firstList > denied);
    assert.match(handler, /Profile is private/);
    assert.match(handler, /const userId = user\.id/);
  });

  it("drops profileItemPrivacy hides and does not attach the owner crowd fields", () => {
    assert.match(handler, /loadHiddenItemSet\(userId\)/);
    const hiddenLoaderStart = routes.indexOf("async function loadHiddenItemSet");
    const hiddenLoaderEnd = routes.indexOf('app.patch("/api/me/item-visibility"', hiddenLoaderStart);
    const hiddenLoader = routes.slice(hiddenLoaderStart, hiddenLoaderEnd);
    assert.match(hiddenLoader, /from\(profileItemPrivacy\)/);
    assert.match(hiddenLoader, /eq\(profileItemPrivacy\.userId, userId\)/);
    assert.match(handler, /!hiddenSet\.has\(`\$\{pType\}:\$\{r\.id\}`\)/);
    assert.match(handler, /res\.json\(visible\.slice\(0, 50\)\)/);
    assert.equal(handler.includes("res.json(results"), false);

    const lists = limitQueries(handler);
    assert.equal(lists.length, 8);
    for (const query of lists) {
      assert.match(query, /\.userId, userId\)/);
    }

    const pushes = pushBlocks(handler);
    assert.ok(pushes.length >= 8);
    for (const block of pushes) {
      for (const field of CROWD_FIELDS) {
        assert.equal(responseHasCrowdField(block, field), false, block.slice(0, 80));
      }
      assert.equal(responseHasCrowdField(block, "userId"), false);
    }
  });

  it("omits a hidden row even when that row was given the owner crowd fields", () => {
    const hidden = new Set(["matchup:vote-hidden", "trending_poll:vote-poll"]);
    const privacyType: Record<string, string> = {
      face_off: "matchup",
      trending_poll: "trending_poll",
    };
    const rows = [
      {
        id: "vote-hidden",
        voteType: "face_off",
        targetId: "matchup-1",
        slug: "secret-matchup",
        crowdPercent: 80,
        choiceLabel: "Secret",
        optionPercents: [{ key: "option_a", label: "A", percent: 80 }],
        ownerId: OWN,
      },
      {
        id: "vote-shown",
        voteType: "face_off",
        targetId: "matchup-2",
        slug: "public-matchup",
        crowdPercent: 55,
        choiceLabel: "Messi",
        optionPercents: [{ key: "option_b", label: "Messi", percent: 55 }],
        ownerId: OWN,
      },
      {
        id: "vote-poll",
        voteType: "trending_poll",
        targetId: "poll-1",
        slug: "hidden-poll",
        crowdPercent: 10,
        choiceLabel: "Agree",
        optionPercents: [{ key: "agree", label: "Agree", percent: 10 }],
        ownerId: OTHER,
      },
    ];
    const visible = rows.filter((row) => {
      const itemType = privacyType[row.voteType];
      return itemType ? !hidden.has(`${itemType}:${row.id}`) : true;
    });
    assert.deepEqual(visible.map((row) => row.id), ["vote-shown"]);
    const json = JSON.stringify(visible);
    assert.equal(json.includes("secret-matchup"), false);
    assert.equal(json.includes("hidden-poll"), false);
    assert.equal(json.includes(OTHER), false);
  });
});

describe("crowd percents are aggregates and do not name voters", () => {
  const voters = [OWN, OTHER, "user-third"];

  it("returns option shares only, with no voter id field", () => {
    const fromCounts = crowdSharesFromCounts(
      [
        { key: "option_a", label: "Ronaldo", count: 2 },
        { key: "option_b", label: "Messi", count: 1 },
        { key: "neutral", label: "Neutral", count: 0 },
      ],
      "option_b",
    );
    assert.equal(fromCounts.crowdPercent, 33);
    assertAggregateOnly(fromCounts, voters);

    const fromPercents = crowdSharesFromPercents(
      [
        { key: "underrated", label: "Underrated", percent: 40 },
        { key: "overrated", label: "Overrated", percent: 60 },
      ],
      "underrated",
    );
    assertAggregateOnly(fromPercents, voters);

    const buckets = ratingBucketShare([1, 1, 2, 4, 2], 4);
    assertAggregateOnly(buckets, voters);
    assert.deepEqual(
      buckets.optionPercents?.map((option) => option.key),
      ["1", "2", "3", "4", "5"],
    );
  });

  it("builds those shares from grouped counts, not from voter ids", () => {
    const handler = handlerBetween('app.get("/api/me/votes"', 'app.get("/api/me/predictions"');
    const tallyStart = handler.indexOf("Community signal");
    assert.ok(tallyStart > 0);
    const tallies = handler.slice(tallyStart, handler.indexOf("const results", tallyStart));
    const aggregates = selectBlocks(tallies).filter((block) => /count\(\*\)|votesUp|cnt:/.test(block));
    assert.ok(aggregates.length >= 4);
    for (const block of aggregates) {
      assert.equal(block.includes("userId"), false, block);
      assert.equal(block.includes("voterId"), false, block);
    }
    assert.doesNotMatch(tallies, /key:\s*[^,\n]*userId/);
    assert.match(tallies, /groupBy\(/);
  });
});
