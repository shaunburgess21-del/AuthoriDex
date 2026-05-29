import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSentimentHighlight,
  classifyPressVsCrowd,
  CROWD_LOVED_APPROVAL_MIN,
  CROWD_LOVED_WEB_MAX,
  PRESS_LOVED_APPROVAL_MAX,
  PRESS_LOVED_WEB_MIN,
  sentimentApprovalGap,
  SENTIMENT_DIVERGENCE_MIN_GAP,
} from "../server/services/insights/sentiment-divergence";

test("sentimentApprovalGap: signed web minus crowd", () => {
  assert.equal(sentimentApprovalGap(78, 41), 37);
  assert.equal(sentimentApprovalGap(30, 70), -40);
  assert.equal(sentimentApprovalGap(null, 50), null);
});

test("classifyPressVsCrowd: press loved crowd cool", () => {
  const web = PRESS_LOVED_WEB_MIN + 10;
  const crowd = PRESS_LOVED_APPROVAL_MAX - 10;
  assert.ok(web - crowd >= SENTIMENT_DIVERGENCE_MIN_GAP);
  assert.equal(classifyPressVsCrowd(web, crowd), "press_loved_crowd_cool");
});

test("classifyPressVsCrowd: crowd loved press critical", () => {
  const web = CROWD_LOVED_WEB_MAX - 10;
  const crowd = CROWD_LOVED_APPROVAL_MIN + 20;
  assert.ok(crowd - web >= SENTIMENT_DIVERGENCE_MIN_GAP);
  assert.equal(classifyPressVsCrowd(web, crowd), "crowd_loved_press_critical");
});

test("classifyPressVsCrowd: captures strong-gap near-miss at the web ceiling", () => {
  // Rory-style case: web just under the (relaxed) ceiling, large negative gap.
  assert.equal(CROWD_LOVED_WEB_MAX, 50);
  assert.equal(classifyPressVsCrowd(48, 93), "crowd_loved_press_critical");
  // Just above the ceiling should NOT classify even with a big gap.
  assert.equal(classifyPressVsCrowd(CROWD_LOVED_WEB_MAX + 1, 93), null);
});

test("classifyPressVsCrowd: null when gap below minimum", () => {
  const web = 60;
  const crowd = 60 - SENTIMENT_DIVERGENCE_MIN_GAP + 1;
  assert.equal(classifyPressVsCrowd(web, crowd), null);
});

test("classifyPressVsCrowd: null when aligned high on both", () => {
  assert.equal(classifyPressVsCrowd(80, 85), null);
});

test("buildSentimentHighlight: includes both percentages", () => {
  const h = buildSentimentHighlight("press_loved_crowd_cool", 78, 41);
  assert.match(h, /Web 78%/);
  assert.match(h, /crowd 41%/);
  assert.match(h, /37 pt gap/);
});
