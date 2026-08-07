import { el, iconImg, pressable } from './dom';
import { createBadge, type Badge } from './badge';
import { dur } from '../format';

/** §3.5 primary CTA tile · §3.6 utility icon button · §3.7 the featured tile. */

export type TileKind = 'cta' | 'sub' | 'icon' | 'featured';
export type TileFamily = 'orange' | 'grey' | 'grey2' | 'green' | 'gold' | 'red';

export interface TileOptions {
  kind: TileKind;
  family?: TileFamily;
  /** Baked voxel icon. */
  icon?: string;
  /** Baked into the tile — a CTA is never a text pill (§6.13). */
  caption?: string;
  label: string;            // accessible name
  onTap?: () => void;
}

export interface Tile {
  readonly el: HTMLElement;
  readonly badge: Badge;
  /** Mini timer caption, e.g. a chest unlocking on the Cofres tile (§3.7). */
  setTimer(remainingMs: number | null): void;
  /** Locked = the same object in the passive hue plus a padlock. Never dead. */
  setLocked(locked: boolean): void;
  /** The next-action resolver's attention cue (§4.8). */
  setCued(cued: boolean): void;
}

const KIND_CLASS: Record<TileKind, string> = {
  cta: 'tile--cta',
  sub: 'tile--sub',
  icon: 'tile--icon',
  featured: 'tile--cta tile--featured',
};

export function createTile(opts: TileOptions): Tile {
  const family = opts.family ?? 'grey';
  const classes = ['btn', 'tile', KIND_CLASS[opts.kind]];
  if (opts.kind !== 'featured') classes.push(`btn--${family}`);
  if (opts.caption) classes.push('tile--captioned');

  const root = el('button', classes.join(' '));
  root.type = 'button';
  root.setAttribute('aria-label', opts.label);

  const art = iconImg(opts.icon, 'tile__art');
  root.append(art);
  if (opts.caption) root.append(el('span', 't t-caption tile__cap', opts.caption));

  const timer = el('span', 'num tile__timer');
  const badge = createBadge(0);
  root.append(timer, badge.el);

  pressable(root, opts.onTap);

  return {
    el: root,
    badge,
    setTimer(ms) {
      if (ms == null) {
        timer.innerHTML = '';
        root.classList.remove('has-timer');
      } else {
        timer.innerHTML = dur(ms);
        root.classList.add('has-timer');
      }
    },
    setLocked(locked) {
      root.classList.toggle('tile--locked', locked);
    },
    setCued(cued) {
      root.classList.toggle('is-cued', cued);
    },
  };
}
