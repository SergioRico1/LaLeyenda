import { BALANCE } from './balance';
import { clone } from './economy';
import type { ActionResult, GameState } from './types';

/**
 * gems.ts — the store's pure ledger. ROADMAP.md round 10 / PRODUCTION.md §5:
 * "Gem store. A real release needs StoreKit. Built here as a local ledger with
 * the shelf, the prices and the confirmation flow real, and the payment call
 * stubbed behind one named seam."
 *
 * THIS FILE IS THE LEDGER AND NOTHING ELSE. What a pack costs in euros, what it
 * contains, and the one credit that moves purchased gems into `state.gems` —
 * pure arithmetic over a state passed in, testable under node. The payment call
 * itself is NOT here: platform billing is a UI-boundary concern like the wall
 * clock, and it lives behind the single ✎ SEAM in `src/ui/panels/store.ts`
 * (`requestGemPurchase`). By the time this module is involved, the money side
 * is already settled; all that happens here is bookkeeping.
 *
 * The debit side of the same ledger already exists and is untouched: gems leave
 * through `finishNow` (build.ts), `skipChest` (chests.ts) and nothing else.
 * Both read `state.gems` directly, so a credit landing here is immediately
 * spendable everywhere gems are spent — store.test.ts proves the round trip.
 *
 * THE SHELF. Four packs, and every count is an amount balance.json already
 * prices rather than a number invented to look generous:
 *
 *   ·   80 — small-speedup money. §4.4's ladder prices a finished hour at ~22
 *            gems and a finished day at ~158, so the smallest pack buys real
 *            accelerations without covering a builder (that is the next tier's
 *            job, and blurring them is how decoy tiers happen).
 *   ·  500 — exactly `builders.unlock[0].gems`: the third carpenter.
 *   · 1200 — exactly `builders.unlock[1].gems`: the fourth.
 *   · 2500 — exactly `builders.unlock[2].gems`: the fifth, the last thing the
 *            game prices in gems. No pack above it: a 6 500-gem tier (Clash
 *            sells one) would price nothing in THIS game, and a shelf tier that
 *            exists only to make the one below look cheap is a decoy.
 *
 * Prices are reference EUR in integer cents, formatted by the panel. Under
 * StoreKit the store's localized price replaces the formatted string (products
 * carry their own display price per storefront); the cents here are the design
 * anchor and what the tests hold: value per euro must rise monotonically with
 * pack size — a bigger pack is never a worse deal — and mildly, because a steep
 * bulk discount is the "best value" scream RETENTION.md's shop refuses to be.
 */

export interface GemPack {
  /** Stable id — the string a StoreKit product id would be derived from. */
  id: string;
  /** Shelf name, es-ES. Lives here rather than in the panel because the pack
   *  IS the name — a receipt, a test and the shelf must all call it one thing. */
  label: string;
  /** What lands in `state.gems` when the credit clears. */
  gems: number;
  /** Reference price in EUR cents. The panel formats it; StoreKit localizes it. */
  priceCents: number;
}

export const GEM_PACKS: readonly GemPack[] = [
  { id: 'punado', label: 'Puñado de Gemas', gems: 80, priceCents: 199 },
  { id: 'bolsa', label: 'Bolsa de Gemas', gems: 500, priceCents: 499 },
  { id: 'cofre', label: 'Cofre de Gemas', gems: 1200, priceCents: 999 },
  { id: 'arcon', label: 'Arcón de Gemas', gems: 2500, priceCents: 1899 },
];

export function packById(id: string): GemPack | null {
  return GEM_PACKS.find((p) => p.id === id) ?? null;
}

/** Gems per euro — the honesty metric store.test.ts asserts is monotonic. */
export const packValue = (pack: GemPack): number => pack.gems / (pack.priceCents / 100);

/**
 * The builder-unlock prices this shelf claims to align with, read from
 * balance.json rather than repeated, so the claim cannot rot silently.
 */
export const pricedGemSpends = (): number[] => BALANCE.builders.unlock.map((u) => u.gems);

/**
 * The credit — a settled payment becomes gems.
 *
 * Called by the panel AFTER `requestGemPurchase` (the ✎ SEAM) resolves ok, and
 * dispatched through the game like every other action, so autosave, onChange
 * and the HUD's gem counter all see it the ordinary way. It cannot fail for
 * money reasons — the money already moved — only for a pack id this build does
 * not sell, which is refused rather than credited as zero.
 *
 * Deliberately NOT clamped: `state.gems` has no cap anywhere in the sim (§4.4
 * spends have no ceiling to respect), and a cap invented here would destroy
 * paid-for currency, which is the one bug a store may never have.
 */
export function creditPack(state: GameState, packId: string): ActionResult & { gems: number } {
  const next = clone(state);
  const pack = packById(packId);
  if (!pack) return { state: next, events: [], ok: false, refusal: 'unknown-building', gems: 0 };
  next.gems += pack.gems;
  return { state: next, events: [], ok: true, gems: pack.gems };
}
