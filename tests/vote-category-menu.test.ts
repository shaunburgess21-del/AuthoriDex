import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCategoryStyle } from "../client/src/components/CategoryPill";
import { VoteCategoryMenu } from "../client/src/components/VoteCategoryMenu";
import {
  CATEGORY_MENU_LABEL_MAX_CH,
  categoryMenuFaceClass,
  categoryMenuIsFiltered,
  categoryMenuTriggerLabel,
  isRawCategorySlug,
} from "../client/src/lib/categoryMenuTrigger";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const OPTIONS = [
  { value: "all", label: "All Categories" },
  { value: "favorites", label: "Favorites" },
  { value: "trending", label: "Trending" },
  { value: "sports", label: "Sports" },
  { value: "film-tv", label: "film-tv" },
  { value: "media", label: "Media & Podcast" },
];

describe("category menu trigger label", () => {
  it("says Categories until a filter is on, and never echoes a slug", () => {
    assert.equal(categoryMenuTriggerLabel("all", "All Categories"), "Categories");
    assert.equal(categoryMenuTriggerLabel("", "Sports"), "Categories");
    assert.equal(categoryMenuTriggerLabel(null, "sports"), "Categories");
    assert.equal(categoryMenuTriggerLabel("sports", "sports"), "Sports");
    assert.equal(categoryMenuTriggerLabel("film-tv", "film-tv"), "Film & TV");
    assert.equal(categoryMenuTriggerLabel("media-and-podcast", "media-and-podcast"), "Media & Podcast");
    assert.equal(isRawCategorySlug("film-tv", "film-tv"), true);
    assert.equal(isRawCategorySlug("Sports", "sports"), false);
  });

  it("prefers the registry label over the canonical name", () => {
    assert.equal(categoryMenuTriggerLabel("media", "Media & Podcast"), "Media & Podcast");
    assert.equal(categoryMenuTriggerLabel("sports", "Athletics"), "Athletics");
    assert.equal(categoryMenuTriggerLabel("favorites", "favorites"), "Favorites");
    assert.equal(categoryMenuTriggerLabel("trending", "trending"), "Trending");
  });

  it("truncates around 10–12 characters", () => {
    assert.ok(CATEGORY_MENU_LABEL_MAX_CH >= 10 && CATEGORY_MENU_LABEL_MAX_CH <= 12);
  });
});

describe("category menu face", () => {
  it("uses a quiet cyan tint when nothing is selected", () => {
    const face = categoryMenuFaceClass("all");
    assert.match(face, /bg-cyan-500\/10/);
    assert.match(face, /border-cyan-500\/40/);
    assert.match(face, /dark:bg-cyan-400\/15/);
    assert.match(face, /dark:border-cyan-300\/50/);
    assert.match(face, /dark:text-cyan-300/);
    assert.match(face, /hover:bg-cyan-500/);
    assert.match(face, /active:bg-cyan-500\/25/);
    assert.match(face, /has-\[:focus-visible\]:ring-2/);
    assert.equal(face.includes("shadow-sm"), false);
    assert.equal(categoryMenuIsFiltered("all"), false);
    assert.equal(categoryMenuIsFiltered("sports"), true);
  });

  it("paints a selected category with the chip colour map", () => {
    const sports = getCategoryStyle("sports", "sports");
    const face = categoryMenuFaceClass("sports");
    assert.match(sports.bg, /\[#FB923C\]\/10/);
    assert.match(sports.border, /\[#FB923C\]\/40/);
    assert.match(sports.text, /\[#FB923C\]/);
    assert.match(face, /\[#FB923C\]\/10/);
    assert.match(face, /\[#FB923C\]\/40/);
    assert.match(face, /\[#FB923C\]/);
    assert.match(face, /hover:brightness-110/);
    assert.match(face, /active:brightness-95/);
    assert.equal(face.includes("bg-cyan-500/10"), false);
  });

  it("keeps favorites and trending on the accent, not a hashed category colour", () => {
    const face = categoryMenuFaceClass("favorites");
    assert.match(face, /bg-cyan-500\/20/);
    assert.equal(face.includes("#FB923C"), false);
  });
});

function renderMenu(value: string) {
  // tsx compiles this component's JSX against the classic React runtime.
  (globalThis as { React?: typeof React }).React = React;
  return renderToStaticMarkup(
    createElement(VoteCategoryMenu, {
      options: OPTIONS,
      value,
      onChange: () => {},
    }),
  );
}

describe("VoteCategoryMenu markup", () => {
  it("renders a filter icon, a divider, and the menu aria without a clear control", () => {
    const html = renderMenu("all");
    assert.match(html, /data-testid="filter-vote-category-menu"/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-label="Categories: Categories"/);
    assert.match(html, /Categories/);
    assert.match(html, /data-testid="category-filter-divider"/);
    assert.match(html, /tap-44/);
    assert.match(html, /max-w-\[12ch\]/);
    assert.equal(html.includes("Clear category filter"), false);
    assert.equal(html.includes("category-menu-chrome"), false);
  });

  it("shows the registry label and a clear button that is not inside the menu trigger", () => {
    const html = renderMenu("media");
    assert.match(html, /aria-label="Categories: Media &amp; Podcast"/);
    assert.match(html, />Media &amp; Podcast</);
    assert.equal(html.includes(">media<"), false);
    const trigger = html.indexOf('data-testid="filter-vote-category-menu"');
    const triggerClose = html.indexOf("</button>", trigger);
    const clear = html.indexOf("Clear category filter");
    assert.ok(trigger > 0 && triggerClose > trigger && clear > triggerClose);
    assert.match(html, /min-h-6/);
    assert.match(html, /min-w-6/);
    assert.match(html, /#10B981/);
  });

  it("replaces a slug option label with the display name", () => {
    const html = renderMenu("film-tv");
    assert.match(html, /Film &amp; TV/);
    assert.equal(html.includes(">film-tv<"), false);
  });
});

describe("category menu wiring", () => {
  const menu = read("../client/src/components/VoteCategoryMenu.tsx");
  const css = read("../client/src/index.css");
  const vote = read("../client/src/pages/VotePage.tsx");
  const predict = read("../client/src/pages/PredictPage.tsx");

  it("keeps the drawer focus handoff and clears without opening the menu", () => {
    assert.match(menu, /SlidersHorizontal/);
    assert.match(menu, /aria-haspopup="menu"/);
    assert.match(menu, /aria-expanded=\{open\}/);
    assert.match(menu, /onChange\("all"\)/);
    assert.match(menu, /event\.stopPropagation\(\)/);
    assert.match(menu, /event\.currentTarget\.blur\(\)/);
    assert.match(menu, /onOpenAutoFocus/);
    assert.match(menu, /filter-vote-category-menu/);
    assert.match(vote, /VoteCategoryMenu/);
    assert.match(predict, /VoteCategoryMenu/);
    assert.match(vote, /data-sticky-chrome=""/);
    assert.equal(menu.includes("category-menu-chrome"), false);
  });

  it("uses the shared 44px hit pad and does not paint a taller chip", () => {
    assert.match(menu, /category-menu-trigger tap-44/);
    assert.match(menu, /py-2/);
    assert.equal(css.includes("category-menu-chrome"), false);
    assert.equal(css.includes(".category-menu-face"), false);
  });
});
