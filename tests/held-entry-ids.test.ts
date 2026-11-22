import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { selectHeldEntryIds } from "../client/src/lib/heldEntryIds";

describe("held entry ids for a signed-out visitor", () => {
  it("returns an empty set when there is no position payload", () => {
    const ids = selectHeldEntryIds({
      open: true,
      positions: undefined,
      activeStakes: undefined,
      bets: undefined,
    });
    assert.equal(ids.size, 0);
  });

  it("returns an empty set when the position lists are null or empty", () => {
    const ids = selectHeldEntryIds({
      open: false,
      positions: null,
      activeStakes: new Map(),
      bets: null,
    });
    assert.equal(ids.size, 0);
  });

  it("marks an open share and ignores a sold bet", () => {
    const open = selectHeldEntryIds({
      open: true,
      positions: [{ entryId: "yes", netShares: 2 }],
      activeStakes: new Map(),
      bets: [],
    });
    assert.deepEqual([...open], ["yes"]);

    const closed = selectHeldEntryIds({
      open: false,
      positions: [],
      activeStakes: new Map(),
      bets: [
        { entryId: "yes", status: "won", actionType: "buy" },
        { entryId: "no", status: "refunded", actionType: "sell" },
      ],
    });
    assert.deepEqual([...closed], ["yes"]);
  });
});

describe("market page hook order", () => {
  const source = readFileSync(
    new URL("../client/src/pages/MarketDetailPage.tsx", import.meta.url),
    "utf8",
  );

  it("computes held entries before the skeleton return", () => {
    const hookAt = source.indexOf("const heldEntryIds = useMemo");
    const skeletonAt = source.indexOf("if ((authLoading || isLoading) && !market)");
    assert.ok(hookAt > 0, "heldEntryIds hook is present");
    assert.ok(skeletonAt > hookAt, "hook runs on the loading render too");
  });
});
