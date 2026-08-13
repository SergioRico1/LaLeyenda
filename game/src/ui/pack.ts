/**
 * Detects whether the optional third-party UI artwork is present.
 *
 * The pack is licensed for use but not redistribution, so it is not in the
 * repository (see tools/ui-assets.mjs). Everything in pack.css hangs off the
 * class this sets, and the HUD is fully correct without it — the artwork is an
 * upgrade to four specific shapes, never a dependency.
 */
const MARKER = 'has-uipack';

let probe: Promise<boolean> | null = null;

export function detectPack(): Promise<boolean> {
  probe ??= fetch('assets/ui/manifest.json', { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((manifest) => {
      const ok = Array.isArray(manifest?.pieces) && manifest.pieces.length > 0;
      document.documentElement.classList.toggle(MARKER, ok);
      return ok;
    })
    .catch(() => {
      document.documentElement.classList.remove(MARKER);
      return false;
    });
  return probe;
}
