import type * as THREE from 'three';
import { bakeIcons, type IconSet } from './icons';
import { el } from './components/dom';
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
}

export type WorldItemSpec =
  | { id: string; kind: 'bubble'; resource: ResourceId; amount: number; phase?: number }
  | { id: string; kind: 'timer'; remainingMs: number; totalMs: number }
  | { id: string; kind: 'full'; resource?: ResourceId };

export interface Hud {
  readonly root: HTMLElement;
  setState(patch: Partial<HudState>): void;
  state(): Readonly<HudState>;
  addWorldItem(spec: WorldItemSpec): void;
  /** Called once per frame with the projected screen position of the anchor.
   *  Clamped to the viewport minus 16px so nothing renders half off-screen. */
  place(id: string, x: number, y: number, visible: boolean): void;
  /** Drives every running clock from the scene's simulated time. */
  tick(elapsed: number): void;
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
}

export async function createHud(
  root: HTMLElement,
  renderer: THREE.WebGLRenderer,
  initial: HudState
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

  const state: HudState = structuredClone(initial);

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

  const pills = new Map<ResourceId, Pill>();
  const zoneARight = el('div', 'zone-a-right');
  for (const res of state.resources) {
    const pill = createPill({ fill: RESOURCE_FILL[res.id], icon: icons[res.id] });
    pills.set(res.id, pill);
    zoneARight.append(pill.el);
  }
  // §3.3 — the gem pill differs in exactly three ways: no fill bar, a `+` on
  // the end OPPOSITE the icon, and a light rim top AND bottom.
  const gemPill = createPill({ icon: icons.gema, onPlus: () => open('Gemas') });
  zoneARight.append(gemPill.el);

  /* --- ZONE C ----------------------------------------------------------- */
  const sail = createTile({
    kind: 'cta', family: 'orange', icon: icons.zarpar,
    caption: COPY['cta.sail'], label: COPY['cta.sail'],
    onTap: () => (state.sailLocked ? open('Construye el Muelle') : open('Zarpar')),
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

  const tray = createTray(icons.cofres, () => open('Cofres'));

  // §3.9 — offered only at 4+ pending bubbles. Below that, never: a shortcut
  // that appears for two bubbles teaches the player to stop tapping the island.
  const collectAll = el('button', 'btn btn--green collect-all tap',
    el('span', 't t-btn', COPY['cta.collectAll']));
  collectAll.type = 'button';
  collectAll.hidden = true;
  collectAll.addEventListener('click', () => {
    for (const item of [...world.values()]) if (item.bubble) collect(item);
  });

  const hud = el(
    'div', 'hud',
    zoneALeft, chips, zoneARight,
    zoneCPrimary, zoneCUtility, tray.el, collectAll
  );
  root.append(zoneB, hud);

  /* --- world-anchored layer --------------------------------------------- */
  const world = new Map<string, WorldItem>();
  let viewport = { w: window.innerWidth, h: window.innerHeight };

  function addWorldItem(spec: WorldItemSpec): void {
    const wrap = el('div', 'world-item');
    const anchor = el('div', 'world-item__anchor');
    wrap.append(anchor);

    const item: WorldItem = { spec, wrap, inner: anchor, ax: 0.5, ay: 1, size: null };

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
    } else {
      // §10.11 — `¡Lleno!` keeps the informational dashed border but opens the
      // storage upgrade sheet in one tap. A scolding becomes a conversion.
      anchor.append(createChip(COPY['chip.full'], () => open('Mejorar almacén')));
      item.ay = 0.5;
      anchor.style.setProperty('--ay', '-50%');
    }

    world.set(spec.id, item);
    zoneB.append(wrap);
  }

  function place(id: string, x: number, y: number, visible: boolean): void {
    const item = world.get(id);
    if (!item) return;
    item.wrap.classList.toggle('is-off', !visible);
    if (!visible) return;
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
    item.wrap.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
  }

  /* --- collection: the value FLIES to its pill (§5.4) --------------------- */
  let flights = 0;

  function collect(item: WorldItem): void {
    const spec = item.spec;
    if (spec.kind !== 'bubble' || !item.bubble) return;
    const rect = item.bubble.el.getBoundingClientRect();
    const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.4 };
    const pill = pills.get(spec.resource);

    world.delete(spec.id);
    void item.bubble.burst().then(() => item.wrap.remove());
    sparks(from, RESOURCE_FILL[spec.resource]);
    navigator.vibrate?.(8);

    const land = () => {
      const res = state.resources.find((r) => r.id === spec.resource);
      if (res && pill) {
        res.value = Math.min(res.cap, res.value + spec.amount);
        pill.hit();
        pill.set(res.value, res.cap);
      }
    };

    // Cap simultaneous flights at 8; beyond that the value lands directly.
    if (!pill || FROZEN || flights >= 8) { land(); syncCollectAll(); return; }
    flights++;
    flyNumber(from, pill.target(), spec.amount, () => { flights--; land(); });
    syncCollectAll();
  }

  function flyNumber(
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number,
    done: () => void
  ): void {
    const node = el('div', 'num flyer');
    node.textContent = `+${n(amount)}`;
    hud.append(node);
    // Quadratic bezier with the control point lifted, so the value visibly
    // ARCS to its destination rather than sliding.
    const cx = from.x + (to.x - from.x) * 0.35;
    const cy = Math.min(from.y, to.y) - 90;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      const e = 1 - Math.pow(1 - k, 2);          // ease-out, never linear
      const u = 1 - e;
      const x = u * u * from.x + 2 * u * e * cx + e * e * to.x;
      const y = u * u * from.y + 2 * u * e * cy + e * e * to.y;
      node.style.transform =
        `translate3d(${x}px, ${y}px, 0) translate(-50%,-50%) scale(${(1 - 0.4 * e).toFixed(3)})`;
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
      hud.append(p);
      const angle = (i / 6) * Math.PI * 2 + 0.4;
      const dist = 26 + (i % 3) * 8;
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 320);
        const e = 1 - Math.pow(1 - k, 2);
        p.style.transform =
          `translate3d(${at.x + Math.cos(angle) * dist * e}px, ${at.y + Math.sin(angle) * dist * e + e * e * 26}px, 0)`;
        p.style.opacity = String(1 - k);
        if (k < 1) requestAnimationFrame(step);
        else p.remove();
      };
      requestAnimationFrame(step);
    }
  }

  function syncCollectAll(): void {
    let pending = 0;
    for (const item of world.values()) if (item.bubble) pending++;
    collectAll.hidden = pending < 4;
  }

  /* --- the next-action resolver (§4.8) -----------------------------------
   * Evaluate in order, surface the FIRST hit. If it ever returns nothing the
   * loop is broken and that is a bug — so it logs. */
  function resolveNextAction(): string {
    if (state.builders.free > 0) return 'construir';
    if (state.badges.cofres > 0) return 'cofres';
    if (state.badges.diario > 0) return 'diario';
    if (state.resources.some((r) => r.pressing)) return 'pills';
    if (state.resources.every((r) => r.value < r.cap * 0.2)) return 'zarpar';
    console.warn('[hud] next-action resolver returned nothing — the loop is broken');
    return 'none';
  }

  /* --- render ------------------------------------------------------------ */
  function render(): void {
    levelBadge.firstElementChild!.textContent = String(state.level);
    xp.style.setProperty('--pct', String(Math.max(0, Math.min(1, state.xp / state.xpMax))));

    builderChip.set(state.builders.free, state.builders.total);
    statusChip.set(state.status);

    for (const res of state.resources) {
      const pill = pills.get(res.id);
      if (!pill) continue;
      pill.set(res.value, res.cap);
      pill.setPressing(Boolean(res.pressing));
    }
    gemPill.set(state.gems);

    chests.badge.set(state.badges.cofres);
    log.badge.set(state.badges.diario);
    build.badge.set(state.badges.construir);
    chests.setTimer(state.chestTimerMs);
    sail.setLocked(state.sailLocked);
    tray.set(state.chestSlots);

    const next = resolveNextAction();
    build.setCued(next === 'construir');
    chests.setCued(next === 'cofres');
    log.setCued(next === 'diario');
    sail.setCued(next === 'zarpar');

    hud.classList.toggle('is-left-handed', state.leftHanded);
  }

  function open(what: string): void {
    // Panels are the next slice; until then, name the destination so a tap is
    // never silent and the routes stay verifiable.
    console.log(`[hud] open: ${what}`);
  }

  window.addEventListener('resize', () => {
    viewport = { w: window.innerWidth, h: window.innerHeight };
    for (const item of world.values()) item.size = null;
  });

  render();
  syncCollectAll();

  return {
    root: hud,
    state: () => state,
    setState(patch) {
      Object.assign(state, patch);
      render();
    },
    addWorldItem,
    place,
    tick(elapsed) {
      const ms = elapsed * 1000;
      for (const item of world.values()) {
        if (item.spec.kind !== 'timer' || !item.bar) continue;
        item.bar.set(Math.max(0, item.spec.remainingMs - ms), item.spec.totalMs);
      }
      if (state.chestTimerMs != null) {
        chests.setTimer(Math.max(0, state.chestTimerMs - ms));
      }
      const slots = state.chestSlots.map((s) =>
        s.state === 'unlocking'
          ? { ...s, remainingMs: Math.max(0, s.remainingMs - ms) }
          : s
      );
      tray.set(slots);
    },
  };
}
