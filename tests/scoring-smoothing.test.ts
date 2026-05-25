import test from "node:test";
import assert from "node:assert/strict";
import {
  smoothLastNTicks,
  NEWS_SMOOTHING_WINDOW,
} from "../server/scoring/smoothing";

test("smoothLastNTicks: cold start returns latest when fewer than window", () => {
  assert.equal(smoothLastNTicks([28, 30], NEWS_SMOOTHING_WINDOW), 30);
});

test("smoothLastNTicks: 3-tick window dampens sawtooth on [28,30,29,30,28,29]", () => {
  const series = [28, 30, 29, 30, 28, 29];
  const smoothed = series.map((_, i) =>
    smoothLastNTicks(series.slice(0, i + 1), NEWS_SMOOTHING_WINDOW)!,
  );
  // Cold-start ticks (fewer than 3 points) pass through raw extrema; measure after warmup.
  const warmed = smoothed.slice(NEWS_SMOOTHING_WINDOW - 1);
  const rawRange = Math.max(...series) - Math.min(...series);
  const smoothRange = Math.max(...warmed) - Math.min(...warmed);
  assert.ok(smoothRange < rawRange, `smoothed range ${smoothRange} should be < raw ${rawRange}`);
  assert.ok(smoothRange < 1.5, `smoothed range ${smoothRange} should be < 1.5`);
});

test("smoothLastNTicks: empty series returns null", () => {
  assert.equal(smoothLastNTicks([]), null);
});
