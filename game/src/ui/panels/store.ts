import './store.css';
import { el, iconImg, pressable, punch } from '../components/dom';
import { markX } from './marks';
import { n } from '../format';
import { CAPTURE, SHOT } from '../env';
import { sfx } from '../sfx';
import { GEM_PACKS, packById, type GemPack } from '../../sim/gems';

/**
 * store.ts — la Tienda. PRODUCTION.md §5's gem store: RETENTION.md §9's gems
 * with a real purchase surface. The SHELF, the PRICES, the two-step CONFIRM
 * and the LEDGER credit are all real; the one thing that is not is the payment
 * itself, which sits behind `requestGemPurchase` below — the single seam a
 * StoreKit integration replaces.
 *
 * The shape is Clash's gem shop (reference/clash/coc_shop_gems.jpg): item
 * CARDS on a dark well — name, count, the goods, a price band — inside the
 * same cream sheet Ajustes established, at Kingshot's chrome budget: one
 * header, one balance strip, four cards, one note. NO dark patterns, which for
 * this screen means concretely: no countdown offers, no "MEJOR VALOR" ribbon
 * shouting at one tier, no decoy pack priced to make its neighbour look
 * clever, and a footer that says out loud that gems are also EARNED by
 * playing. The confirmation always states both sides of the trade — what you
 * receive, what it costs — before any payment call is made, and the fail line
 * says explicitly that nothing was charged.
 */

/* ==========================================================================
 * ✎ SEAM — StoreKit goes here, and ONLY here.
 *
 * This is the payment call. Everything else in the flow is already real: the
 * shelf above it, the confirm step that gathers intent before it, and the
 * pure ledger credit (`creditPack`, src/sim/gems.ts) that runs after it.
 *
 * To ship: replace the body with the platform purchase —
 *   1. resolve `pack.id` to the StoreKit product (suggested product id:
 *      `es.laleyenda.gems.<pack.id>`), whose LOCALIZED price then replaces
 *      the reference `formatPrice` string on the shelf and the confirm card;
 *   2. `purchase()` and await the transaction;
 *   3. map success → `{ ok:true, transactionId }`, user-cancel →
 *      `{ ok:false, reason:'cancelled' }`, anything else →
 *      `{ ok:false, reason:'failed' }`;
 *   4. finish (consume) the transaction only AFTER the caller has dispatched
 *      `creditPack` and the save has committed, so a crash between charge and
 *      credit re-delivers rather than swallows the purchase.
 *
 * The stub approves after a short beat so the confirm card's pending state is
 * a real state a reviewer can see; under a deterministic capture it resolves
 * immediately with a fixed id so shots stay byte-identical.
 * ======================================================================= */
export type PurchaseOutcome =
  | { ok: true; transactionId: string }
  | { ok: false; reason: 'cancelled' | 'failed' };

export function requestGemPurchase(pack: GemPack): Promise<PurchaseOutcome> {
  if (CAPTURE) return Promise.resolve({ ok: true, transactionId: `capture-${pack.id}` });
  return new Promise((resolve) => {
    window.setTimeout(
      () => resolve({ ok: true, transactionId: `local-${pack.id}-${Date.now()}` }),
      600
    );
  });
}

/* ==========================================================================
 * copy — es-ES, and it stays in this module (house rule: never copy.ts)
 * ======================================================================= */

const COPY = {
  heading: 'Tienda',
  close: 'Cerrar',
  balance: 'Tus gemas',
  /** What the currency actually does in THIS game — the honest sales pitch. */
  what: 'Las gemas terminan obras al instante, abren cofres sin esperar y contratan más carpinteros.',
  gems: (v: number) => `${n(v)} gemas`,

  confirmGet: 'Recibes',
  confirmPrice: 'Precio',
  buy: 'Comprar',
  cancel: 'Cancelar',
  pending: 'Conectando con la tienda…',
  paidTitle: '¡Gemas a bordo!',
  paidBody: (v: number) => `${n(v)} gemas se han añadido a tu tesoro.`,
  paidGo: 'Seguir',
  cancelled: 'Compra cancelada. No se ha cobrado nada.',
  failed: 'El pago no se completó. No se ha cobrado nada.',

  /** RETENTION.md §9 — gems are earned by playing; the store must say so. */
  earned: 'También ganas gemas jugando: misiones diarias, cofres y despejar tu isla.',
  platform: 'Pago único a través de la tienda de aplicaciones.',
} as const;

/** Reference EUR price, formatted es-ES: 499 → "4,99 €". Under StoreKit the
 *  product's own localized price string replaces this (see the seam). */
export const formatPrice = (cents: number): string =>
  `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/* ==========================================================================
 * options
 * ======================================================================= */

export interface StorePanelOptions {
  /** Current balance, re-read on every render — the game owns the number. */
  gems(): number;
  /**
   * The ledger credit, dispatched through the game (creditPack) so autosave,
   * onChange and the HUD counter all see it the ordinary way. Returns whether
   * it took and what landed.
   */
  onBuy(packId: string): { ok: boolean; gems: number };
  onClose(): void;
  /** Baked voxel gem, from icons.ts. Optional: the layout holds without it. */
  gemIcon?: string;
}

export interface StorePanel {
  readonly el: HTMLElement;
  dispose(): void;
}

/* ==========================================================================
 * the panel
 * ======================================================================= */

export function createStorePanel(opts: StorePanelOptions): StorePanel {
  /**
   * ✎ A capture knob, not a product feature — read ONLY under `?shot=1`
   * (exactly like settings.ts's). Two states of this flow are otherwise
   * unphotographable without scripting a payment: the confirm card, and the
   * paid face behind the stub.
   *
   *   npm run shoot -- island --mobile --act store --panel confirm
   *   npm run shoot -- island --mobile --act store --panel paid
   */
  const knob = SHOT ? new URLSearchParams(location.search).get('panel') : null;

  /* --- the balance strip -------------------------------------------------- */

  const balanceNum = el('span', 'num store__balance-num', n(opts.gems()));
  const balance = el(
    'div', 'store__balance',
    el('span', 't t-body store__balance-label', COPY.balance),
    el('span', 'store__balance-pill',
      iconImg(opts.gemIcon, 'store__balance-icon'),
      balanceNum)
  );

  const paintBalance = (): void => {
    const text = n(opts.gems());
    if (balanceNum.textContent === text) return;
    balanceNum.textContent = text;
    punch(balanceNum);
  };

  /* --- the shelf ----------------------------------------------------------
   * Four cards, one per pack, every one the same object at the same volume:
   * no ribbons, no flames, no tier screaming over another. The card IS the
   * button — tapping it opens the confirm step, never a purchase. */

  const card = (pack: GemPack): HTMLElement => {
    const node = el('button', 'store__card',
      el('span', 't store__card-name', pack.label),
      el('span', 'store__card-count',
        iconImg(opts.gemIcon, 'store__card-gem'),
        el('span', 'num store__card-num', n(pack.gems))),
      // The goods, drawn as a pile that grows with the pack — the same baked
      // voxel gem at 2–5 stones, which is Clash's own trick for making four
      // tiers legible before a single number is read.
      el('span', `store__card-pile store__card-pile--${pack.id}`,
        ...Array.from({ length: pileSize(pack) }, () =>
          iconImg(opts.gemIcon, 'store__card-stone'))),
      el('span', 'store__card-price', el('span', 't store__card-price-text', formatPrice(pack.priceCents)))
    );
    node.type = 'button';
    node.setAttribute('aria-label', `${pack.label}: ${COPY.gems(pack.gems)}, ${formatPrice(pack.priceCents)}`);
    pressable(node, () => openConfirm(pack));
    return node;
  };

  const pileSize = (pack: GemPack): number =>
    2 + GEM_PACKS.findIndex((p) => p.id === pack.id);

  const shelf = el('div', 'store__grid', ...GEM_PACKS.map(card));

  /* --- the confirm step ----------------------------------------------------
   * A raised parchment card (the same object settings.ts confirms with): both
   * sides of the trade stated, Cancelar under the thumb, and only the button
   * that names the price commits. */

  const confirm = el('div', 'store__confirm');
  confirm.hidden = true;

  let buying = false;

  function closeConfirm(): void {
    if (buying) return;                       // never yank a card mid-payment
    confirm.hidden = true;
    confirm.replaceChildren();
    shelf.classList.remove('is-behind');
  }

  function openConfirm(pack: GemPack, note?: { text: string; bad: boolean }): void {
    confirm.hidden = false;
    shelf.classList.add('is-behind');

    const status = el('p', 't t-micro store__confirm-status', note?.text ?? '');
    status.classList.toggle('is-bad', Boolean(note?.bad));
    if (!note) status.hidden = true;

    const cancel = el('button', 'btn btn--grey2 store__confirm-btn', el('span', 't t-btn', COPY.cancel));
    cancel.type = 'button';
    cancel.setAttribute('aria-label', COPY.cancel);
    pressable(cancel, () => closeConfirm());

    const buy = el('button', 'btn btn--gold store__confirm-btn store__confirm-buy',
      el('span', 't t-btn', `${COPY.buy} · ${formatPrice(pack.priceCents)}`));
    buy.type = 'button';
    buy.setAttribute('aria-label', `${COPY.buy} ${pack.label}`);
    pressable(buy, () => void purchase(pack, status, [cancel, buy]));

    confirm.replaceChildren(
      el('p', 't t-caption store__confirm-title', pack.label),
      el('div', 'store__confirm-trade',
        el('div', 'store__confirm-cell',
          el('p', 't t-micro store__confirm-key', COPY.confirmGet),
          el('p', 'store__confirm-val',
            iconImg(opts.gemIcon, 'store__confirm-gem'),
            el('span', 'num store__confirm-num', n(pack.gems)))),
        el('div', 'store__confirm-cell',
          el('p', 't t-micro store__confirm-key', COPY.confirmPrice),
          el('p', 'store__confirm-val', el('span', 'num store__confirm-num', formatPrice(pack.priceCents))))),
      el('p', 't t-micro store__confirm-plat', COPY.platform),
      status,
      el('div', 'store__confirm-acts', cancel, buy)
    );
    reveal(confirm);
  }

  /** The payment, awaited through the seam, then the ledger credit. */
  async function purchase(pack: GemPack, status: HTMLElement, buttons: HTMLButtonElement[]): Promise<void> {
    if (buying) return;
    buying = true;
    for (const b of buttons) b.disabled = true;
    status.hidden = false;
    status.classList.remove('is-bad');
    status.textContent = COPY.pending;

    let outcome: PurchaseOutcome;
    try {
      outcome = await requestGemPurchase(pack);
    } catch {
      outcome = { ok: false, reason: 'failed' };
    }
    buying = false;

    if (!outcome.ok) {
      for (const b of buttons) b.disabled = false;
      status.textContent = outcome.reason === 'cancelled' ? COPY.cancelled : COPY.failed;
      status.classList.add('is-bad');
      return;
    }

    const credited = opts.onBuy(pack.id);
    if (!credited.ok) {
      // The seam approved a pack the ledger does not sell — a build error, not
      // a player error. Say so plainly rather than pretending it landed.
      for (const b of buttons) b.disabled = false;
      status.textContent = COPY.failed;
      status.classList.add('is-bad');
      return;
    }

    paintBalance();
    sfx('coin');
    navigator.vibrate?.([10, 30, 14]);
    openPaid(pack);
  }

  /** The receipt face: what landed, and one quiet way back to the shelf. */
  function openPaid(pack: GemPack): void {
    const go = el('button', 'btn btn--grey store__confirm-btn', el('span', 't t-btn', COPY.paidGo));
    go.type = 'button';
    go.setAttribute('aria-label', COPY.paidGo);
    pressable(go, () => closeConfirm());

    confirm.replaceChildren(
      el('p', 't t-caption store__confirm-title store__confirm-title--paid', COPY.paidTitle),
      el('p', 'store__confirm-val store__confirm-val--paid',
        iconImg(opts.gemIcon, 'store__confirm-gem'),
        el('span', 'num store__confirm-num', `+${n(pack.gems)}`)),
      el('p', 't t-body store__confirm-body', COPY.paidBody(pack.gems)),
      el('div', 'store__confirm-acts', go)
    );
    reveal(confirm);
  }

  /** Bring a card raised at the bottom of a scrolled body into view — the
   *  same guard settings.ts grew after its reset card shipped below the fold. */
  function reveal(node: HTMLElement): void {
    requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'end', behavior: SHOT ? 'auto' : 'smooth' });
    });
  }

  /* --- the shell ----------------------------------------------------------- */

  const close = el('button', 'btn btn--red btn-x store__x', markX('store__x-mark'));
  close.type = 'button';
  close.setAttribute('aria-label', COPY.close);
  pressable(close, opts.onClose);

  const scrim = el('div', 'store__scrim');
  scrim.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (!buying) opts.onClose();
  });

  const body = el('div', 'store__body',
    el('p', 't t-micro store__what', COPY.what),
    shelf,
    confirm,
    el('p', 't t-micro store__earned', COPY.earned));

  const sheet = el('div', 'store__sheet',
    el('header', 'store__head', el('h2', 't t-title store__title', COPY.heading)),
    balance,
    body,
    close);

  const root = el('div', 'store layer-page', scrim, sheet);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !buying) opts.onClose();
  };
  document.addEventListener('keydown', onKey);

  // The capture knob, applied through the SAME entry points a finger drives.
  if (knob === 'confirm') openConfirm(packById('bolsa') ?? GEM_PACKS[1]);
  if (knob === 'paid') {
    const pack = packById('bolsa') ?? GEM_PACKS[1];
    opts.onBuy(pack.id);
    paintBalance();
    openConfirm(pack);
    openPaid(pack);
  }

  return {
    el: root,
    dispose() {
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
