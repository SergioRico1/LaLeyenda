import { el } from './components/dom';
import { n } from './format';
import { FROZEN, REDUCED } from './env';
import { sfx } from './sfx';

/**
 * celebrate.ts — the payoff layer (§3.11, §3.22, §5).
 *
 * The interface acknowledged input everywhere and rewarded it nowhere: the sim
 * emitted work-finished / chest-ready / level-up / chest-opened and the scene
 * threw every one of them away, so `--z-celebrate` and `--z-toast` had never
 * had a single element mounted in them. This is the layer those events now fan
 * out into.
 *
 * Three rules from §5 shape everything below:
 *   · nothing fades IN — things arrive by scaling with an overshoot (law 1);
 *   · one thing moves at a time — reveals are SEQUENCED, never simultaneous,
 *     because the tension between tiles is where the payoff lives (law 5);
 *   · reduced motion keeps every state change and every sound and drops only
 *     the travel — so the reward still HAPPENS, it just arrives already there.
 */

export interface RewardItem {
  icon?: string;
  amount: number;
  label: string;
}

export interface Celebrate {
  readonly el: HTMLElement;
  /** §3.11's white flash, at a point in screen space. */
  flash(x: number, y: number, size?: number): void;
  /** §3.11's expanding dust ring. */
  dust(x: number, y: number, size?: number): void;
  /** §3.22's radial rays. */
  rays(x: number, y: number, size?: number): void;
  /** §3.22's 6px screen shake. Dropped entirely under reduced motion (§5). */
  shake(px?: number): void;
  /**
   * §3.22B — the chest reveal. No panel, no card (§6.12): a scrim, a ribbon,
   * and tiles dealt 220ms apart, each a semitone higher than the last.
   * Resolves when the player dismisses it.
   */
  reward(opts: { title: string; label: string; items: RewardItem[]; cta: string }): Promise<void>;
}

export function createCelebrate(): Celebrate {
  const root = el('div', 'layer-celebrate');

  /** One-shot effect nodes remove themselves; nothing here ever accumulates. */
  function effect(className: string, x: number, y: number, size: number, ms: number): void {
    if (FROZEN) return;
    const node = el('i', className);
    node.style.width = `${size}px`;
    node.style.height = `${size}px`;
    node.style.transform = `translate(${x}px, ${y}px)`;
    // The animation itself carries translate(-50%,-50%), so the wrapper's
    // transform would fight it. Position with left/top instead: these nodes are
    // created once and never move, so there is no per-frame layout cost.
    node.style.transform = '';
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    root.append(node);
    window.setTimeout(() => node.remove(), ms + 60);
  }

  const api: Celebrate = {
    el: root,

    flash(x, y, size = 150) { effect('fx-flash', x, y, size, 320); },
    dust(x, y, size = 180) { effect('fx-dust', x, y, size, 480); },
    rays(x, y, size = 320) { effect('fx-rays', x, y, size, 620); },

    shake(px = 6) {
      // §5: drop the screen shake entirely under reduced motion.
      if (FROZEN) return;
      const app = document.getElementById('app');
      if (!app) return;
      app.style.setProperty('--sx', `${px}px`);
      app.classList.remove('is-shaking');
      void app.offsetWidth;
      app.classList.add('is-shaking');
      window.setTimeout(() => app.classList.remove('is-shaking'), 300);
    },

    reward({ title, label, items, cta }) {
      return new Promise<void>((resolve) => {
        const grid = el('div', 'reward__grid');
        grid.style.setProperty('--cols', String(items.length === 4 ? 2 : Math.min(3, items.length)));
        const button = el('button', 'btn btn--green reward__cta tap',
          el('span', 't t-btn', cta));
        button.type = 'button';
        button.hidden = true;

        const panel = el('div', 'reward',
          el('div', 'reward__banner', el('h2', 't reward__title', title)),
          el('div', 't reward__label', label),
          grid,
          button);
        root.append(panel);

        sfx('chestBurst');
        navigator.vibrate?.(20);
        api.shake(6);
        const box = panel.getBoundingClientRect();
        api.rays(box.width / 2, box.height * 0.42, Math.max(box.width, 320));
        api.flash(box.width / 2, box.height * 0.42, 260);

        const tiles = items.map((item) => {
          const tile = el('div', 'reward__tile');
          const art = document.createElement('img');
          art.alt = '';
          art.decoding = 'sync';
          if (item.icon) art.src = item.icon;
          tile.append(art, el('span', 'num reward__n', n(item.amount)));
          tile.setAttribute('aria-label', `${item.amount} ${item.label}`);
          grid.append(tile);
          return tile;
        });

        let landed = 0;
        const finish = () => {
          // §3.22: "tap anywhere = skip to the end; the rest land at once.
          // NEVER block the player."
          for (const tile of tiles) tile.classList.add('is-in');
          landed = tiles.length;
          button.hidden = false;
        };

        // One thing moves at a time (§5.5): 220ms apart, a semitone higher
        // each time. Reduced motion lands them together — the reward still
        // happens, it just does not travel.
        if (FROZEN) {
          for (const tile of tiles) tile.style.transform = 'none';
          button.hidden = false;
          landed = tiles.length;
          if (REDUCED) for (let i = 0; i < tiles.length; i++) sfx('reward', i);
        } else {
          tiles.forEach((tile, i) => {
            window.setTimeout(() => {
              if (landed >= tiles.length) return;
              tile.classList.add('is-in');
              const rect = tile.getBoundingClientRect();
              const host = panel.getBoundingClientRect();
              api.flash(rect.left + rect.width / 2 - host.left, rect.top + rect.height / 2 - host.top, 120);
              sfx('reward', i);
              if (++landed === tiles.length) button.hidden = false;
            }, 220 * i + 260);
          });
        }

        const close = () => {
          if (landed < tiles.length) { finish(); return; }
          sfx('press');
          panel.remove();
          resolve();
        };
        panel.addEventListener('pointerdown', close);
        button.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      });
    },
  };

  return api;
}
