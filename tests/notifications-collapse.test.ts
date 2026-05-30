import test from "node:test";
import assert from "node:assert/strict";

import { countCollapsedNotifications } from "../shared/notifications-collapse";

test("ungrouped rows each count once", () => {
  assert.equal(
    countCollapsedNotifications([
      { id: "a", groupKey: null },
      { id: "b", groupKey: null },
    ]),
    2,
  );
});

test("same groupKey collapses to one", () => {
  assert.equal(
    countCollapsedNotifications([
      { id: "a", groupKey: "badge_awarded:user1:2026-05-30" },
      { id: "b", groupKey: "badge_awarded:user1:2026-05-30" },
      { id: "c", groupKey: null },
    ]),
    2,
  );
});

test("distinct group keys count separately", () => {
  assert.equal(
    countCollapsedNotifications([
      { id: "a", groupKey: "g1" },
      { id: "b", groupKey: "g2" },
    ]),
    2,
  );
});
