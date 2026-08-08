import type * as THREE from 'three';
import { bakeIcons, type IconSet } from './icons';
import { el, punch, pressable } from './components/dom';
import { createPill, type Pill } from './components/pill';
import { createTile } from './components/button';
import { createBuilderChip } from './components/builderChip';
import { createChip, createStatusChip } from './components/chip';
import { createTimerBar, type TimerBar } from './components/timerBar';
import { createBubble, BUBBLE_TIP, type Bubble } from './components/bubble';
import { createTray, type SlotState } from './components/tray';
import { n } from './format';
import { COPY } from './copy';
import { FROZEN } from './env';
import { detectPack } from './pack';
import { createToasts, refuse } from './toast';
import { sfx } from './sfx';

/**
 * hud.ts — assembles the §2 layout and exposes the small surface the sim
 * drives it through.
 *
 * `#ui` is pointer-events:none and only leaf interactive elements opt back in,
 * so the island stays pannable through every gap in the HUD.
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
export type HudCue = 'construir' | 'cofres' | 'diario' | 'pills' | 'zarpar' | 'recoger' | 'none';

export interface HudState {
  level: number;
  xp: number;
  xpMax: number;
  builders: { free: number; total: number };
  /** §2.4 — one slot, one occupant, resolved by priority. */
  status: string;
  /** Top → bottom. Staged reveal (§4.1): 3 rows early, 5 at Ayuntamiento 4. */
  resources: ResourceState[];
  gems: number;
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

  const builderChip = createBuilderChip({
    icon: icons.carpintero,
    onTap: () => open('Constructores'),
    onPlus: () => open('Gemas'),
  });
  const statusChip = createStatusChip({
    icon: icons.rango,
    onTap: () => open('Rangos de Capitán'),
  });

  // The chip pair lives directly on the HUD, not inside the left column: in
  // landscape it has to centre on the viewport (§2.2), not on the column.
  const chips = el('div', 'zone-a-chips', builderChip.el, statusChip.el);
  const zoneALeft = el('div', 'zone-a-left', levelRow);

  // §4.1 staged reveal: three rows early, five at Ayuntamiento 4. The stack is
  // rebuilt only when the SET of resources changes, so a new pill can slide in
  // mid-session without the others being torn down and re-created every frame.
  const pills = new Map<ResourceId, Pill>();
  const zoneARight = el('div', 'zone-a-right');
  // §3.3 — the gem pill differs in exactly three ways: no fill bar, a `+` on
  // the end OPPOSITE the icon, and a light rim top AND bottom.
  const gemPill = createPill({ icon: icons.gema, onPlus: () => open('Gemas') });
  let pillOrder = '';

  function syncPills(): void {
    const wanted = state.resources.map((r) => r.id);
    const key = wanted.join(',');
    if (key === pillOrder) return;
    // The FIRST build of the stack is a layout, not a reveal. Every one after
    // it is §4.1's staged reveal — the moment a brand-new currency enters the
    // player's game — and it used to happen as a silent layout shift.
    const staged = pillOrder !== '';
    pillOrder = key;
    ceilingCache = null;   // the stack just got taller or shorter
    for (const id of wanted) {
      if (pills.has(id)) continue;
      const pill = createPill({ fill: RESOURCE_FILL[id], icon: icons[id] });
      if (staged && !FROZEN) {
        pill.el.classList.add('is-revealing');
        pill.el.addEventListener('animationend', () => pill.el.classList.remove('is-revealing'), { once: true });
        sfx('pop');
      }
      pills.set(id, pill);
    }
    for (const [id, pill] of [...pills]) {
      if (wanted.includes(id)) continue;
      pill.el.remove();
      pills.delete(id);
    }
    zoneARight.append(...wanted.map((id) => pills.get(id)!.el), gemPill.el);
  }
  syncPills();

  /* --- ZONE C ----------------------------------------------------------- */
  const sail = createTile({
    kind: 'cta', family: 'orange', icon: icons.zarpar, lock: icons.candado,
    caption: COPY['cta.sail'], label: COPY['cta.sail'],
    onTap: () => {
      // §3.5 — a locked CTA names the key. It also SHAKES, so the answer and
      // the object it is about are visibly the same event.
      if (state.sailLocked) { refuse(sail.el); open('Construye el Muelle'); return; }
      open('Zarpar');
    },
  });
  const build = createTile({
    kind: 'sub', family: 'orange', icon: icons.construir,
    label: COPY['cta.build'],
    onTap: () => open('Construir'),
  });
  const zoneCPrimary = el('div', 'zone-c-primary', sail.el, build.el);

  const chests = createTile({
    kind: 'featured', icon: icons.cofres,
    caption: COPY['cta.chests'], label: COPY['cta.chests'],
    onTap: () => open('Cofres'),
  });
  const log = createTile({
    kind: 'icon', family: 'grey', icon: icons.diario,
    label: COPY['cta.log'], onTap: () => open('Diario de a Bordo'),
  });
  const settings = createTile({
    kind: 'icon', family: 'grey', icon: icons.ajustes,
    label: COPY['cta.settings'], onTap: () => open('Ajustes'),
  });
  const zoneCUtility = el(
    'div', 'zone-c-utility',
    chests.el,
    el('div', 'cluster-row', log.el, settings.el)
  );

  const tray = createTray({ chest: icons.cofres, lock: icons.candado }, () => open('Cofres'));

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

  const hud = el(
    'div', 'hud',
    zoneALeft, chips, zoneARight,
    zoneCPrimary, zoneCUtility, tray.el, collectAll,
    toasts.el, guide
  );
  root.append(zoneB, hud);

  /* --- world-anchored layer --------------------------------------------- */
  const world = new Map<string, WorldItem>();
  let viewport = { w: window.innerWidth, h: window.innerHeight };
  /** Scene time in seconds, as of the last tick(). */
  let elapsedNow = 0;
  /** Scene time at which the current HudState's timers were measured. */
  let stateSetAt = 0;

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
      const bar = createTimerBar(() => open('Terminar Ya'));
      bar.set(spec.remainingMs, spec.totalMs);
      item.bar = bar;
      anchor.append(bar.el);
    } else if (spec.kind === 'done') {
      // §3.11 — "a green ✓ bubble appears that must be tapped to inaugurate the
      // building (that tap grants XP)". The loop must never leave a gap where
      // the building shows nothing, so this is the object that stands in
      // between the timer bar disappearing and the finished model being just
      // another rooftop.
      const mark = el('div', 'ok-bubble ok-bubble__bob', checkMark());
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-label', 'Inaugurar');
      pressable(mark, () => inaugurate(item));
      item.ay = 1;
      anchor.style.setProperty('--ay', '-100%');
      anchor.append(mark);
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
      ceilingCache = Math.max(
        zoneARight.getBoundingClientRect().bottom,
        chips.getBoundingClientRect().bottom
      ) + 8;
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

  /* --- collection: the value FLIES to its pill (§5.4) ---------------------
   * The sim is told immediately, so the state is never a lie. The PILL is not:
   * the collected amount is held back from the displayed figure until the
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
    const pill = pills.get(spec.resource);
    const flying = !!pill && !FROZEN && flights < 8;

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
      pill?.hit();
      // §5.4: the destination REACTS on arrival. Without a sound on the landing
      // the flight is a silent arc that ends in a colour change.
      if (flying) sfx('land');
      render();
    };

    // Cap simultaneous flights at 8; beyond that the value lands directly.
    if (!flying) { land(); syncCollectAll(); return; }
    flights++;
    flyNumber(from, pill!.target(), `+${n(moved)}`, () => { flights--; land(); });
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
    const mark = item.inner.firstElementChild as HTMLElement | null;
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

  /* --- render ------------------------------------------------------------ */
  function render(): void {
    syncPills();
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

    builderChip.set(state.builders.free, state.builders.total);
    statusChip.set(state.status);

    for (const res of state.resources) {
      const pill = pills.get(res.id);
      if (!pill) continue;
      // Value still arcing towards this pill is withheld until it lands (§5.4).
      pill.set(Math.max(0, res.value - (inFlight.get(res.id) ?? 0)), res.cap);
      pill.setPressing(Boolean(res.pressing));
    }
    gemPill.set(state.gems);

    chests.badge.set(state.badges.cofres);
    log.badge.set(state.badges.diario);
    build.badge.set(state.badges.construir);
    // §5.6's permitted idle loop. The tray carries it in landscape; in portrait
    // the tray is collapsed into this tile (§10.8), so the tile carries it.
    chests.setReady(state.chestSlots.some((s) => s.state === 'ready'));
    chests.setTimer(state.chestTimerMs);
    sail.setLocked(state.sailLocked);
    tray.set(state.chestSlots);

    // §4.8 is resolved in the sim and handed over in `cue`, so there is exactly
    // one implementation of the priority list rather than two that drift.
    const next = state.cue ?? 'none';
    build.setCued(next === 'construir');
    chests.setCued(next === 'cofres');
    log.setCued(next === 'diario');
    sail.setCued(next === 'zarpar');

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
    if (tip || FROZEN) return;
    const target = build.el.getBoundingClientRect();
    const host = hud.getBoundingClientRect();
    tip = el('div', 'guide-tip',
      el('span', 't', COPY['guide.idleBuilder']),
      el('i', 'guide-tip__arrow'));
    // Sits directly above the tile it points at, inside the viewport — the
    // arrow is what connects it to Construir, so the two must line up.
    tip.style.left = `${Math.min(host.width - 222, Math.max(8, target.left - host.left - 12))}px`;
    tip.style.bottom = `${host.bottom - target.top + 14}px`;
    guide.append(tip);
    sfx('pop');
  }

  /** Any tap anywhere restarts the idle clock and dismisses an open tooltip. */
  root.addEventListener('pointerdown', () => { lastTouch = elapsedNow; dismissGuide(); }, true);

  window.addEventListener('resize', () => {
    viewport = { w: window.innerWidth, h: window.innerHeight };
    ceilingCache = null;
    for (const item of world.values()) item.size = null;
  });

  render();
  syncCollectAll();

  return {
    root: hud,
    state: () => state,
    setState(patch) {
      Object.assign(state, patch);
      stateSetAt = elapsedNow;
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

      // §3.4 — 30s idle with a free builder escalates the Zone A nag into a
      // tooltip pointing at the tile that can spend him.
      if (state.builders.free > 0 && !tip && elapsed - lastTouch > 30) showGuide();
      else if (state.builders.free <= 0 && tip) dismissGuide();

      for (const item of world.values()) {
        if (item.spec.kind !== 'timer' || !item.bar) continue;
        const since = (elapsed - item.setAt) * 1000;
        item.bar.set(Math.max(0, item.spec.remainingMs - since), item.spec.totalMs);
      }
      const since = (elapsed - stateSetAt) * 1000;
      if (state.chestTimerMs != null) chests.setTimer(Math.max(0, state.chestTimerMs - since));
      tray.set(state.chestSlots.map((s) =>
        s.state === 'unlocking' ? { ...s, remainingMs: Math.max(0, s.remainingMs - since) } : s
      ));
    },
  };
}
