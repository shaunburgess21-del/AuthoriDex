import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function buttonClassBefore(sourceText: string, testId: string): string {
  const at = sourceText.indexOf(`data-testid="${testId}"`);
  assert.ok(at > 0, testId);
  return sourceText.slice(Math.max(0, at - 220), at);
}

test("logged-out header keeps a compact Sign up down to 360px", () => {
  const header = source("client/src/components/HeaderUserActions.tsx");
  const signIn = buttonClassBefore(header, "button-header-sign-in");
  const signUp = buttonClassBefore(header, "button-header-sign-up");
  assert.equal(/md:hidden|lg:hidden|max-\[/.test(signUp), false);
  assert.match(signUp, /shrink-0/);
  assert.match(signIn, /max-\[359px\]:hidden/);
  assert.equal(/md:hidden|lg:hidden/.test(signIn), false);
});

test("toasts stack above sticky chrome and under dialogs", () => {
  const css = source("client/src/index.css");
  assert.match(css, /\[data-sonner-toaster\]\[data-y-position="top"\][\s\S]*z-index:\s*55/);
  assert.match(css, /\[data-sonner-toaster\]\[data-y-position="bottom"\][\s\S]*z-index:\s*55/);
  assert.match(source("client/src/components/ui/dialog.tsx"), /z-\[70\]/);
  const toaster = source("client/src/components/ThemedToaster.tsx");
  assert.match(toaster, /measuredToastTopClearance/);
  assert.match(toaster, /TOAST_MOBILE_BOTTOM_OFFSET/);
  assert.match(source("client/src/lib/toast-policy.ts"), /bottom-center/);
});

test("glossary hints sit on labels for shares, P&L, and Curate Profile", () => {
  const predict = source("client/src/pages/PredictPage.tsx");
  assert.match(predict, /town-square-glossary/);
  assert.match(predict, /SHARES_AND_PNL_TERMS/);
  assert.match(predict, /term="h2h"/);

  const vote = source("client/src/pages/VotePage.tsx");
  assert.match(vote, /term="curateProfile"/);
  assert.match(vote, /term="inductionQueue"/);
  assert.match(vote, /term="approval"/);

  assert.match(source("client/src/pages/TownSquarePage.tsx"), /town-square-page-glossary/);
  assert.match(source("client/src/components/predict/PositionSummaryRow.tsx"), /term="pnl"/);
  assert.match(source("client/src/components/predict/MarketActivityFeed.tsx"), /term: "shares"/);
  assert.match(source("client/src/components/LeaderboardRow.tsx"), /term="trendScore"/);
  assert.match(source("client/src/components/LeaderboardRow.tsx"), /term="approval"/);
  assert.match(source("client/src/components/PersonInsightModal.tsx"), /term="wikiSignal"/);
  assert.match(source("client/src/components/PersonInsightModal.tsx"), /term="newsSignal"/);
  assert.match(source("client/src/components/UserMenu.tsx"), /term="xp"/);
  assert.match(source("client/src/components/UserMenu.tsx"), /term="vox"/);
});
