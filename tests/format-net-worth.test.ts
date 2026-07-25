import test from "node:test";
import assert from "node:assert/strict";
import { formatNetWorth } from "../client/src/lib/formatNumber";

test("formatNetWorth maps unavailable sentinels to No reliable estimate found", () => {
  assert.equal(formatNetWorth("Not available"), "No reliable estimate found");
  assert.equal(formatNetWorth("unavailable"), "No reliable estimate found");
  assert.equal(formatNetWorth("unknown"), "No reliable estimate found");
  assert.equal(formatNetWorth("N/A"), "No reliable estimate found");
  assert.equal(formatNetWorth("No reliable estimate found"), "No reliable estimate found");
});

test("formatNetWorth compact-formats million/billion/thousand estimates", () => {
  assert.equal(formatNetWorth("$5 million"), "$5M");
  assert.equal(formatNetWorth("$2.6 billion"), "$2.6B");
  assert.equal(formatNetWorth("$250 thousand"), "$250K");
});

test("formatNetWorth compact-formats approximate ranges", () => {
  assert.equal(formatNetWorth("$5-$18 million"), "$5M-$18M");
  assert.equal(formatNetWorth("$5 million-$18 million"), "$5M-$18M");
  assert.equal(formatNetWorth("$200 million-$6.5 billion"), "$200M-$6.5B");
});

test("formatNetWorth compact-formats bare numeric values", () => {
  assert.equal(formatNetWorth(5_000_000), "$5M");
  assert.equal(formatNetWorth(2_600_000_000), "$2.6B");
});
