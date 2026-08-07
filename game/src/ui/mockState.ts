import type { HudState, WorldItemSpec } from './hud';

/**
 * mockState.ts — THE ONE PLACE THE FAKE NUMBERS LIVE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  REPLACE THIS FILE WHEN THE ECONOMY SIM LANDS.
 *  Nothing else in src/ui/ invents a value. hud.ts takes an HudState and
 *  renders it; islandScene.ts takes MOCK_WORLD and projects it. Swap both
 *  exports for live sim state and the HUD needs no other change.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every figure is drawn from the spec so the mock is not arbitrary:
 *   · the pill values are the ones in the §2.1 portrait diagram
 *   · the caps are real store levels from §4.2
 *   · one free builder of two (§4.3 — we start with TWO, §9 correction)
 *   · a chest at 3h 51m and a build at 7m 17s are the §4.10 exit state
 */

export const MOCK_HUD: HudState = {
  level: 3,
  xp: 62,
  xpMax: 100,

  // §4.3 / §9: the game starts with TWO builders. One idle carpenter is the
  // whole reason the free-builder nag exists at all.
  builders: { free: 1, total: 2 },

  // §2.4 priority 3 — rank / notoriety. Pre-formatted: thin-space separators
  // are load-bearing (§6.15) and format.n() is the only thing allowed to make
  // them, so the sim will hand this in already formatted too.
  status: '1 240',

  // Top → bottom, exactly the §2.1 priority: Oro, Madera, Ron, Metal.
  // Five rows = Ayuntamiento 4 (§4.1); a fresh save shows three.
  resources: [
    { id: 'oro',    value: 815,  cap: 1500 },              // Banco Nv1
    { id: 'madera', value: 2436, cap: 6000, pressing: true }, // Almacén Nv2, 2 sawmills capped
    { id: 'ron',    value: 1556, cap: 4000 },              // Bodega Nv2
    { id: 'metal',  value: 480,  cap: 1000 },              // Depósito Nv1
  ],
  gems: 256,

  // Badges only for things claimable in 1–2 taps (§3.8, §6.22):
  // a ready chest, two finished missions, and an idle carpenter.
  badges: { cofres: 1, diario: 3, construir: 1 },

  chestTimerMs: 3 * 3600_000 + 51 * 60_000,   // 3h 51m
  chestSlots: [
    { state: 'ready' },
    { state: 'unlocking', remainingMs: 3 * 3600_000 + 51 * 60_000, totalMs: 8 * 3600_000 },
    { state: 'waiting' },
    { state: 'empty' },
  ],

  sailLocked: false,
  leftHanded: false,
};

/** A world-anchored HUD object and the building it hangs over. `lift` is in
 *  world units above the building's ground cell. */
export interface MockWorldAnchor {
  item: WorldItemSpec;
  /** Model id from the BUILDINGS table in islandScene.ts. */
  building: string;
  lift: number;
}

export const MOCK_WORLD: MockWorldAnchor[] = [
  // The Ayuntamiento upgrading — 7m 17s at the harness's fixed t = 2.0s.
  {
    building: 'bldg_townhall',
    lift: 7.5,
    item: { id: 'build-townhall', kind: 'timer', remainingMs: 439_000, totalMs: 600_000 },
  },

  // Collection bubbles. They appear as soon as a producer holds ≥1 unit, not
  // when it fills, so the island is never visually dead (§3.9). Phases are
  // spread so the bob never syncs.
  {
    building: 'bldg_marketplace',
    lift: 6.5,
    item: { id: 'pick-oro', kind: 'bubble', resource: 'oro', amount: 320, phase: 0 },
  },
  {
    building: 'bldg_windmill',
    lift: 6.5,
    item: { id: 'pick-madera', kind: 'bubble', resource: 'madera', amount: 260, phase: 0.37 },
  },
  {
    building: 'bldg_distillery',
    lift: 6,
    item: { id: 'pick-ron', kind: 'bubble', resource: 'ron', amount: 180, phase: 0.71 },
  },

  // §3.10 — the quiet register. Anchored lower and to the side of the peak so
  // it can never collide with a bubble on the same structure.
  { building: 'bldg_foundry', lift: 4.5, item: { id: 'full-metal', kind: 'full' } },
  { building: 'bldg_bank',    lift: 4,   item: { id: 'full-oro',   kind: 'full' } },
];
