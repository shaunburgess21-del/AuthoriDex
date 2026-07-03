import test from "node:test";
import assert from "node:assert/strict";
import {
  PSEUDONYM_ADJECTIVES,
  PSEUDONYM_NOUNS,
} from "../shared/lib/username/pseudonym-words";
import {
  USERNAME_PATTERN,
  buildPseudonym,
  isValidUsername,
  pseudonymWithNewSuffix,
  randomPseudonymCandidate,
} from "../shared/lib/username/suggest-pseudonym";

test("word pools meet minimum size targets", () => {
  assert.ok(PSEUDONYM_ADJECTIVES.length >= 150, "adjective pool too small");
  assert.ok(PSEUDONYM_NOUNS.length >= 150, "noun pool too small");
});

test("pool words are PascalCase-safe length", () => {
  for (const w of [...PSEUDONYM_ADJECTIVES, ...PSEUDONYM_NOUNS]) {
    assert.match(w, /^[A-Za-z]+$/);
    assert.ok(w.length >= 3 && w.length <= 10, `word out of range: ${w}`);
  }
});

test("buildPseudonym uses PascalCase adj+noun and 1–99 suffix", () => {
  assert.equal(buildPseudonym("Bold", "Falcon", 42), "BoldFalcon42");
  assert.equal(buildPseudonym("Bold", "Falcon", 1), "BoldFalcon1");
  assert.equal(buildPseudonym("Bold", "Falcon", 99), "BoldFalcon99");
  assert.equal(buildPseudonym("Bold", "Falcon", 0), "BoldFalcon1");
  assert.equal(buildPseudonym("Bold", "Falcon", 150), "BoldFalcon99");
});

test("randomPseudonymCandidate always matches username rules", () => {
  for (let i = 0; i < 200; i++) {
    const { username, num } = randomPseudonymCandidate();
    assert.ok(num >= 1 && num <= 99);
    assert.ok(isValidUsername(username), username);
    assert.ok(USERNAME_PATTERN.test(username), username);
    assert.ok(username.length <= 30, username);
  }
});

test("pseudonymWithNewSuffix can change only the numeric suffix", () => {
  const next = pseudonymWithNewSuffix("Keen", "Oracle", 7);
  assert.match(next.username, /^KeenOracle\d{1,2}$/);
  assert.notEqual(next.num, 7);
  assert.ok(isValidUsername(next.username));
});
