import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBaseRoleColors,
  buildFamilySampleSeeds,
  generateAvatar,
  generateAvatarRoles,
  paintRoleGrid,
  HUE_FAMILIES,
  AVATAR_GRID_SIZE,
} from "../client/src/lib/avatar/generator";
import {
  buildRoleColors,
  buildVariantTiles,
  DEFAULT_TILE_OPTIONS,
  DUOTONES,
  GLASSES,
  METALS,
} from "../client/src/lib/avatar/colorways";
import { __geometry } from "../client/src/lib/avatar/effects";

interface GoldenEntry {
  seed: string;
  seedHash: number;
  grid: string[][];
}

const here = dirname(fileURLToPath(import.meta.url));
const golden: GoldenEntry[] = JSON.parse(
  readFileSync(resolve(here, "fixtures/avatar-base-golden.json"), "utf8"),
);

const SEEDS = golden.map((e) => e.seed);

/* ------------------------------------------------------------------ */
/* Base parity — the gate on every generator change                    */
/* ------------------------------------------------------------------ */

/**
 * The golden fixture was captured from the pre-refactor generator. Drift
 * here means a live user's avatar would silently repaint, so this guards
 * the role bag, the RNG call order, and the base colourway together.
 */
test("base colourway reproduces the pre-refactor grids exactly", () => {
  assert.ok(golden.length >= 12, "fixture should cover a spread of seeds");

  for (const entry of golden) {
    const result = generateAvatar(entry.seed);
    assert.equal(result.seedHash, entry.seedHash, `seedHash drift for "${entry.seed}"`);
    assert.deepEqual(result.grid, entry.grid, `pixel drift for "${entry.seed}"`);
  }
});

test("golden fixture spans multiple hue families", () => {
  const families = new Set(golden.map((e) => generateAvatarRoles(e.seed).family.name));
  assert.ok(families.size >= 4, `fixture only covers ${families.size} hue families`);
});

/**
 * colorways.ts keeps its own copy of the ramp so variants can tweak it.
 * If the two drift apart, the base tile in the lab stops matching what
 * users actually have.
 */
test("colorway ramp with default options matches the canonical base", () => {
  for (const seed of SEEDS) {
    const roles = generateAvatarRoles(seed);
    assert.deepEqual(
      buildRoleColors(roles, {}),
      buildBaseRoleColors(roles),
      `ramp drift for "${seed}"`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Layout invariance — the point of the whole refactor                 */
/* ------------------------------------------------------------------ */

/**
 * Reduce a painted grid to the pattern of which cells match which. Two
 * variants that preserve layout produce identical signatures even though
 * every colour differs.
 */
function layoutSignature(grid: string[][]): string {
  const order = new Map<string, number>();
  return grid
    .map((row) =>
      row
        .map((hex) => {
          if (!order.has(hex)) order.set(hex, order.size);
          return order.get(hex);
        })
        .join(","),
    )
    .join("|");
}

test("every variant paints the identical layout for a given seed", () => {
  const tiles = buildVariantTiles(DEFAULT_TILE_OPTIONS);
  assert.equal(tiles.length, 13, "expected 13 review tiles");

  for (const seed of SEEDS) {
    const roles = generateAvatarRoles(seed);
    const expected = layoutSignature(
      paintRoleGrid(roles.roleGrid, buildBaseRoleColors(roles)),
    );

    for (const tile of tiles) {
      const painted = paintRoleGrid(roles.roleGrid, tile.buildColors(roles));
      assert.equal(
        layoutSignature(painted),
        expected,
        `layout drift in "${tile.id}" for seed "${seed}"`,
      );
    }
  }
});

/**
 * A duotone is meant to swap the accent and nothing else. If it also
 * moves the primary roles the avatar stops reading as the same person,
 * which is the one thing the whole progression cannot afford.
 */
test("duotones recolour only the accent roles", () => {
  const duotoneTiles = buildVariantTiles(DEFAULT_TILE_OPTIONS).filter((t) => t.level === 2);
  assert.equal(duotoneTiles.length, 3);

  for (const seed of SEEDS) {
    const roles = generateAvatarRoles(seed);
    const base = buildBaseRoleColors(roles);

    for (const tile of duotoneTiles) {
      const colors = tile.buildColors(roles);
      for (const role of ["shadow", "dark", "identity", "bright", "highlight", "sparkle"] as const) {
        assert.equal(
          colors[role],
          base[role],
          `"${tile.id}" moved the ${role} role for seed "${seed}"`,
        );
      }
      assert.notEqual(
        colors.accentMid,
        base.accentMid,
        `"${tile.id}" left the accent unchanged for seed "${seed}"`,
      );
    }
  }
});

test("the accent roles are a minority of the grid", () => {
  for (const seed of SEEDS) {
    const flat = generateAvatarRoles(seed).roleGrid.flat();
    const accent = flat.filter((r) => r === "accentMid" || r === "accentLight").length;
    const cells = AVATAR_GRID_SIZE * AVATAR_GRID_SIZE;
    assert.ok(
      accent / cells < 0.4,
      `accent covers ${accent}/${cells} cells for "${seed}" — identity should dominate`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Catalogue shape                                                     */
/* ------------------------------------------------------------------ */

test("tile ids are unique and cover all four levels", () => {
  const tiles = buildVariantTiles(DEFAULT_TILE_OPTIONS);
  const ids = tiles.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate tile id");

  const byLevel = new Map<number, number>();
  for (const tile of tiles) {
    byLevel.set(tile.level, (byLevel.get(tile.level) ?? 0) + 1);
  }
  assert.deepEqual(
    [byLevel.get(1), byLevel.get(2), byLevel.get(3), byLevel.get(4)],
    [1, 3, 3, 6],
    "expected 1 base, 3 duotones, 3 glasses, 3 charged in 2 metals",
  );
});

test("re-basing levels 3 and 4 changes their colours but not their layout", () => {
  const seed = SEEDS[0];
  const roles = generateAvatarRoles(seed);

  const marble = buildVariantTiles({ duotoneBase: "base", glassBase: "glass-marble" });
  const curated = buildVariantTiles({
    duotoneBase: "duotone-curated",
    glassBase: "glass-marble",
  });

  const findTile = (tiles: ReturnType<typeof buildVariantTiles>, id: string) => {
    const tile = tiles.find((t) => t.id === id);
    assert.ok(tile, `missing tile ${id}`);
    return tile;
  };

  const a = findTile(marble, "glass-marble").buildColors(roles);
  const b = findTile(curated, "glass-marble").buildColors(roles);
  assert.notEqual(a.accentMid, b.accentMid, "duotone base should change the accent");
  assert.equal(a.identity, b.identity, "duotone base must not move the identity hue");
});

/**
 * Levels 3 and 4 keep a stable `id` while their colours follow the
 * re-base dropdowns. Anything memoising a render has to key on
 * `cacheKey`, or switching base serves the previous configuration's
 * pixels back.
 */
test("cacheKey tracks the re-base configuration that id does not", () => {
  const a = buildVariantTiles({ duotoneBase: "base", glassBase: "glass-marble" });
  const b = buildVariantTiles({ duotoneBase: "duotone-triad", glassBase: "glass-chrome" });

  for (const [left, right] of a.map((tile, i) => [tile, b[i]] as const)) {
    assert.equal(left.id, right.id, "tile order and ids should be stable across configs");

    if (left.level >= 3) {
      assert.notEqual(
        left.cacheKey,
        right.cacheKey,
        `"${left.id}" reuses a cacheKey across different bases`,
      );
    } else {
      assert.equal(
        left.cacheKey,
        right.cacheKey,
        `"${left.id}" does not depend on the base and should keep one cacheKey`,
      );
    }
  }
});

test("cacheKeys are unique within a configuration", () => {
  for (const options of [
    { duotoneBase: "base", glassBase: "glass-marble" },
    { duotoneBase: "duotone-curated", glassBase: "glass-gloss" },
  ] as const) {
    const keys = buildVariantTiles(options).map((t) => t.cacheKey);
    assert.equal(new Set(keys).size, keys.length, "duplicate cacheKey");
  }
});

test("bolt shadows are dark enough to separate from a light avatar", () => {
  for (const metal of METALS) {
    const channels = [1, 3, 5].map((i) => parseInt(metal.shadow.slice(i, i + 2), 16));
    const luminance = (channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114) / 255;
    assert.ok(
      luminance < 0.2,
      `${metal.id} shadow is too light (${luminance.toFixed(2)}) to contour against yellow or orange`,
    );
  }
});

test("every hue family has a curated partner well away from its primary", () => {
  for (const family of HUE_FAMILIES) {
    // Shortest way round the wheel between the two hues.
    const distance = Math.abs(((family.partner - family.primary + 540) % 360) - 180);
    assert.ok(
      distance >= 105,
      `${family.name} partner is only ${distance.toFixed(0)}deg from primary — too close to contrast`,
    );
    // The analogous accent must stay distinct from the partner, or the
    // duotone tiles collapse into the base look.
    const fromAccent = Math.abs(((family.partner - family.accent + 540) % 360) - 180);
    assert.ok(
      fromAccent >= 60,
      `${family.name} partner sits ${fromAccent.toFixed(0)}deg from its own accent`,
    );
  }
});

test("family sample seeds cover every hue family exactly once", () => {
  const samples = buildFamilySampleSeeds();
  assert.equal(samples.length, HUE_FAMILIES.length);
  assert.equal(new Set(samples.map((s) => s.family)).size, HUE_FAMILIES.length);

  for (const sample of samples) {
    assert.equal(generateAvatarRoles(sample.seed).family.name, sample.family);
  }
});

test("metals use the Hall of Famer and VoxMax Legend rank colours", () => {
  assert.deepEqual(
    METALS.map((m) => [m.rank, m.fill]),
    [
      ["Hall of Famer", "#FFD700"],
      ["VoxMax Legend", "#E5E4E2"],
    ],
  );
});

test("duotone and glass catalogues expose stable ids", () => {
  assert.deepEqual(
    DUOTONES.map((d) => d.id),
    ["base", "duotone-split", "duotone-triad", "duotone-curated"],
  );
  assert.deepEqual(
    GLASSES.map((g) => g.id),
    ["glass-marble", "glass-gloss", "glass-chrome"],
  );
});

/* ------------------------------------------------------------------ */
/* Motif geometry                                                      */
/* ------------------------------------------------------------------ */

test("bolt fits inside the inscribed circle at both lattices", () => {
  for (const multiplier of [1, 2] as const) {
    const lattice = AVATAR_GRID_SIZE * multiplier;
    const cells = __geometry.boltCells(lattice);
    assert.ok(cells.length > 0, `no bolt cells at lattice ${lattice}`);

    for (const cell of cells) {
      const dx = (cell.x + 0.5) / lattice - 0.5;
      const dy = (cell.y + 0.5) / lattice - 0.5;
      assert.ok(
        Math.hypot(dx, dy) <= 0.49,
        `bolt cell (${cell.x},${cell.y}) escapes the disc at lattice ${lattice}`,
      );
    }
  }
});

test("the finer lattice resolves the bolt in more detail", () => {
  const coarse = __geometry.boltCells(AVATAR_GRID_SIZE);
  const fine = __geometry.boltCells(AVATAR_GRID_SIZE * 2);
  // Four fine cells cover one coarse cell, so a faithful bolt gains
  // meaningfully more than a 4x count if the coarse pass dropped detail.
  assert.ok(
    fine.length > coarse.length * 2,
    `fine lattice only produced ${fine.length} cells against ${coarse.length}`,
  );
});

test("bolt drop shadow sits beside the bolt, never on it", () => {
  const lattice = AVATAR_GRID_SIZE;
  const cells = __geometry.boltCells(lattice);
  const occupied = new Set(cells.map((c) => `${c.x},${c.y}`));
  const shadow = __geometry.boltShadowCells(cells, lattice);

  assert.ok(shadow.length > 0, "expected a drop shadow");
  for (const cell of shadow) {
    assert.ok(!occupied.has(`${cell.x},${cell.y}`), "shadow overlaps the bolt");
  }
});

test("streak spans the disc without escaping it", () => {
  const lattice = AVATAR_GRID_SIZE;
  const cells = __geometry.streakCells(lattice, 2);
  assert.ok(cells.length >= lattice, "streak should cross the whole disc");

  for (const cell of cells) {
    const dx = (cell.x + 0.5) / lattice - 0.5;
    const dy = (cell.y + 0.5) / lattice - 0.5;
    assert.ok(Math.hypot(dx, dy) <= 0.49, "streak cell escapes the disc");
  }
});
