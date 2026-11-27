import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detailSkeletonKind } from "../client/src/lib/detailRouteSkeleton";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("detail routes pick a layout-matched skeleton, hubs do not", () => {
  assert.equal(detailSkeletonKind("/vote/matchups/cats-vs-dogs"), "matchup");
  assert.equal(detailSkeletonKind("/vote/matchups/rainy-days-vs-sunny-days?ref=abc"), "matchup");
  assert.equal(detailSkeletonKind("/vote/opinion-polls/best-pizza"), "opinion");
  assert.equal(detailSkeletonKind("/polls/4-day-work-week"), "sentiment");
  assert.equal(detailSkeletonKind("/markets/when-will-a-tesla-spacex-merger-be-officially-announced"), "market");
  assert.equal(detailSkeletonKind("/predict/updown/abc"), "native-market");
  assert.equal(detailSkeletonKind("/predict/h2h/abc"), "native-market");
  assert.equal(detailSkeletonKind("/predict/race/abc"), "native-market");
  assert.equal(detailSkeletonKind("/person/0e413872-6375-4370-8330-f381636d1421"), "person");
  assert.equal(detailSkeletonKind("/celebrity/someone"), "person");
  assert.equal(detailSkeletonKind("/u/ada"), "public-profile");
  assert.equal(detailSkeletonKind("/profile"), "account-profile");

  assert.equal(detailSkeletonKind("/"), null);
  assert.equal(detailSkeletonKind("/vote"), null);
  assert.equal(detailSkeletonKind("/vote/matchups"), null);
  assert.equal(detailSkeletonKind("/polls"), null);
  assert.equal(detailSkeletonKind("/markets"), null);
  assert.equal(detailSkeletonKind("/predict"), null);
  assert.equal(detailSkeletonKind("/rankings"), null);
});

test("detail pages render a skeleton with nav instead of a bare full-screen spinner", () => {
  const pages: Array<[string, string]> = [
    ["../client/src/pages/MatchupDetailPage.tsx", "VoteDetailSkeleton"],
    ["../client/src/pages/OpinionPollDetailPage.tsx", "VoteDetailSkeleton"],
    ["../client/src/pages/PollDetailPage.tsx", "VoteDetailSkeleton"],
    ["../client/src/pages/MarketDetailPage.tsx", "CommunityMarketDetailSkeleton"],
    ["../client/src/pages/UpDownDetailPage.tsx", "NativeMarketDetailSkeleton"],
    ["../client/src/pages/H2HDetailPage.tsx", "NativeMarketDetailSkeleton"],
    ["../client/src/pages/CategoryRaceDetailPage.tsx", "NativeMarketDetailSkeleton"],
    ["../client/src/pages/PersonDetailPage.tsx", "PersonDetailSkeleton"],
    ["../client/src/pages/PublicProfilePage.tsx", "PublicProfileSkeleton"],
    ["../client/src/pages/UserProfilePage.tsx", "AccountProfileSkeleton"],
  ];
  for (const [file, skeleton] of pages) {
    const src = read(file);
    assert.match(src, new RegExp(skeleton), `${file} should render ${skeleton}`);
    assert.doesNotMatch(
      src,
      /min-h-screen bg-background flex items-center justify-center/,
      `${file} still has a bare full-screen spinner`,
    );
    assert.doesNotMatch(src, /Loading person data/, `${file} still has the person spinner copy`);
  }

  const fallback = read("../client/src/App.tsx");
  assert.match(fallback, /detailSkeletonKind/);
  assert.match(fallback, /DetailPageFallback/);
});
