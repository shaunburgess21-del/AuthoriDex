import test from "node:test";
import assert from "node:assert/strict";
import {
  getTopOpinionOptionThumbs,
  hasMultipleOptionImages,
} from "../client/src/lib/opinionPollThumbs";

test("getTopOpinionOptionThumbs sorts by votes descending", () => {
  const options = [
    { name: "Low", imageUrl: "https://a.test/low.jpg", votes: 10 },
    { name: "High", imageUrl: "https://a.test/high.jpg", displayVotes: 500 },
    { name: "Mid", imageUrl: "https://a.test/mid.jpg", votes: 100 },
  ];

  const top = getTopOpinionOptionThumbs(options, 4);
  assert.equal(top.length, 3);
  assert.equal(top[0].name, "High");
  assert.equal(top[1].name, "Mid");
  assert.equal(top[2].name, "Low");
});

test("hasMultipleOptionImages requires two http URLs", () => {
  assert.equal(
    hasMultipleOptionImages([
      { name: "A", avatar: "https://a.test/a.jpg" },
      { name: "B", avatar: null },
    ]),
    false,
  );
  assert.equal(
    hasMultipleOptionImages([
      { name: "A", avatar: "https://a.test/a.jpg" },
      { name: "B", avatar: "https://a.test/b.jpg" },
    ]),
    true,
  );
});
