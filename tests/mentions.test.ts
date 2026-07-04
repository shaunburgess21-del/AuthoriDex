import test from "node:test";
import assert from "node:assert/strict";
import {
  extractMentions,
  mentionsToPlainText,
  serializeBodyWithMentions,
  serializeMention,
  splitMentionSegments,
  type MentionToken,
} from "../shared/lib/mentions";

test("serializeMention produces stable token format", () => {
  assert.equal(
    serializeMention({ type: "person", id: "abc-123", display: "Trevor Noah" }),
    "@[Trevor Noah](person:abc-123)",
  );
});

test("extractMentions parses person and user tokens", () => {
  const body = "Hey @[Trevor Noah](person:p1) and @[skazz](user:u1)!";
  assert.deepEqual(extractMentions(body), [
    { display: "Trevor Noah", type: "person", id: "p1" },
    { display: "skazz", type: "user", id: "u1" },
  ]);
});

test("serializeBodyWithMentions replaces tracked @Display text", () => {
  const mentions: MentionToken[] = [{ type: "person", id: "p1", display: "Trevor Noah" }];
  const body = "I think @Trevor Noah should be up there";
  assert.equal(
    serializeBodyWithMentions(body, mentions),
    "I think @[Trevor Noah](person:p1) should be up there",
  );
});

test("mentionsToPlainText collapses tokens to @Display", () => {
  const body = "Look @[Trevor Noah](person:p1)";
  assert.equal(mentionsToPlainText(body), "Look @Trevor Noah");
});

test("splitMentionSegments interleaves text and mention segments", () => {
  const body = "Hi @[Ada Lovelace](user:u2)!";
  const segments = splitMentionSegments(body);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].kind, "text");
  assert.equal(segments[1].kind, "mention");
  assert.equal(segments[1].mention?.display, "Ada Lovelace");
});

test("untracked @text stays literal through serialize", () => {
  const body = "Hello @RandomHandle";
  assert.equal(serializeBodyWithMentions(body, []), body);
});
