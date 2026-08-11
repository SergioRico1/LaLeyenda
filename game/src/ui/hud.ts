import type * as THREE from 'three';
import { bakeIcons, type IconSet } from './icons';
import { el, punch, pressable } from './components/dom';
import { createPill } from './components/pill';
import { createTile } from './components/button';
import { createReadout, type ReadoutCell } from './components/readout';
import { createNavSlot, createNavbar } from './components/navbar';
import { createObjective } from './components/objective';
import { createChip } from './components/chip';
import { createTimerBar, type TimerBar } from './components/timerBar';
import { createBubble, BUBBLE_TIP, type Bubble } from './components/bubble';
import { type SlotState } from './components/tray';
import { n, nc } from './format';
import { COPY } from './copy';
import { FROZEN, CAPTURE } from './env';
import { detectPack } from './pack';
import { createToasts, refuse } from './toast';
import { sfx } from './sfx';

/**
 * hud.ts — assembles the §2 layout and exposes the small surface the sim
 * drives it through.
 *
 * `#ui` is pointer-events:none and only leaf interactive elements opt back in,
 * so the island stays pannable through every gap in the HUD.
 *
 * The STRUCTURE is LAYOUT_SPEC's, which is Kingshot's, and it replaced three
 * things at once (items 1, 2 and 4):
 *
 *   · the four corner clusters became ONE bottom nav bar with five slots and
 *     one raised primary — two objects along the bottom edge where there were
 *     five, all of them now inside a thumb's arc;
 *   · the stack of separately-framed resource pills, the builder chip and the
 *     status chip became ONE translucent capsule that the world reads through,
 *     with the gem pill keeping its own frame;
 *   · §4.8's next-action resolver, which was spent on a glow, now also says
 *     what it wants in words, on one tappable line above the nav.
 *
 * The OBJECTS are still UI_SPEC's: everything pressable keeps the four layers.
 */

export type ResourceId = 'oro' | 'madera' | 'ron' | 'metal';

export interface ResourceState {
  id: ResourceId;
  value: number;
  /** The STORE cap, not the producer's internal capacity — they are two
   *  separate caps and two separate upgrade decisions (§4.2). */
  cap: number;
  /** True only while TWO OR MORE producers of this resource are at their own
   *  cap: one full producer does not earn a pulse (§3.1). */
  pressing?: boolean;
}

/** §4.8's next-action resolver, resolved in the sim and handed to the HUD so
 *  there is exactly one implementation of it. `recoger` deliberately cues no
 *  tile: the collect bubbles on the island are already the affordance. */
// 'obras' and 'recoger' both deliberately cue no chrome: the timer bars and the
// bubbles over the island are already saying it. They exist so that 'none' keeps
// meaning "the loop is genuinely broken" rather than "the list is short".
// 'almacen' is 'construir' with a reason: the last voyage spilled cargo the
// island has no store for (round 11's playtest, finding 1). Same route — the
// picker — sharper words on the objective line.
export type HudCue =
  | 'construir' | 'almacen' | 'cofres' | 'diario' | 'pills' | 'zarpar' | 'recoger' | 'obras' | 'none';

export interface HudState {
  level: number;
  xp: number;
  xpMax: number;
  builders: { free: number; total: number };
  /** §2.4 — one slot, one occupant, resolved by priority. */
  status: string;
  /** Left → right in the capsule. Staged reveal (§4.1): two currencies early,
   *  four at Ayuntamiento 4. */
  resources: ResourceState[];
  gems: number;
  /**
   * §3.8 — a badge only for something CLAIMABLE in 1–2 taps.
   *
   * `construir` is deliberately not read by the nav bar. LAYOUT_SPEC §1 gives
   * badges to two slots, Cofres and Diario, and our Isla slot is the one place
   * that table and UI_SPEC §3.8 disagree — §3.8 lists Construir as a host for
   * the free-builder signal. The table wins here because the signal it was
   * carrying now has three louder channels that did not exist when §3.8 was
   * written: the objective line says "un carpintero está libre" in words, the
   * §4.8 cue rings the Isla slot, and the capsule's builder cell still tilts
   * its carpenter and warms its face (§3.4). A red dot on top of that is the
   * degradation §3.8 itself warns about — the channel is worth more kept scarce.
   */
  badges: { cofres: number; diario: number; construir: number };
  /** Shortest running chest timer, shown as the Cofres tile caption. */
  chestTimerMs: number | null;
  chestSlots: SlotState[];
  /** ¡Zarpar! before the Muelle exists. Never a dead tap — it names the key. */
  sailLocked: boolean;
  leftHanded: boolean;
  /** Which affordance the HUD should be nagging about right now (§4.8). */
  cue?: HudCue;
}

/** Everything the HUD hands back out. The sim is dispatched to through these;
 *  hud.ts itself never knows a simulation exists. */
export interface HudHooks {
  /** Collect one producer. Returns the amount that actually reached the store
   *  — 0 means refused (a full Almacén), and the bubble stays put. */
  onCollect?(worldItemId: string): number;
  onCollectAll?(): void;
  onOpen?(what: string, detail?: string): void;
  /** §3.11 — the ✓ bubble over a finished building was tapped. */
  onInaugurate?(worldItemId: string): void;
}

export type WorldItemSpec =
  | { id: string; kind: 'bubble'; resource: ResourceId; amount: number; phase?: number }
  | { id: string; kind: 'timer'; remainingMs: number; totalMs: number }
  | { id: string; kind: 'full'; resource?: ResourceId }
  /** §3.11 — a finished building waiting to be inaugurated. The tap is what
   *  releases the XP, which is the whole point of the beat. */
  | { id: string; kind: 'done' };

export interface Hud {
  readonly root: HTMLElement;
  /** Removes the HUD and every listener it owns. A scene switch calls this. */
  dispose(): void;
  setState(patch: Partial<HudState>): void;
  state(): Readonly<HudState>;
  /**
   * §3.11 — while a finished building waits to be inaugurated, the XP it earned
   * is HELD BACK from the bar. The sim has already granted it (moving the grant
   * into the tap would mean an economy that lies about its own state), but the
   * player must not see the reward before they claim it, or the ✓ bubble is a
   * chore rather than a payoff. Releasing replays the whole arrival: the number
   * flies to the capsule, the bar fills, the badge pops on a rollover.
   */
  holdXp(): void;
  releaseXp(from?: { x: number; y: number }): void;
  /** Where a reward should fly to when it has no pill of its own. */
  xpTarget(): { x: number; y: number };
  /** §5.3 — the gem counter punches like every other counter. */
  gemTarget(): { x: number; y: number };
  addWorldItem(spec: WorldItemSpec): void;
  /** Reconciles the whole world-anchored layer against the sim in one call:
   *  adds what is new, updates what changed, removes what is gone. */
  setWorldItems(specs: WorldItemSpec[]): void;
  /** Called once per frame with the projected screen position of the anchor.
   *  Clamped to the viewport minus 16px so nothing renders half off-screen. */
  place(id: string, x: number, y: number, visible: boolean): void;
  /** Drives every running clock from the scene's simulated time. */
  tick(elapsed: number): void;
  /** §3.5 — the one place a refusal or an unbuilt route says so out loud. */
  say(text: string, opts?: { tone?: 'info' | 'refuse' }): void;
  /** Screen position of a world-anchored item, for effects that hang off it. */
  screenPos(id: string): { x: number; y: number } | null;
}

/** A green ✓ drawn as a prop, not typed as a dingbat (§6): constant-weight
 *  stroke, its own contour underneath, optically centred on its ink. */
function checkMark(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'ok-bubble__mark');
  for (const [width, colour] of [[11, '#17130E'], [6.5, '#FFFFFF']] as const) {
    const mark = document.createElementNS(NS, 'path');
    mark.setAttribute('d', 'M5 17.5 L12.5 25 L27 7');
    mark.setAttribute('fill', 'none');
    mark.setAttribute('stroke', colour);
    mark.setAttribute('stroke-width', String(width));
    mark.setAttribute('stroke-linecap', 'round');
    mark.setAttribute('stroke-linejoin', 'round');
    svg.append(mark);
  }
  return svg;
}

const RESOURCE_FILL: Record<ResourceId, string> = {
  oro: 'var(--ui-res-gold)',
  madera: 'var(--ui-res-wood)',
  ron: 'var(--ui-res-rum)',
  metal: 'var(--ui-res-metal)',
};

interface WorldItem {
  spec: WorldItemSpec;
  wrap: HTMLElement;
  inner: HTMLElement;
  bar?: TimerBar;
  bubble?: Bubble;
  ax: number;
  ay: number;
  size: { w: number; h: number } | null;
  /** Last projected screen position, or null while off-screen. */
  at: { x: number; y: number } | null;
  /** Scene time (s) when this item's remaining-ms was last set by the sim, so
   *  tick() can run the clock down smoothly between sim ticks without drifting
   *  every time the sim hands it a fresh figure. */
  setAt: number;
}

export async function createHud(
  root: HTMLElement,
  renderer: THREE.WebGLRenderer,
  initial: HudState,
  hooks: HudHooks = {}
): Promise<Hud> {
  // Baked before the first frame: the harness captures two frames after boot
  // and would otherwise catch empty pills (§7 "a collect bubble is visible in
  // frame 1 of a cold start").
  const icons: IconSet = await bakeIcons(renderer);

  // §1.8 — the display faces are bundled, but they load asynchronously and the
  // screenshot harness captures within a couple of frames. Block until they are
  // actually rendered, otherwise every heavy outlined label is caught in the
  // system fallback, which is exactly the tell that separates this from Clash.
  //
  // Note document.fonts.check() cannot be used to detect a missing face: Chrome
  // answers true for the system fallback, so it reports success either way.
  try {
    await Promise.all([
      document.fonts.load('400 16px "Lilita One"'),
      document.fonts.load('600 16px "Fredoka"'),
    ]);
    await document.fonts.ready;
  } catch { /* document.fonts is optional */ }

  // Optional artwork, awaited for the same reason as the fonts: the harness
  // captures within a couple of frames, so a late class flip would be missed.
  await detectPack();

  const state: HudState = structuredClone(initial);

  /** Bottom of the Zone A chrome, cached — see spread(). Declared here rather
   *  than beside the world layer because syncPills() invalidates it and runs
   *  before that block is evaluated. */
  let ceilingCache: number | null = null;

  /* --- ZONE B (built first so the HUD paints over it) -------------------- */
  const zoneB = el('div', 'zone-b');

  /* --- ZONE A ----------------------------------------------------------- */
  const levelBadge = el('div', 'level-badge', el('span', 'num', String(state.level)));
  const xpFill = el('div', 'xp__fill');
  const xp = el('div', 'xp', xpFill, el('i', 'xp__rim'));
  const levelRow = el('div', 'level-row', levelBadge, xp);

  // §3.3 — the gem pill differs in exactly three ways: no fill bar, a `+` on
  // the end OPPOSITE the icon, and a light rim top AND bottom. It keeps its own
  // frame while everything else groups: LAYOUT_SPEC §2 spends heavy framing on
  // the premium currency and nothing else up here, and the `+` is the one Zone A
  // control that is still pressable.
  const gemPill = createPill({ icon: icons.gema, onPlus: () => open('Gemas') });

  // LAYOUT_SPEC §2 — one dark translucent capsule with thin dividers, in place
  // of the builder chip, the status chip and the stack of resource pills.
  const readout = createReadout();

  const zoneA = el(
    'div', 'zone-a',
    el('div', 'zone-a__row', levelRow, gemPill.el),
    readout.el
  );

  /** The capsule's cells, in Kingshot's own order: the standing figure first,
   *  then the builders, then the currencies as §4.1 reveals them. */
  function readoutCells(): ReadoutCell[] {
    return [
      { id: 'rango', icon: icons.rango, label: COPY['panel.ranks'] },
      { id: 'obreros', icon: icons.carpintero, label: COPY['panel.builders'] },
      ...state.resources.map<ReadoutCell>((r) => ({
        id: r.id,
        icon: icons[r.id],
        fill: RESOURCE_FILL[r.id],
        label: COPY[`res.${r.id}`],
      })),
    ];
  }

  /** False until the capsule has been built once: the first build is a layout,
   *  every one after it is §4.1's staged reveal and gets the beat. */
  let laidOut = false;

  function syncReadout(): void {
    if (!readout.sync(readoutCells())) return;
    ceilingCache = null;              // the capsule may have changed height
    // §4.1's staged reveal — a brand-new currency entering the player's game
    // used to be a silent layout shift.
    if (laidOut && !FROZEN) sfx('pop');
    laidOut = true;
  }
  syncReadout();

  // PRODUCTION.md §5's Clasificación needs a door on the HUD, and the rank
  // cell is the one figure up here that IS the leaderboard's own number —
  // RETENTION.md's HUD spec puts the trophy tap in Zone A for exactly this.
  // LAYOUT_SPEC §2's "nothing inside the capsule takes a tap" was earned by
  // duplicating the builder chip's route in the thumb zone; the ranking has
  // no thumb-zone slot to duplicate into, so this one cell keeps its own
  // door, the way the gem pill's `+` does beside it. The cell is built once
  // and survives every staged-reveal resync, so the listener holds.
  const rango = readout.cell('rango');
  if (rango) {
    rango.el.setAttribute('role', 'button');
    rango.el.setAttribute('aria-label', 'Clasificación');
    pressable(rango.el, () => open('Clasificación'));
  }

  /* --- ZONE C — the bottom nav bar (LAYOUT_SPEC §1) ----------------------
   * Five slots, one bar. Slot 3 is the §3.5 CTA unchanged, merely raised. */
  const sail = createTile({
    kind: 'cta', family: 'orange', icon: icons.zarpar, lock: icons.candado,
    caption: COPY['cta.sail'], label: COPY['cta.sail'],
    onTap: () => sailTapped(),
  });

  function sailTapped(): void {
    // §3.5 — a locked CTA names the key. It also SHAKES, so the answer and the
    // object it is about are visibly the same event.
    if (state.sailLocked) { refuse(sail.el); open('Construye el Muelle'); return; }
    open('Zarpar');
  }

  const isla = createNavSlot({
    // Slot 1 is the island, and on this island the thing you do is build: the
    // picker is what the destination opens. §2.1 requires the builder chip's
    // route to be duplicated in the thumb zone, and this is that duplicate —
    // which is what let the chip itself become a read-only cell in the capsule.
    icon: icons.construir, label: COPY['cta.island'], onTap: () => open('Construir'),
  });
  const cofres = createNavSlot({
    icon: icons.cofres, label: COPY['cta.chests'], onTap: () => open('Cofres'),
  });
  const diario = createNavSlot({
    icon: icons.diario, label: COPY['cta.log'], onTap: () => open('Diario de a Bordo'),
  });
  const ajustes = createNavSlot({
    icon: icons.ajustes, label: COPY['cta.settings'], onTap: () => open('Ajustes'),
  });
  const navbar = createNavbar(
    [isla.el, cofres.el, diario.el, ajustes.el],
    sail.el
  );

  // LAYOUT_SPEC §4 — the resolver, said out loud, one line above the nav.
  const objective = createObjective(() => objectiveGo());
  let objectiveGo: () => void = () => {};

  // §3.9 — offered only at 4+ pending bubbles. Below that, never: a shortcut
  // that appears for two bubbles teaches the player to stop tapping the island.
  const collectAll = el('button', 'btn btn--green collect-all tap',
    el('span', 't t-btn', COPY['cta.collectAll']));
  collectAll.type = 'button';
  collectAll.hidden = true;
  collectAll.addEventListener('click', () => {
    if (hooks.onCollectAll) { hooks.onCollectAll(); return; }
    for (const item of [...world.values()]) if (item.bubble) collect(item);
  });

  // §3.5's "never a dead tap", and §3.4's escalation from the Zone A nag to the
  // tile that can act on it. Both layers had a z-index token and no users.
  const toasts = createToasts();
  const guide = el('div', 'layer-guide-host');

  // The chest tray (§3.13) is not mounted here any more. §10.8 already
  // collapsed it into the Cofres tile in portrait; the nav bar makes the same
  // argument in landscape, where four 62px slots would sit exactly where the
  // bar now is. Everything it said still gets said — the Cofres slot carries
  // the ready badge, wears the shortest unlock timer in place of its label, and
  // bobs when a chest is claimable — and the tray component itself is untouched
  // for the Cofres panel, which is where a tray belongs.
  const hud = el(
    'div', 'hud',
    zoneA,
    objective.el, navbar, collectAll,
    toasts.el, guide
  );
  root.append(zoneB, hud);

  /* --- world-anchored layer --------------------------------------------- */
  const world = new Map<string, WorldItem>();
  let viewport = { w: window.innerWidth, h: window.innerHeight };
  /** Scene time in seconds, as of the last tick(). */
  let elapsedNow = 0;

  function addWorldItem(spec: WorldItemSpec): void {
    const wrap = el('div', 'world-item');
    const anchor = el('div', 'world-item__anchor');
    wrap.append(anchor);

    const item: WorldItem = { spec, wrap, inner: anchor, ax: 0.5, ay: 1, size: null, at: null, setAt: elapsedNow };

    if (spec.kind === 'bubble') {
      const bubble = createBubble({
        icon: icons[spec.resource],
        amount: spec.amount,
        phase: spec.phase,
        onTap: () => collect(item),
      });
      item.bubble = bubble;
      item.ax = BUBBLE_TIP.x;
      item.ay = BUBBLE_TIP.y;
      anchor.style.setProperty('--ax', `${-BUBBLE_TIP.x * 100}%`);
      anchor.style.setProperty('--ay', `${-BUBBLE_TIP.y * 100}%`);
      anchor.append(bubble.el);
    } else if (spec.kind === 'timer') {
      // The tap carries the item's own id: `timer-<buildingId>` opens that
      // building's sheet, `clear-<obstacleId>` opens the clear job's (round
      // 11's finding 3). Routing "whichever job happens to be first" was only
      // ever right while one thing could run at a time.
      const bar = createTimerBar(() => open('Terminar Ya', spec.id));
      bar.set(spec.remainingMs, spec.totalMs);
      item.bar = bar;
      anchor.append(bar.el);
    } else if (spec.kind === 'done') {
      // §3.11 — "a green ✓ bubble appears that must be tapped to inaugurate the
      // building (that tap grants XP)". The loop must never leave a gap where
      // the building shows nothing, so this is the object that stands in
      // between the timer bar disappearing and the finished model being just
      // another rooftop.
      const mark = el('div', 'ok-bubble', checkMark());
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-label', 'Inaugurar');
      pressable(mark, () => inaugurate(item));
      item.ay = 1;
      anchor.style.setProperty('--ay', '-100%');
      anchor.append(el('div', 'ok-bubble__bob', mark));
    } else {
      // §10.11 — `¡Lleno!` keeps the informational dashed border but opens the
      // storage upgrade sheet in one tap. A scolding becomes a conversion.
      // The resource travels with the tap: without it the route cannot tell
      // which store this producer's chip belongs to.
      anchor.append(createChip(COPY['chip.full'], () => open('Mejorar almacén', spec.resource)));
      item.ay = 0.5;
      anchor.style.setProperty('--ay', '-50%');
    }

    world.set(spec.id, item);
    zoneB.append(wrap);
  }

  /**
   * Reconciles the layer against the sim. Bubbles are updated in place rather
   * than rebuilt: their amount changes on every frame that production runs,
   * and re-creating the element would restart the bob and defeat the
   * phase-offset that stops a row of bubbles pulsing in unison (§3.9).
   */
  function setWorldItems(specs: WorldItemSpec[]): void {
    const seen = new Set<string>();

    for (const spec of specs) {
      seen.add(spec.id);
      const item = world.get(spec.id);
      if (!item) { addWorldItem(spec); continue; }

      if (spec.kind === 'timer' && item.bar) {
        item.spec = spec;
        item.setAt = elapsedNow;
        item.bar.set(spec.remainingMs, spec.totalMs);
      } else if (spec.kind === 'bubble' && item.bubble) {
        item.spec = spec;
        item.bubble.el.setAttribute('aria-label', `Recoger ${spec.amount}`);
      }
    }

    for (const [id, item] of [...world]) {
      if (seen.has(id)) continue;
      world.delete(id);
      item.wrap.remove();
    }
    syncCollectAll();
  }

  function place(id: string, x: number, y: number, visible: boolean): void {
    const item = world.get(id);
    if (!item) return;
    item.wrap.classList.toggle('is-off', !visible);
    if (!visible) { item.at = null; return; }
    if (!item.size) {
      item.size = { w: item.inner.offsetWidth, h: item.inner.offsetHeight };
    }
    // Clamp to the viewport minus 16px — no half-off-screen bubbles (§2.1).
    const { w, h } = item.size;
    const cx = Math.min(
      Math.max(x, 16 + w * item.ax),
      Math.max(16 + w * item.ax, viewport.w - 16 - w * (1 - item.ax))
    );
    const cy = Math.min(
      Math.max(y, 16 + h * item.ay),
      Math.max(16 + h * item.ay, viewport.h - 16 - h * (1 - item.ay))
    );
    item.at = { x: cx, y: cy };
    item.wrap.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
  }

  /**
   * Keeps world-anchored labels out of Zone A and off each other.
   *
   * Two buildings five cells apart project to points far closer together than a
   * 150px timer bar is wide, so their labels land on top of one another. That is
   * not merely untidy: the covered one is UNTAPPABLE, and since §3.11's timer bar
   * is a route into §3.16's upgrade sheet, a covered bar is a feature the player
   * cannot reach. The same is true of a label that drifts up under the pill
   * stack — §2.1 gives Zone A to read-only chrome, and chrome wins the tap.
   *
   * So: everything is first pushed clear of the top cluster, then resolved
   * DOWNWARD, away from it. Resolving downward is also what keeps the pass from
   * cycling, since the list is walked top-first.
   *
   * Runs once per frame over a handful of elements, after every anchor has been
   * projected — which is why it lives in tick() rather than in place().
   */
  function spread(): void {
    const boxes: Array<{ item: WorldItem; l: number; t: number; w: number; h: number }> = [];
    for (const item of world.values()) {
      if (!item.at || !item.size) continue;
      boxes.push({
        item,
        l: item.at.x - item.size.w * item.ax,
        t: item.at.y - item.size.h * item.ay,
        w: item.size.w,
        h: item.size.h,
      });
    }
    if (boxes.length === 0) return;

    // Measured rather than assumed: the staged reveal (§4.1) changes how tall
    // the pill stack is, and landscape moves the chips to the centre.
    //
    // But it is measured ONCE and cached, not every frame. Reading a rect after
    // that frame's transform writes forces a synchronous layout, and this pass
    // runs 60 times a second — §5's performance rule is that the world-anchored
    // layer costs one transform write per element per frame and nothing else.
    // The stack's height only changes on a staged reveal or a resize, and both
    // invalidate the cache explicitly.
    if (ceilingCache === null) {
      // One box now, where it used to be the taller of two columns: grouping
      // the readouts (LAYOUT_SPEC §2) means Zone A is a single stack, and its
      // bottom edge is the whole ceiling.
      ceilingCache = zoneA.getBoundingClientRect().bottom + 8;
    }
    const ceiling = ceilingCache;

    for (const box of boxes) box.t = Math.max(box.t, ceiling);
    boxes.sort((a, b) => a.t - b.t);

    const GAP = 4;
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i];
      for (let j = 0; j < i; j++) {
        const b = boxes[j];
        const overlapX = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l);
        const overlapY = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
        if (overlapX <= 0 || overlapY <= 0) continue;
        a.t = b.t + b.h + GAP;
      }
    }

    // The resolved y is approached, not assigned. A bubble appearing over one
    // building used to make its neighbour's timer bar TELEPORT to a new row on
    // the next frame; Clash's world labels glide out of each other's way. The
    // lerp is fast enough (≈8 frames to settle) that it never reads as lag.
    for (const box of boxes) {
      const want = box.t + box.h * box.item.ay;
      const now = box.item.at!.y;
      const y = FROZEN || Math.abs(want - now) > 240 ? want : now + (want - now) * 0.28;
      if (Math.abs(y - now) < 0.2) continue;
      box.item.at!.y = y;
      box.item.wrap.style.transform =
        `translate3d(${box.item.at!.x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  /* --- collection: the value FLIES to its cell (§5.4) ---------------------
   * The sim is told immediately, so the state is never a lie. The READOUT is
   * not: the collected amount is held back from the displayed figure until the
   * number finishes its arc, otherwise the counter jumps a beat before the
   * value visibly arrives, and §5.4's whole point is that the destination
   * reacts on arrival. */
  let flights = 0;
  const inFlight = new Map<ResourceId, number>();

  function collect(item: WorldItem): void {
    const spec = item.spec;
    if (spec.kind !== 'bubble' || !item.bubble) return;
    const rect = item.bubble.el.getBoundingClientRect();
    const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.4 };
    const cell = readout.cell(spec.resource);
    const flying = !!cell && !FROZEN && flights < 8;

    if (flying) inFlight.set(spec.resource, (inFlight.get(spec.resource) ?? 0) + spec.amount);

    // Out of the reconciled set BEFORE the sim is told. Dispatching notifies
    // synchronously, and the owner answers by re-deriving the world layer — so
    // a bubble still listed here is one `setWorldItems` will find gone from the
    // state and tear out of the DOM, mid-burst, on the frame it was tapped.
    world.delete(spec.id);

    // The sim is the authority on how much actually moved: a full Almacén
    // takes what fits and refuses the rest (§4.2), and that is a different
    // message from `¡Lleno!`.
    const moved = hooks.onCollect ? hooks.onCollect(spec.id) : spec.amount;

    if (moved <= 0) {
      if (flying) inFlight.delete(spec.resource);
      // Nothing left the building, so the bubble stays and SAYS SO. This used
      // to be a bare vibrate() — which is a no-op on iOS, i.e. a completely
      // silent tap on the game's core verb.
      world.set(spec.id, item);
      refuse(item.bubble.el);
      toasts.say(COPY['chip.storageMax'], { tone: 'refuse' });
      render();
      return;
    }

    void item.bubble.burst().then(() => item.wrap.remove());
    sparks(from, RESOURCE_FILL[spec.resource]);
    navigator.vibrate?.(8);
    sfx('coin');

    const land = () => {
      if (flying) {
        const left = (inFlight.get(spec.resource) ?? 0) - spec.amount;
        if (left > 0) inFlight.set(spec.resource, left);
        else inFlight.delete(spec.resource);
      }
      cell?.hit();
      // §5.4: the destination REACTS on arrival. Without a sound on the landing
      // the flight is a silent arc that ends in a colour change.
      if (flying) sfx('land');
      render();
    };

    // Cap simultaneous flights at 8; beyond that the value lands directly.
    if (!flying) { land(); syncCollectAll(); return; }
    flights++;
    flyNumber(from, cell!.target(), `+${n(moved)}`, () => { flights--; land(); });
    syncCollectAll();
  }

  function flyNumber(
    from: { x: number; y: number },
    to: { x: number; y: number },
    label: string,
    done: () => void,
    extraClass = ''
  ): void {
    const node = el('div', `num flyer${extraClass ? ` ${extraClass}` : ''}`);
    node.textContent = label;
    // Quadratic bezier with the control point lifted, so the value visibly
    // ARCS to its destination rather than sliding.
    const cx = from.x + (to.x - from.x) * 0.35;
    const cy = Math.min(from.y, to.y) - 90;
    const at = (e: number) => {
      const u = 1 - e;
      const x = u * u * from.x + 2 * u * e * cx + e * e * to.x;
      const y = u * u * from.y + 2 * u * e * cy + e * e * to.y;
      return `translate3d(${x}px, ${y}px, 0) translate(-50%,-50%) scale(${(1 - 0.4 * e).toFixed(3)})`;
    };
    // The starting transform is written BEFORE the node is in the document.
    // Assigning it inside the first rAF meant the element's first paint was at
    // the coordinate origin — every collect flashed "+210" in the screen's
    // top-left corner for a frame before jumping onto the arc, and that frame
    // lengthens on exactly the busy frames a collect happens on.
    node.style.transform = at(0);
    hud.append(node);

    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      const e = 1 - Math.pow(1 - k, 2);          // ease-out, never linear
      node.style.transform = at(e);
      if (k < 1) requestAnimationFrame(step);
      else { node.remove(); done(); }
    };
    requestAnimationFrame(step);
  }

  function sparks(at: { x: number; y: number }, colour: string): void {
    if (FROZEN) return;
    for (let i = 0; i < 6; i++) {
      const p = el('div', 'spark');
      p.style.setProperty('--fill', colour);
      const angle = (i / 6) * Math.PI * 2 + 0.4;
      const dist = 26 + (i % 3) * 8;
      const place = (e: number) =>
        `translate3d(${at.x + Math.cos(angle) * dist * e}px, ${at.y + Math.sin(angle) * dist * e + e * e * 26}px, 0)`;
      // Same rule as the flyer: placed before it is appended, never after.
      p.style.transform = place(0);
      hud.append(p);
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 320);
        const e = 1 - Math.pow(1 - k, 2);
        p.style.transform = place(e);
        p.style.opacity = String(1 - k);
        if (k < 1) requestAnimationFrame(step);
        else p.remove();
      };
      requestAnimationFrame(step);
    }
  }

  /* --- §3.11 inauguration -------------------------------------------------
   * The ✓ over a finished building. Tapping it bursts the bubble, releases the
   * XP the sim already granted, and flies it to the capsule — so the reward
   * lands on the player's gesture rather than four frames after a timer they
   * were not watching. */
  function inaugurate(item: WorldItem): void {
    if (item.spec.kind !== 'done') return;
    const id = item.spec.id;
    world.delete(id);
    const mark = item.inner.querySelector('.ok-bubble') as HTMLElement | null;
    const rect = (mark ?? item.inner).getBoundingClientRect();
    sfx('build');
    navigator.vibrate?.([10, 30, 18]);
    if (mark && !FROZEN) {
      mark.classList.add('is-bursting');
      window.setTimeout(() => item.wrap.remove(), 190);
    } else {
      item.wrap.remove();
    }
    sparks({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, 'var(--ui-timer-a)');
    releaseXp({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    hooks.onInaugurate?.(id);
  }

  function syncCollectAll(): void {
    let pending = 0;
    for (const item of world.values()) if (item.bubble) pending++;
    collectAll.hidden = pending < 4;
  }

  /* --- §3.11 the held XP --------------------------------------------------
   * While a ✓ bubble is waiting to be tapped, the bar shows what the player
   * had BEFORE the job finished. Freezing the snapshot rather than tracking an
   * amount means the rollover works for free: a level-up that happens inside
   * the held window is simply part of what the release reveals. */
  type XpView = { level: number; xp: number; xpMax: number };
  let xpHold: XpView | null = null;
  let shownLevel = state.level;
  /** What the bar is painting now, and what it painted before the last change.
   *  The event that says "a job finished" arrives AFTER the state carrying its
   *  XP has already been pushed and rendered, so holding the current value
   *  would hold the reward the player is not supposed to have seen yet. What
   *  has to be restored is the figure from before that change. */
  let painted: XpView | null = null;
  let previous: XpView | null = null;

  function holdXp(): void {
    if (xpHold) return;                 // a second finish joins the first hold
    xpHold = previous ?? painted ?? { level: state.level, xp: state.xp, xpMax: state.xpMax };
    render();
  }

  function releaseXp(from?: { x: number; y: number }): void {
    const held = xpHold;
    xpHold = null;
    render();
    if (!held || FROZEN) return;
    const gained = Math.round(
      (state.level - held.level) * held.xpMax + state.xp - held.xp
    );
    if (gained > 0 && from) {
      flyNumber(from, xpTarget(), `+${n(gained)} XP`, () => punch(xp), 'flyer--xp');
    }
  }

  function xpTarget(): { x: number; y: number } {
    const r = xp.getBoundingClientRect();
    return { x: r.left + r.width * 0.7, y: r.top + r.height / 2 };
  }

  /* --- LAYOUT_SPEC §4 — the objective line -------------------------------
   * The §4.8 resolver already ran, in the sim, and arrived as `state.cue`. All
   * this does is put its verdict into words and hand the tap the route that
   * verdict implies — there is no second priority list here to drift from the
   * first. The progress figure beside each line is read from the same HudState
   * the capsule and the badges are drawn from, for the same reason.
   */
  function objectiveView(): { text: string; count: string | null; go: () => void } | null {
    switch (state.cue ?? 'none') {
      case 'construir':
        return {
          text: COPY['obj.builder'],
          count: `${state.builders.free}/${state.builders.total}`,
          go: () => open('Construir'),
        };
      case 'almacen':
        // Round 11's playtest, finding 1 — the last voyage spilled cargo the
        // island cannot hold. The line names the fix; the tap opens the same
        // picker 'construir' does, where the store's row carries its price.
        // (Copy lives here, not in copy.ts — that file is shared this round.)
        return {
          text: 'El botín del mar necesita un almacén',
          count: null,
          go: () => open('Construir'),
        };
      case 'cofres':
        return {
          text: COPY['obj.chest'],
          count: state.badges.cofres > 0 ? String(state.badges.cofres) : null,
          go: () => open('Cofres'),
        };
      case 'diario':
        return {
          text: COPY['obj.log'],
          count: state.badges.diario > 0 ? String(state.badges.diario) : null,
          go: () => open('Diario de a Bordo'),
        };
      case 'pills': {
        // The cue fires when 2+ producers of one resource are capped, so the
        // line has to name WHICH store — and it routes exactly where §3.10's
        // `¡Lleno!` chip routes, carrying the resource with it so the sheet
        // opens on the right building rather than the first store in the list.
        const res = state.resources.find((r) => r.pressing) ?? state.resources[0];
        if (!res) return null;
        return {
          text: `${COPY['obj.store']} ${COPY[`res.${res.id}`]}`,
          count: `${nc(res.value)}/${nc(res.cap)}`,
          go: () => open('Mejorar almacén', res.id),
        };
      }
      case 'zarpar':
        return { text: COPY['obj.sail'], count: null, go: sailTapped };
      case 'recoger': {
        const pending = pendingBubbles();
        // §4.8's own note: this hit "surfaces no chrome — the bubbles are
        // already saying so". The line still says it, because a goal line that
        // blinks out is worse chrome than one that is always there; what it
        // must NOT do is collect for you. §3.9 withholds Recoger Todo below
        // four bubbles precisely so a shortcut never teaches the player to stop
        // tapping the island, and this line would be that shortcut at one
        // bubble. So the tap POINTS: every pending bubble punches at once.
        return {
          text: COPY['obj.collect'],
          count: pending > 0 ? String(pending) : null,
          go: pointAtBubbles,
        };
      }
      default:
        return null;
    }
  }

  const pendingBubbles = (): number => {
    let count = 0;
    for (const item of world.values()) if (item.bubble) count++;
    return count;
  };

  /** The 'recoger' line's tap: it points rather than collecting. Each answer
   *  is the right one for its case — the bubbles answer visually when there
   *  are any, and the game answers in words when the line has gone stale. */
  function pointAtBubbles(): void {
    let found = 0;
    for (const item of world.values()) {
      if (!item.bubble) continue;
      punch(item.bubble.el);
      found++;
    }
    if (found > 0) sfx('pop');
    else toasts.say(COPY['obj.collectTip']);
  }

  /* --- render ------------------------------------------------------------ */
  function render(): void {
    syncReadout();
    const view: XpView = xpHold ?? { level: state.level, xp: state.xp, xpMax: state.xpMax };
    if (!xpHold && (!painted || painted.xp !== view.xp || painted.level !== view.level)) {
      previous = painted;
      painted = { ...view };
    }
    levelBadge.firstElementChild!.textContent = String(view.level);
    // A rollover must never run the bar BACKWARDS through the middle: it fills
    // to 100%, the transition is suppressed for the reset, then it grows again.
    if (view.level !== shownLevel) {
      if (view.level > shownLevel && !FROZEN) {
        sfx('levelup');
        punch(levelBadge);
        levelBadge.classList.remove('is-levelling');
        void levelBadge.offsetWidth;
        levelBadge.classList.add('is-levelling');
        xp.style.setProperty('--pct', '1');
        xp.classList.add('is-rolling');
        window.setTimeout(() => {
          xp.style.setProperty('--pct', '0');
          void xp.offsetWidth;
          xp.classList.remove('is-rolling');
          xp.style.setProperty('--pct', String(Math.max(0, Math.min(1, view.xp / view.xpMax))));
        }, 260);
      }
      shownLevel = view.level;
      if (FROZEN) xp.style.setProperty('--pct', String(Math.max(0, Math.min(1, view.xp / view.xpMax))));
    } else {
      xp.style.setProperty('--pct', String(Math.max(0, Math.min(1, view.xp / view.xpMax))));
    }

    // The capsule's three kinds of cell. §2.4's status readout and §3.4's
    // builder counter are figures the player reads and never presses, which is
    // exactly LAYOUT_SPEC's test for what may be grouped and made translucent.
    readout.cell('rango')?.setText(state.status);
    const obreros = readout.cell('obreros');
    obreros?.setText(`${state.builders.free}/${state.builders.total}`);
    // §3.4 — a free builder must annoy: the carpenter tilts and the cell warms.
    obreros?.setFree(state.builders.free > 0);

    for (const res of state.resources) {
      const cell = readout.cell(res.id);
      if (!cell) continue;
      // Value still arcing towards this cell is withheld until it lands (§5.4).
      cell.set(Math.max(0, res.value - (inFlight.get(res.id) ?? 0)), res.cap);
      cell.setPressing(Boolean(res.pressing));
    }
    gemPill.set(state.gems);

    cofres.badge.set(state.badges.cofres);
    diario.badge.set(state.badges.diario);
    // §5.6's permitted idle loop, which used to live on the featured Cofres
    // tile: it moved with the destination rather than being dropped with the
    // frame. (`chestTimerMs` stays on HudState for the Cofres panel — see the
    // note in navbar.ts on why the nav bar deliberately does not show it.)
    cofres.setReady(state.chestSlots.some((s) => s.state === 'ready'));
    sail.setLocked(state.sailLocked);

    // §4.8 is resolved in the sim and handed over in `cue`, so there is exactly
    // one implementation of the priority list rather than two that drift.
    const next = state.cue ?? 'none';
    isla.setCued(next === 'construir' || next === 'almacen');
    cofres.setCued(next === 'cofres');
    diario.setCued(next === 'diario');
    sail.setCued(next === 'zarpar');

    // …and the same verdict, said in words (LAYOUT_SPEC §4).
    const goal = objectiveView();
    objectiveGo = goal?.go ?? (() => {});
    objective.set(goal);

    // The nav bar's primary is CENTRED, so there is no longer a handed cluster
    // to mirror — which is one more thing the bar bought. The class stays on
    // the host for anything downstream that reads it (§10.1's Zurdo / Diestro).
    hud.classList.toggle('is-left-handed', state.leftHanded);
  }

  function open(what: string, detail?: string): void {
    lastTouch = elapsedNow;
    dismissGuide();
    // Panels are the next slice; until then the owner decides what a route
    // does, and a tap is never silent.
    if (hooks.onOpen) hooks.onOpen(what, detail);
    else console.log(`[hud] open: ${what}${detail ? ` (${detail})` : ''}`);
  }

  /* --- §3.4 the idle-builder tooltip --------------------------------------
   * The nag half of the free-builder signal worked — the carpenter tilts ±8°
   * with a gold halo every 2.5s. The BRIDGE half did not exist: the copy string
   * had no reader anywhere in src/, so a player who never looks at Zone A never
   * learns that a chip out of thumb reach is about a tile in it. §3.4 is
   * explicit that the escalation is what stops the tilt becoming wallpaper.
   *
   * It now points at the nav bar's Isla slot, which is where the builder went.
   */
  let lastTouch = 0;
  let tip: HTMLElement | null = null;

  function dismissGuide(): void {
    if (!tip) return;
    const node = tip;
    tip = null;
    if (FROZEN) { node.remove(); return; }
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 160);
  }

  function showGuide(): void {
    // CAPTURE, not FROZEN: the tooltip is information, and §5 keeps every state
    // change when motion is cut. Only a deterministic capture suppresses it.
    if (tip || CAPTURE) return;
    const target = isla.el.getBoundingClientRect();
    const host = hud.getBoundingClientRect();
    const arrow = el('i', 'guide-tip__arrow');
    tip = el('div', 'guide-tip', el('span', 't', COPY['guide.idleBuilder']), arrow);
    tip.style.bottom = `${host.bottom - target.top + 14}px`;
    guide.append(tip);

    // The bubble is clamped inside the viewport, so on a 430pt screen it cannot
    // sit above the slot it is about. The ARROW is what carries the meaning —
    // it is placed against the SLOT and only then clamped inside the bubble, so
    // it keeps pointing at Isla however far the bubble had to move.
    const width = tip.getBoundingClientRect().width;
    const left = Math.min(host.width - width - 8, Math.max(8, target.left - host.left - 12));
    tip.style.left = `${left}px`;
    const aim = target.left - host.left + target.width / 2 - left - 11;
    arrow.style.left = `${Math.min(width - 32, Math.max(10, aim))}px`;
    sfx('pop');
  }

  /** Any tap anywhere restarts the idle clock and dismisses an open tooltip. */
  root.addEventListener('pointerdown', () => { lastTouch = elapsedNow; dismissGuide(); }, true);

  // Aborted by dispose(). A resize handler that outlives its HUD would keep a
  // torn-down scene's DOM alive and recompute a layout nobody is looking at.
  const listeners = new AbortController();
  window.addEventListener('resize', () => {
    viewport = { w: window.innerWidth, h: window.innerHeight };
    ceilingCache = null;
    for (const item of world.values()) item.size = null;
  }, { signal: listeners.signal });

  render();
  syncCollectAll();

  return {
    root: hud,
    dispose() {
      listeners.abort();
      hud.remove();
    },
    state: () => state,
    setState(patch) {
      Object.assign(state, patch);
      render();
    },
    holdXp,
    releaseXp,
    xpTarget,
    gemTarget: () => gemPill.target(),
    say: (text, opts) => toasts.say(text, opts),
    screenPos(id) {
      const item = world.get(id);
      return item?.at ? { ...item.at } : null;
    },
    addWorldItem,
    setWorldItems,
    place,
    /**
     * Runs every visible clock down between sim ticks. Each figure is measured
     * from the scene time at which the sim last supplied it, so re-syncing from
     * the sim mid-countdown corrects the display instead of double-counting it.
     */
    tick(elapsed) {
      elapsedNow = elapsed;
      spread();

      // §3.4 — 30s idle with a free builder escalates the capsule's nag into a
      // tooltip pointing at the slot that can spend him.
      if (state.builders.free > 0 && !tip && elapsed - lastTouch > 30) showGuide();
      else if (state.builders.free <= 0 && tip) dismissGuide();

      for (const item of world.values()) {
        if (item.spec.kind !== 'timer' || !item.bar) continue;
        const since = (elapsed - item.setAt) * 1000;
        item.bar.set(Math.max(0, item.spec.remainingMs - since), item.spec.totalMs);
      }
    },
  };
}
