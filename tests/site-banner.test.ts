import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSiteBannerLinkDisplay,
  resolveSiteBannerLinkLabel,
  siteBannerStatus,
} from "../server/services/site-banner-logic";

test("resolveSiteBannerLinkLabel falls back to Learn more", () => {
  assert.equal(resolveSiteBannerLinkLabel(null), "Learn more");
  assert.equal(resolveSiteBannerLinkLabel(undefined), "Learn more");
  assert.equal(resolveSiteBannerLinkLabel(""), "Learn more");
  assert.equal(resolveSiteBannerLinkLabel("   "), "Learn more");
});

test("resolveSiteBannerLinkLabel returns trimmed custom label", () => {
  assert.equal(resolveSiteBannerLinkLabel(" View details "), "View details");
});

test("normalizeSiteBannerLinkDisplay defaults unknown values to cta_chevron", () => {
  assert.equal(normalizeSiteBannerLinkDisplay(null), "cta_chevron");
  assert.equal(normalizeSiteBannerLinkDisplay(undefined), "cta_chevron");
  assert.equal(normalizeSiteBannerLinkDisplay("cta_chevron"), "cta_chevron");
  assert.equal(normalizeSiteBannerLinkDisplay("inline_link"), "inline_link");
  assert.equal(normalizeSiteBannerLinkDisplay("invalid"), "cta_chevron");
});

test("siteBannerStatus reports live when enabled and in schedule", () => {
  const now = new Date("2026-06-06T12:00:00Z");
  assert.equal(
    siteBannerStatus(
      {
        isEnabled: true,
        startsAt: new Date("2026-06-06T10:00:00Z"),
        endsAt: new Date("2026-06-07T10:00:00Z"),
      },
      now,
    ),
    "live",
  );
});
