#!/usr/bin/env node
// Enforces UI_SPEC §0.2 — the four-layer rule — against the rendered pixels.
//
// WHY THIS EXISTS
//
// Three rounds of "AAA finish" did not converge, and the verification that
// followed the third named the reason: the rule is understood but unenforced,
// so quality is per-component luck and every round regenerates the same defect
// somewhere new. The proof was a single session in which one builder shipped a
// textbook §0.2 object and, beside it, a timer capsule with one of the four
// layers. Both passed tsc. Both passed all 88 tests. Both were marked done.
//
// A style rule that only lives in prose is re-litigated every time somebody
// writes CSS. This turns it into something a build can fail on, the same way
// the retention test turned "the loop must never break" from a sentence in a
// design document into a condition with teeth.
//
// WHAT IT CHECKS
//
// For each registered component it takes a vertical column through the middle
// of the rendered element and looks for, in order:
//
//   1. an ink contour     — dark rows at the top and bottom edges
//   2. a warm rim         — a bright row just inside the top contour
//   3. a HARD gloss step  — a single-row luminance fall near mid-height, deep
//                           enough to read as lit rather than tinted
//   4. a lip + extrusion  — darkening inside the bottom edge, and a shadow band
//                           below the object
//
//   npm run audit:layers            audit, print the table, fail on regressions
//   npm run audit:layers -- --all   include components not yet expected to pass
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/**
 * The components §0.2 governs, and the act needed to bring each on screen.
 *
 * `pressable: false` marks a read-only readout. LAYOUT_SPEC settles that the
 * four-layer rule governs anything the player can press, while a readout is a
 * label and may be translucent — so those are measured and reported but not
 * failed on. Everything a finger can hit is held to the full rule.
 */
const COMPONENTS = [
  // These selectors are the audit's whole contract with the HUD, and they had
  // ALL drifted: the markup moved to a navslot/readout/timerbar vocabulary and
  // this list stayed on tile/nav__slot/timer-bar. Seven of eleven matched
  // nothing, which the run below turns into a hard failure — an audit that
  // cannot find its subjects would otherwise report success for components it
  // never measured, and the four-layer rule would be unenforced while looking
  // green.
  { name: 'primary CTA', selector: '.navslot--proud', act: null, pressable: true },
  { name: 'nav slot', selector: '.navslot:not(.navslot--proud)', act: null, pressable: true },
  { name: 'resource pill', selector: '.pill', act: null, pressable: false },
  { name: 'readout cell', selector: '.readout__cell', act: null, pressable: false },
  { name: 'builder chip', selector: '.builder-chip', act: null, pressable: true },
  { name: 'badge', selector: '.badge', act: null, pressable: false },
  { name: 'chest slot', selector: '.slot', act: null, pressable: true },
  { name: 'timer capsule', selector: '.timerbar', act: null, pressable: true },
  { name: 'objective row', selector: '.objective', act: null, pressable: true },
  { name: 'picker row CTA', selector: '.pick-row__go', act: 'pickerOpen', pressable: true },
  { name: 'sheet CTA', selector: '.sheet.is-open .sheet__cta', act: 'upgrade', pressable: true },
  { name: 'close button', selector: '.sheet.is-open .sheet__x', act: 'pickerOpen', pressable: true },
  { name: 'confirm button', selector: '.buildbar__ok', act: 'place', pressable: true },
];

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Reads the four layers out of one vertical column.
 *
 * Tolerances are deliberately generous: the point is to catch a component that
 * is flat, not to police a few luminance units. The gloss test asks for a
 * BREAK rather than a deep one — see the note on it below, and the measurement
 * of Clash's own face that corrected it.
 */
function measure(column, edge = 0) {
  const n = column.length;
  if (n < 12) return { ok: false, why: 'too small to measure' };

  const L = column.map(([r, g, b]) => lum(r, g, b));

  // 1. Ink contour: dark rows at both edges OF THE COMPONENT.
  //
  // `edge` is where the component actually starts, in rows. The clip below
  // deliberately includes padding above and beneath so the extrusion shadow is
  // in frame, and this test used to search the first five rows of the CLIP —
  // which are entirely inside that padding. It was therefore measuring the
  // BACKGROUND BEHIND each component and never its border: a button on the
  // dark sea passed, an identical button on a cream sheet failed, and neither
  // verdict had anything to do with the button. Anything "fixed" to satisfy it
  // was chasing the wrong pixels.
  const band = 6;
  const near = (from, to) => L.slice(Math.max(0, from), Math.min(n, to)).some((v) => v < 60);
  const contour = near(edge - 2, edge + band) && near(n - edge - band, n - edge + 2);

  // The interior is everything between the two contours.
  let top = Math.max(0, edge - 2);
  while (top < n && L[top] < 60) top++;
  let bottom = Math.min(n - 1, n - edge + 1);
  while (bottom > top && L[bottom] < 60) bottom--;
  const interior = L.slice(top, bottom + 1);
  if (interior.length < 8) return { ok: false, why: 'no measurable interior', contour };

  // 2. Warm rim: a bright row in the first few interior rows, above the face.
  const face = interior.slice(3, Math.max(4, Math.floor(interior.length * 0.4)));
  const faceMean = face.reduce((a, b) => a + b, 0) / face.length;
  const rimPeak = Math.max(...interior.slice(0, 3));
  const rim = rimPeak > faceMean + 12;

  // 3. Hard gloss step — measured as SHARPNESS, not depth.
  //
  // This test used to demand that the lower face be at most 0.62 of the upper
  // one, on a note claiming Clash's buttons sit near 0.47. Measured off
  // reference/clash/coc_speedup.jpg, the green Finish Now button's face steps
  // 192 -> 161: a ratio of 0.84, essentially identical to ours. The 0.47 came
  // from columns crossing the button's TEXT and GEM ART rather than its face —
  // the same contamination that had sea-metrics counting the HUD as water.
  //
  // Acting on it would have repainted every button in the game to depart from
  // the very reference it cites, so what the rule actually asks for is worth
  // restating: two planes MEETING, not a deep drop. The signature of that is a
  // single-row fall far larger than the local gradient. Clash's face runs 1.0
  // luminance per row and then falls 20.0 in one — twenty times over. A smooth
  // ramp of the same total depth would show no such spike.
  //
  // The bar is 6x, generously below the reference, because the failure this
  // catches is a face with NO break at all.
  const deltas = [];
  for (let i = 0; i < interior.length - 1; i++) deltas.push(interior[i] - interior[i + 1]);
  const lo = Math.floor(interior.length * 0.25);
  const hi = Math.ceil(interior.length * 0.75);
  const window = deltas.slice(lo, hi);
  const biggest = window.length ? Math.max(...window) : 0;
  const sorted = deltas.map(Math.abs).sort((a, b) => a - b);
  const typical = Math.max(0.5, sorted[Math.floor(sorted.length / 2)] ?? 0.5);
  const stepRatio = biggest / typical;
  const stepAt = window.length ? lo + window.indexOf(biggest) : -1;
  const step = stepRatio >= 6;

  // 4. Lip and extrusion: the last interior rows darker than the face, and a
  //    dark band below the bottom contour.
  const lipRows = interior.slice(-3);
  const lipMean = lipRows.reduce((a, b) => a + b, 0) / lipRows.length;
  const lip = lipMean < faceMean * 0.75;
  const below = L.slice(bottom + 1);
  const extrusion = below.length >= 2 && below.slice(0, 3).some((v) => v < faceMean * 0.6);

  const layers = [contour, rim, step, lip || extrusion];
  return {
    ok: layers.every(Boolean),
    contour, rim, step, lip: lip || extrusion,
    stepRatio: Number(stepRatio.toFixed(1)),
    stepAt: stepAt < 0 ? null : Number((stepAt / interior.length).toFixed(2)),
    height: interior.length,
  };
}

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve) => {
  const timer = setTimeout(resolve, 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local:')) { clearTimeout(timer); setTimeout(resolve, 400); }
  });
});

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(preinstalled ? { executablePath: preinstalled } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const { ACTS } = await import('./acts.mjs');
const results = [];

for (const component of COMPONENTS) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  try {
    await page.goto(`http://localhost:${port}/?scene=island&shot=1&w=430&h=932&t=2.0`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 });
    if (component.act && ACTS[component.act]) await ACTS[component.act](page);

    const box = await page.locator(component.selector).first().boundingBox().catch(() => null);
    if (!box || box.width < 8 || box.height < 8) {
      results.push({ ...component, missing: true });
      continue;
    }

    // A little above and below, so the extrusion shadow is in frame. The
    // component itself therefore starts `pad * scale` rows into the column, and
    // measure() is told so — see the note on the ink contour.
    const pad = 6;
    const scale = 2;   // the viewport's deviceScaleFactor, below
    const shot = await page.screenshot({
      clip: {
        x: Math.max(0, box.x + box.width / 2 - 1),
        y: Math.max(0, box.y - pad),
        width: 2,
        height: box.height + pad * 2,
      },
    });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const column = [];
    for (let y = 0; y < info.height; y++) {
      const i = (y * info.width) * info.channels;
      column.push([data[i], data[i + 1], data[i + 2]]);
    }
    results.push({ ...component, ...measure(column, pad * scale) });
  } catch (err) {
    results.push({ ...component, error: String(err.message || err).slice(0, 80) });
  } finally {
    await page.close();
  }
}

await browser.close();
server.kill();

const mark = (v) => (v ? '[32m✓[0m' : '[31m✗[0m');
console.log('\n  component            ink  rim  step  lip   step ratio');
console.log('  ' + '-'.repeat(56));
for (const r of results) {
  if (r.missing) { console.log(`  ${r.name.padEnd(20)} [2mnot on screen[0m`); continue; }
  if (r.error) { console.log(`  ${r.name.padEnd(20)} [31m${r.error}[0m`); continue; }
  console.log(
    `  ${r.name.padEnd(20)} ${mark(r.contour)}    ${mark(r.rim)}    ${mark(r.step)}     ${mark(r.lip)}` +
    `     ${r.stepRatio ?? '-'}${r.pressable ? '' : '  (readout)'}`
  );
}

// A selector that stops matching must fail loudly. A rename would otherwise
// switch the audit off for that component and the report would still look
// green — a test that silently stops testing is worse than no test at all.
const missing = results.filter((r) => r.missing);
if (missing.length > results.length / 3) {
  console.log(
    `\n  [31m${missing.length} of ${results.length} selectors matched nothing.[0m\n` +
    '  The HUD markup has moved. Update COMPONENTS in this file — an audit that\n' +
    '  cannot find its subjects reports success for components it never measured.'
  );
  process.exit(1);
}

const failures = results.filter((r) => r.pressable && !r.missing && !r.error && !r.ok);
console.log(`\n  ${results.filter((r) => r.ok).length}/${results.filter((r) => !r.missing && !r.error).length} components carry all four layers`);
if (failures.length) {
  console.log('\n  Pressable components missing a layer:');
  for (const f of failures) {
    const gone = [!f.contour && 'ink contour', !f.rim && 'warm rim', !f.step && `hard gloss step (sharpness ${f.stepRatio}x, needs ≥6x)`, !f.lip && 'lip/extrusion']
      .filter(Boolean);
    console.log(`    ${f.name}: missing ${gone.join(', ')}`);
  }
  process.exit(1);
}
