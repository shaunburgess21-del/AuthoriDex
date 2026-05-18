import test from "node:test";
import assert from "node:assert/strict";
import { dateToLocal, localDatetimeToIso } from "../client/src/lib/datetime-local";

test("dateToLocal formats using local wall-clock components", () => {
  const d = new Date(2026, 11, 30, 22, 0, 0, 0);
  assert.equal(dateToLocal(d), "2026-12-30T22:00");
});

test("dateToLocal returns empty for invalid input", () => {
  assert.equal(dateToLocal(null), "");
  assert.equal(dateToLocal("not-a-date"), "");
});

test("localDatetimeToIso round-trips with dateToLocal for same instant", () => {
  const local = "2026-12-30T22:00";
  const iso = localDatetimeToIso(local);
  const back = dateToLocal(iso);
  assert.equal(back, local);
});
