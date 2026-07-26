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
  FINISHES,
  SURFACES,
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
    "expected 1 base, 3 duotones, 3 surfaces, 2 plasma densities in 3 finishes",
  );
});

test("re-basing levels 3 and 4 changes their colours but not their layout", () => {
  const seed = SEEDS[0];
  const roles = generateAvatarRoles(seed);

  const marble = buildVariantTiles({ duotoneBase: "base", surfaceBase: "surface-marble" });
  const curated = buildVariantTiles({
    duotoneBase: "duotone-curated",
    surfaceBase: "surface-marble",
  });

  const findTile = (tiles: ReturnType<typeof buildVariantTiles>, id: string) => {
    const tile = tiles.find((t) => t.id === id);
    assert.ok(tile, `missing tile ${id}`);
    return tile;
  };

  const a = findTile(marble, "surface-marble").buildColors(roles);
  const b = findTile(curated, "surface-marble").buildColors(roles);
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
  const a = buildVariantTiles({ duotoneBase: "base", surfaceBase: "surface-marble" });
  const b = buildVariantTiles({ duotoneBase: "duotone-triad", surfaceBase: "surface-neon" });

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
    { duotoneBase: "base", surfaceBase: "surface-marble" },
    { duotoneBase: "duotone-curated", surfaceBase: "surface-aurora" },
  ] as const) {
    const keys = buildVariantTiles(options).map((t) => t.cacheKey);
    assert.equal(new Set(keys).size, keys.length, "duplicate cacheKey");
  }
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

/**
 * HSL saturation, not channel spread. Spread shrinks as a colour gets
 * darker even at full saturation, and the neon ramp deliberately drops
 * the mid-tone lightness — so spread would report it as desaturated.
 */
function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * lightness - 1));
}

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const span = max - min;
  const hue =
    max === r ? (g - b) / span + (g < b ? 6 : 0) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return hue * 60;
}

/** Shortest way round the wheel between two hues, in degrees. */
function hueGap(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/**
 * Electricity reads as white with a coloured halo. Let the arc itself
 * carry the finish and it stops looking like an arc, so the arc stays
 * near-white and the glow does the identifying.
 */
test("arc cores stay near-white while the glow carries the finish", () => {
  const roles = generateAvatarRoles(SEEDS[0]);

  for (const finish of FINISHES) {
    assert.ok(
      luminance(finish.arc) > 0.9,
      `${finish.id} arc is too dark (${luminance(finish.arc).toFixed(2)}) to read as electricity`,
    );

    const channels = [1, 3, 5].map((i) => parseInt(finish.arc.slice(i, i + 2), 16));
    assert.ok(
      Math.max(...channels) - Math.min(...channels) <= 48,
      `${finish.id} arc is too saturated to read as electricity`,
    );
    assert.notEqual(
      finish.glow(roles),
      finish.arc,
      `${finish.id} glow must be tinted, not white`,
    );
  }
});

/**
 * The whole reason `spectrum` exists is that gold lands on an amber
 * avatar and disappears. Its glow has to sit well away from the hue the
 * body is painted in, for every family — gold manages that on roughly
 * half of them, which is the bar spectrum has to clear.
 */
test("the spectrum finish separates from the body hue on every family", () => {
  const spectrum = FINISHES.find((f) => f.id === "spectrum");
  const gold = FINISHES.find((f) => f.id === "gold");
  assert.ok(spectrum && gold, "missing a finish");

  let goldClashes = 0;

  for (const family of HUE_FAMILIES) {
    const roles = generateAvatarRoles(`spectrum-probe-${family.name}`);
    const glow = spectrum.glow({ ...roles, family });
    assert.match(glow, /^#[0-9a-f]{6}$/i, `${family.name} produced a malformed glow`);

    // Read the hue back off the colour the finish actually produced,
    // rather than off the partner it was supposed to use — otherwise a
    // finish that ignored the family entirely would still pass.
    const distance = hueGap(hueOf(glow), family.primary);
    assert.ok(
      distance >= 100,
      `${family.name} glows only ${distance.toFixed(0)}deg from its own hue`,
    );

    if (hueGap(hueOf(gold.glow({ ...roles, family })), family.primary) < 100) {
      goldClashes++;
    }
  }

  // Pins the problem spectrum was added to solve. If gold ever stops
  // clashing this test is guarding nothing and should be revisited.
  assert.ok(
    goldClashes > 0,
    "gold no longer clashes with any family, so spectrum has no job",
  );
});

test("every hue family has a curated partner well away from its primary", () => {
  for (const family of HUE_FAMILIES) {
    const distance = hueGap(family.partner, family.primary);
    assert.ok(
      distance >= 105,
      `${family.name} partner is only ${distance.toFixed(0)}deg from primary — too close to contrast`,
    );
    // The analogous accent must stay distinct from the partner, or the
    // duotone tiles collapse into the base look.
    const fromAccent = hueGap(family.partner, family.accent);
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

test("finishes cover both top ranks, with an alternative for Hall of Famer", () => {
  assert.deepEqual(
    FINISHES.map((f) => [f.id, f.rank]),
    [
      ["gold", "Hall of Famer"],
      ["spectrum", "Hall of Famer (alt)"],
      ["platinum", "VoxMax Legend"],
    ],
  );
});

test("duotone and surface catalogues expose stable ids", () => {
  assert.deepEqual(
    DUOTONES.map((d) => d.id),
    ["base", "duotone-split", "duotone-triad", "duotone-curated"],
  );
  assert.deepEqual(
    SURFACES.map((s) => s.id),
    ["surface-marble", "surface-neon", "surface-aurora"],
  );
});

/**
 * Level 3's complaint was that it looked like level 2 with better
 * lighting. A candidate now has to change either the palette or the
 * pixels, not just add a highlight.
 */
test("every level 3 candidate does something a specular cannot", () => {
  const roles = generateAvatarRoles(SEEDS[0]);
  const base = buildRoleColors(roles, {});

  for (const surface of SURFACES) {
    if (surface.id === "surface-marble") continue;
    const colors = buildRoleColors(roles, surface.options);
    const effects = surface.buildEffects(roles);
    const repaints = JSON.stringify(colors) !== JSON.stringify(base);
    const transforms = effects.some((e) => ["bloom", "glow"].includes(e.kind));
    assert.ok(
      repaints || transforms,
      `"${surface.id}" only relights the disc, which is invisible at feed size`,
    );
  }
});

test("the neon ramp lifts saturation on every hue family", () => {
  const neon = SURFACES.find((s) => s.id === "surface-neon");
  assert.ok(neon, "missing the neon surface");

  for (const family of HUE_FAMILIES) {
    const roles = generateAvatarRoles(`neon-probe-${family.name}`);
    const lit = buildRoleColors({ ...roles, family }, neon.options);
    const plain = buildRoleColors({ ...roles, family }, {});

    assert.ok(
      saturation(lit.identity) >= saturation(plain.identity) - 1e-9,
      `${family.name} is no more saturated under neon than it already was`,
    );
    assert.ok(
      luminance(lit.shadow) < luminance(plain.shadow),
      `${family.name} neon shadow is not crushed below the base shadow`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Motif geometry                                                      */
/* ------------------------------------------------------------------ */

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

test("plasma arcs cover enough of the disc to read as a pattern", () => {
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

/**
 * Everything that claims to adapt to the avatar has to actually do it.
 * The listed tiles paint the same regardless of who they belong to;
 * every other tile must move with the seed, or it is a fixed overlay
 * wearing a per-user label.
 */
const SEED_INDEPENDENT = new Set([
  "base",
  "duotone-split",
  "duotone-triad",
  "duotone-curated",
  "surface-marble",
]);

test("adaptive tiles follow the avatar and fixed ones do not", () => {
  const tiles = buildVariantTiles(DEFAULT_TILE_OPTIONS);
  // Two different hue families, so a hue-derived colour is guaranteed to
  // differ where one is used at all.
  const samples = buildFamilySampleSeeds();
  const first = generateAvatarRoles(samples[0].seed);
  const second = generateAvatarRoles(samples[5].seed);

  for (const tile of tiles) {
    const a = JSON.stringify(tile.buildEffects(first));
    const b = JSON.stringify(tile.buildEffects(second));
    if (SEED_INDEPENDENT.has(tile.id)) {
      assert.equal(a, b, `"${tile.id}" is meant to paint the same for everyone`);
    } else {
      assert.notEqual(a, b, `"${tile.id}" ignores the avatar it is applied to`);
    }
  }
});

test("charged catalogue exposes stable ids and well-formed effects", () => {
  assert.deepEqual(
    CHARGED.map((c) => c.id),
    ["charged-plasma", "charged-plasma-bold"],
  );

  const roles = generateAvatarRoles(SEEDS[0]);
  for (const spec of CHARGED) {
    for (const finish of FINISHES) {
      const effect = spec.effect(finish, roles);
      assert.equal(effect.kind, "plasma", `${spec.id} is no longer a plasma effect`);
      if (effect.kind !== "plasma") continue;
      assert.equal(effect.seed, roles.seedHash, `${spec.id} lost the seed`);
      assert.ok(effect.arcs >= 4, `${spec.id} has too few arcs to fill the disc`);
      assert.ok(effect.bloom > 0, `${spec.id} has no bloom, so it will not glow`);
      // The first pass here dimmed the field so hard that the avatar
      // stopped being recognisable underneath the arcs.
      assert.ok(
        effect.dim <= 0.3,
        `${spec.id} dims the avatar by ${effect.dim}, which buries the pixel field`,
      );
    }
  }
});
