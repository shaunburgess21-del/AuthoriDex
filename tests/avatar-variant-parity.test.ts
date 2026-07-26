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
  CHARGED,
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
  assert.equal(tiles.length, 15, "expected 15 review tiles");

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
    [1, 3, 3, 8],
    "expected 1 base, 3 duotones, 3 glasses, 4 charged in 2 metals",
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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

test("bolt shadows are dark enough to separate from a light avatar", () => {
  for (const metal of METALS) {
    assert.ok(
      luminance(metal.shadow) < 0.2,
      `${metal.id} shadow is too light (${luminance(metal.shadow).toFixed(2)}) to contour against yellow or orange`,
    );
  }
});

/**
 * Electricity reads as white with a coloured halo. Let the arc itself
 * carry the metal and it stops looking like an arc, so the arc stays
 * near-white and the glow does the identifying.
 */
test("arc cores stay near-white while the glow carries the metal", () => {
  for (const metal of METALS) {
    assert.ok(
      luminance(metal.arc) > 0.9,
      `${metal.id} arc is too dark (${luminance(metal.arc).toFixed(2)}) to read as electricity`,
    );

    const channels = [1, 3, 5].map((i) => parseInt(metal.arc.slice(i, i + 2), 16));
    assert.ok(
      Math.max(...channels) - Math.min(...channels) <= 48,
      `${metal.id} arc is too saturated to read as electricity`,
    );
    assert.notEqual(metal.glow, metal.arc, `${metal.id} glow must be tinted, not white`);
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
  const lattice = AVATAR_GRID_SIZE * 2;
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

/* ------------------------------------------------------------------ */
/* Plasma geometry                                                     */
/* ------------------------------------------------------------------ */

const PLASMA_SPEC = { arcs: 6, branch: 0.75, thickness: 1 } as const;
const PLASMA_LATTICES = [AVATAR_GRID_SIZE * 2, AVATAR_GRID_SIZE * 3] as const;

function plasmaSeeds(): number[] {
  return SEEDS.map((seed) => generateAvatarRoles(seed).seedHash);
}

test("plasma arcs stay inside the disc at every shipped lattice", () => {
  for (const lattice of PLASMA_LATTICES) {
    for (const seed of plasmaSeeds()) {
      const { arc, halo } = __geometry.plasmaGeometry(lattice, seed, PLASMA_SPEC);
      assert.ok(arc.length > 0, `no arc cells at lattice ${lattice}`);

      for (const cell of [...arc, ...halo]) {
        const dx = (cell.x + 0.5) / lattice - 0.5;
        const dy = (cell.y + 0.5) / lattice - 0.5;
        assert.ok(
          Math.hypot(dx, dy) <= 0.49,
          `plasma cell (${cell.x},${cell.y}) escapes the disc at lattice ${lattice}`,
        );
      }
    }
  }
});

/**
 * A user's avatar has to be the same every time it is drawn, and the
 * arcs are now part of that. They also have to differ between users, or
 * the effect is a decal rather than a generated pattern.
 */
test("plasma arcs are deterministic per seed and differ between seeds", () => {
  const lattice = AVATAR_GRID_SIZE * 3;
  const signature = (seed: number) =>
    __geometry
      .plasmaGeometry(lattice, seed, PLASMA_SPEC)
      .arc.map((c) => `${c.x},${c.y}`)
      .sort()
      .join("|");

  const seeds = plasmaSeeds();
  for (const seed of seeds) {
    assert.equal(signature(seed), signature(seed), `arcs drift for seed hash ${seed}`);
  }
  assert.equal(
    new Set(seeds.map(signature)).size,
    seeds.length,
    "two seeds produced identical lightning",
  );
});

test("plasma arcs radiate from the core rather than floating free", () => {
  const lattice = AVATAR_GRID_SIZE * 3;
  const mid = lattice / 2;

  for (const seed of plasmaSeeds()) {
    const { arc } = __geometry.plasmaGeometry(lattice, seed, PLASMA_SPEC);
    const nearCore = arc.filter((c) => Math.hypot(c.x + 0.5 - mid, c.y + 0.5 - mid) < 2);
    assert.ok(nearCore.length > 0, `seed hash ${seed} left the core disconnected`);

    // Every arc runs centre-outward, so something has to reach the rim.
    const furthest = Math.max(
      ...arc.map((c) => Math.hypot(c.x + 0.5 - mid, c.y + 0.5 - mid)),
    );
    assert.ok(
      furthest > lattice * 0.28,
      `seed hash ${seed} only reached ${furthest.toFixed(1)} cells from the core`,
    );
  }
});

test("the plasma halo never sits on an arc cell", () => {
  const lattice = AVATAR_GRID_SIZE * 3;
  for (const seed of plasmaSeeds().slice(0, 4)) {
    const { arc, halo } = __geometry.plasmaGeometry(lattice, seed, PLASMA_SPEC);
    const struck = new Set(arc.map((c) => `${c.x},${c.y}`));
    assert.ok(halo.length > 0, "expected a halo around the arcs");
    for (const cell of halo) {
      assert.ok(!struck.has(`${cell.x},${cell.y}`), "halo overlaps an arc");
    }
  }
});

test("plasma arcs cover more ground than a single bolt at the same lattice", () => {
  const lattice = AVATAR_GRID_SIZE * 2;
  const seed = plasmaSeeds()[0];
  const { arc } = __geometry.plasmaGeometry(lattice, seed, PLASMA_SPEC);
  assert.ok(
    arc.length > lattice,
    `only ${arc.length} arc cells at lattice ${lattice} — the pattern would look sparse`,
  );
});

test("thickening dilates the arcs without moving them", () => {
  const lattice = AVATAR_GRID_SIZE * 2;
  const seed = plasmaSeeds()[0];
  const thin = __geometry.plasmaGeometry(lattice, seed, { ...PLASMA_SPEC, thickness: 1 });
  const thick = __geometry.plasmaGeometry(lattice, seed, { ...PLASMA_SPEC, thickness: 2 });

  assert.ok(thick.arc.length > thin.arc.length, "thickness 2 should add cells");
  const thickSet = new Set(thick.arc.map((c) => `${c.x},${c.y}`));
  for (const cell of thin.arc) {
    assert.ok(thickSet.has(`${cell.x},${cell.y}`), "dilation dropped an original arc cell");
  }
});

/* ------------------------------------------------------------------ */
/* Seed-dependent effects                                              */
/* ------------------------------------------------------------------ */

test("only the plasma tiles vary their effects with the seed", () => {
  const tiles = buildVariantTiles(DEFAULT_TILE_OPTIONS);
  const [first, second] = SEEDS.map(generateAvatarRoles);

  for (const tile of tiles) {
    const a = JSON.stringify(tile.buildEffects(first));
    const b = JSON.stringify(tile.buildEffects(second));
    if (tile.id.startsWith("charged-plasma")) {
      assert.notEqual(a, b, `"${tile.id}" should carry the seed into its arcs`);
    } else {
      assert.equal(a, b, `"${tile.id}" should not depend on the seed`);
    }
  }
});

test("charged catalogue exposes stable ids and well-formed effects", () => {
  assert.deepEqual(
    CHARGED.map((c) => c.id),
    ["charged-plasma", "charged-plasma-bold", "charged-bolt-fine", "charged-streak"],
  );

  const roles = generateAvatarRoles(SEEDS[0]);
  for (const spec of CHARGED) {
    for (const metal of METALS) {
      const effect = spec.effect(metal, roles);
      if (effect.kind !== "plasma") continue;
      assert.equal(effect.seed, roles.seedHash, `${spec.id} lost the seed`);
      assert.ok(effect.arcs >= 4, `${spec.id} has too few arcs to fill the disc`);
      assert.ok(effect.bloom > 0, `${spec.id} has no bloom, so it will not glow`);
    }
  }
});
