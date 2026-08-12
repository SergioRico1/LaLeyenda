#!/usr/bin/env node
// What one real frame of a scene costs, measured on the pixels rather than
// guessed from the source.
//
//   node tools/perf.mjs                          all three scenes §7 budgets
//   node tools/perf.mjs --scene sea              one of them
//   node tools/perf.mjs --scene island --parts terrain
//                                                the island's layer breakdown
//   node tools/perf.mjs --json out.json          the same numbers as JSON
//
// PLAN.md's budget is under 100 draw calls. A count of scene nodes cannot
// answer that — three.js batches nothing by itself and a merged mesh with
// eleven materials is eleven calls — so the only honest figure is taken after
// a frame has actually been drawn.
//
// HOW THE CALLS ARE COUNTED, and why not through renderer.info.
//
// `renderer.info.render.calls` is right, and the island publishes it through
// `window.laLeyenda.stats()`. But only the island publishes it: the sea has no
// such seam, and a tool that can only measure the scene that volunteers is a
// tool that never measures the scene with the problem. So this wraps the WebGL
// context itself — every drawElements, drawArrays and their instanced forms, on
// both the WebGL and WebGL2 prototypes — before any page script runs. That
// counts what the driver was asked for, shadow pass included, in any scene,
// with no cooperation from the scene at all. Where both numbers exist they are
// printed together and they agree; round 11 established that they do.
//
// FRAME TIME, AND WHAT THIS CONTAINER CANNOT TELL YOU.
//
// This renders through SwiftShader, a CPU rasteriser. Its milliseconds describe
// a data-centre CPU pretending to be a GPU and say NOTHING about a phone —
// **60 fps on a mid-range device cannot be measured here and this tool does not
// claim to.** What it does measure is the part that is not the GPU's: the
// JavaScript the game runs per frame, the heap it churns per frame, and the
// counts (calls, triangles, programs) that are properties of the scene rather
// than of the renderer underneath it. Those transfer. A phone's GPU is faster
// than SwiftShader; its CPU is several times SLOWER than this one, so a
// JavaScript cost that looks small here is not automatically small there — it
// is a floor, and it is reported as a floor.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

/** PLAN.md / PRODUCTION.md §7. */
const BUDGET = 100;

/**
 * The three frames §7 has to hold, and what each one is for.
 *
 * `island day one` is what a new player meets — one building on an empty
 * island. `island demo` is the same scene eleven buildings later, which is the
 * state the budget has always failed in. `sea` is the other half of the game
 * and the second frame a store listing shows.
 */
const SCENES = [
  { key: 'island', label: 'island day one', query: 'screen=island' },
  { key: 'demo', label: 'island demo', query: 'screen=island&save=demo' },
  { key: 'sea', label: 'sea', query: 'screen=sea' },
];

// An unknown flag is an ERROR, never a shrug.
//
// This is the fourth time this project has been bitten by a harness that
// accepted a flag it did not implement: `--save demo` was silently dropped for
// nine rounds and every capture in that window was of the wrong island, and
// `?hud=0` was read by one scene and ignored by the other for thirteen. The old
// version of this file forwarded ANY `--x y` straight into the query string,
// which meant a typo produced a confident number about a scene nobody asked
// for. Naming the flags costs six lines and closes the whole family.
const KNOWN = new Set(['--scene', '--parts', '--json', '--calls-only', '--by-material']);
const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
if (unknown.length) {
  console.error(`unknown flag: ${unknown.join(', ')}\n  known: ${[...KNOWN].join(' ')}`);
  process.exit(2);
}

const only = flag('scene');
const parts = flag('parts');
const callsOnly = argv.includes('--calls-only');
const byProgram = argv.includes('--by-material');
const chosen = only ? SCENES.filter((s) => s.key === only || s.label === only) : SCENES;
if (!chosen.length) {
  console.error(`unknown scene "${only}" — one of: ${SCENES.map((s) => s.key).join(', ')}`);
  process.exit(1);
}

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('ready in') || String(d).includes('Local:')) {
      clearTimeout(timer);
      setTimeout(() => resolve(true), 400);
    }
  });
});
if (!ready) { server.kill(); console.error('vite failed to start'); process.exit(1); }

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(preinstalled ? { executablePath: preinstalled } : {}),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    // Lets the page read its own heap, which is how the per-frame allocation
    // figure below is taken. Without it performance.memory is absent and the
    // measurement reports itself unavailable rather than guessing.
    '--enable-precise-memory-info',
  ],
});

/**
 * The GL counter, installed before a single line of page script runs.
 *
 * It has to be an init script rather than an evaluate: three.js takes its
 * context in the Stage constructor, and anything patched after that point is
 * patched on a prototype the renderer has already resolved its methods from in
 * some engines. Wrapping the prototype up front is the version that cannot
 * race the scene.
 */
const COUNTER = `
  (() => {
    const counts = { calls: 0, elements: 0, arrays: 0, instanced: 0, vertices: 0 };
    globalThis.__gl = counts;
    // Every draw* signature in WebGL 1 and 2 puts the vertex/index count in
    // argument 1; only the instanced forms carry a multiplier, and it is the
    // last argument in both of them. Counting vertices as well as calls is what
    // gives the sea a triangle figure — it publishes no renderer.info seam, and
    // a scene with no triangle count is a scene nobody can compare.
    const wrap = (proto, name, kind, instArg) => {
      if (!proto || !proto[name]) return;
      const original = proto[name];
      proto[name] = function (...args) {
        counts.calls++;
        counts[kind]++;
        const n = typeof args[1] === 'number' ? args[1] : 0;
        const instances = instArg !== undefined && typeof args[instArg] === 'number' ? args[instArg] : 1;
        counts.vertices += n * instances;
        return original.apply(this, args);
      };
    };
    for (const Ctx of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      if (!Ctx) continue;
      wrap(Ctx.prototype, 'drawElements', 'elements');
      wrap(Ctx.prototype, 'drawArrays', 'arrays');
      wrap(Ctx.prototype, 'drawElementsInstanced', 'instanced', 4);
      wrap(Ctx.prototype, 'drawArraysInstanced', 'instanced', 3);
      wrap(Ctx.prototype, 'drawRangeElements', 'elements');
    }
    globalThis.__glReset = () => { for (const k of Object.keys(counts)) counts[k] = 0; };

    // WHERE the calls go, without asking the scene anything.
    //
    // Every draw runs under a bound program, and three.js stamps each program
    // it compiles with "#define SHADER_NAME <material.name or material.type>".
    // Reading the bound program at draw time and the name out of its vertex
    // shader afterwards therefore gives a histogram of draw calls by material,
    // for any scene, including the one that publishes no seam at all.
    //
    // Off unless asked for: getParameter is a synchronous GL query and putting
    // one inside the hot path would corrupt the frame timings next door.
    let programCounts = null;
    let lastCtx = null;
    globalThis.__glByProgram = (on) => {
      programCounts = on ? new Map() : null;
      if (on) counts.byProgram = programCounts;
    };
    const originalCount = (proto, name) => proto && proto[name];
    for (const Ctx of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      if (!Ctx || !Ctx.prototype.drawElements) continue;
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
        const wrapped = originalCount(Ctx.prototype, name);
        if (!wrapped) continue;
        Ctx.prototype[name] = function (...args) {
          if (programCounts) {
            lastCtx = this;
            const p = this.getParameter(this.CURRENT_PROGRAM);
            programCounts.set(p, (programCounts.get(p) ?? 0) + 1);
          }
          return wrapped.apply(this, args);
        };
      }
    }
    globalThis.__glPrograms = () => {
      if (!programCounts || !lastCtx) return [];
      const gl = lastCtx;
      const rows = [];
      for (const [program, n] of programCounts) {
        // SHADER_TYPE is material.type and is always set; SHADER_NAME is
        // material.name and is usually empty, so it refines rather than
        // identifies. DEPTH_PACKING marks the shadow pass, USE_INSTANCING the
        // batched geometry — between them a row says what kind of work it is.
        let type = 'unknown', label = '', shadow = false, instanced = false;
        try {
          for (const sh of gl.getAttachedShaders(program) ?? []) {
            const src = gl.getShaderSource(sh) ?? '';
            const t = src.match(/#define SHADER_TYPE (.+)/);
            const nm = src.match(/#define SHADER_NAME (.+)/);
            if (t && t[1].trim()) type = t[1].trim();
            if (nm && nm[1].trim()) label = nm[1].trim();
            if (/#define DEPTH_PACKING/.test(src)) shadow = true;
            if (/#define USE_INSTANCING\b/.test(src)) instanced = true;
          }
        } catch { /* a program can be gone by the time we ask */ }
        // Concatenation, not a template literal: this whole block lives inside
        // one on the Node side, and a nested backtick ends it early.
        const name = type + (label ? ' "' + label + '"' : '') +
          (instanced ? ' [instanced]' : '') + (shadow ? ' [shadow pass]' : '');
        rows.push({ name, calls: n });
      }
      // Same material drawn by several programs (shadow pass, depth pass) folds
      // into one row: the reader wants "the buildings", not "the permutations".
      const merged = new Map();
      for (const r of rows) merged.set(r.name, (merged.get(r.name) ?? 0) + r.calls);
      return [...merged].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls);
    };
  })();
`;

const results = [];
let exitCode = 0;

try {
  for (const scene of chosen) {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
    await context.addInitScript(COUNTER);
    const page = await context.newPage();

    const url = `http://localhost:${port}/?${scene.query}&shot=1&w=430&h=932&t=2.0` +
      (parts ? `&parts=${encodeURIComponent(parts)}` : '');
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 180000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(`${scene.label}: ${err}`);

    // ONE frame, counted clean. Boot draws several — the shadow map is built,
    // the veil fades, freeze() renders twice — so the counter is zeroed and
    // exactly one step is asked for. Anything else measures the boot, not the
    // frame a player is looking at.
    const draw = await page.evaluate(() => {
      window.__glReset();
      window.__step(1);
      return { ...window.__gl };
    });

    // The island's own figure, where it exists, as a cross-check on the wrapper.
    const info = await page.evaluate(() =>
      (window.laLeyenda && window.laLeyenda.stats) ? window.laLeyenda.stats() : null);

    // Where those calls went, by material. One extra frame, instrumented.
    const programs = byProgram ? await page.evaluate(() => {
      window.__glByProgram(true);
      window.__step(1);
      const rows = window.__glPrograms();
      window.__glByProgram(false);
      return rows;
    }) : null;

    /**
     * The two halves of a frame, separated as far as this container allows.
     *
     * `queued` is the game's own per-frame JavaScript plus the driver's command
     * translation, timed without draining the pipeline: the animation mixers,
     * the water uniforms, the sim tick, the projections, three.js walking its
     * render list. CPU work, and it transfers to a phone — upward, because
     * phone CPUs are slower than this one.
     *
     * `whole` is the same frames with a readPixels at both ends, which blocks
     * until the queue is empty. `whole - queued` is therefore what SwiftShader
     * spent rasterising. On a phone that is the GPU's job and the number means
     * NOTHING. It is reported anyway because its ratio between two runs prices
     * a layer — that is what `--parts` is for.
     *
     * `--calls-only` skips all of it, which is most of the runtime: these
     * windows drain a CPU rasteriser thirty frames at a time and the heap
     * sampling below does it seven times over. A sweep across `--parts` wants
     * the call counts and nothing else, and wants them in seconds.
     */
    const timing = callsOnly ? null : await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

      window.__step(8); sync();                       // warm caches and programs

      const N = 30;
      // Whole frames, GPU drained at both ends.
      sync();
      const t0 = performance.now();
      window.__step(N);
      sync();
      const whole = (performance.now() - t0) / N;

      // The same frames without draining: the JS returns as soon as the
      // commands are queued, so what is left is our own work plus the driver's
      // command translation. The difference against `whole` is the rasteriser.
      sync();
      const t1 = performance.now();
      window.__step(N);
      const queued = (performance.now() - t1) / N;

      // Heap churn per frame. A phone collects a nursery this size in a visible
      // hitch, so per-frame allocation is a real defect even when the frame
      // itself is fast — and it is one of the few pathologies a CPU rasteriser
      // reports faithfully, because allocation is the same JavaScript either
      // way. Absent without --enable-precise-memory-info.
      //
      // Taken as the MEDIAN of several windows rather than one: a collection
      // inside a window shows up as a fall, and a single sample that happens to
      // land on one reports "no allocation at all" for a scene that is churning
      // megabytes. Windows that fell are dropped, not clamped to zero.
      let heap = null;
      if (performance.memory) {
        const samples = [];
        for (let i = 0; i < 7; i++) {
          sync();
          const before = performance.memory.usedJSHeapSize;
          window.__step(N);
          sync();
          const after = performance.memory.usedJSHeapSize;
          if (after > before) samples.push((after - before) / N);
        }
        if (samples.length) {
          samples.sort((a, b) => a - b);
          heap = { median: samples[samples.length >> 1], lo: samples[0], hi: samples[samples.length - 1], n: samples.length };
        }
      }
      return { whole, queued, heap };
    });

    results.push({ ...scene, draw, info, programs, timing });
    await context.close();
  }
} catch (e) {
  console.error(String(e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

if (!results.length) process.exit(exitCode || 1);

/* -------------------------------------------------------------------------
 * The report.
 * ---------------------------------------------------------------------- */

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log(`DRAW CALLS — budget ${BUDGET}${parts ? `  (parts=${parts})` : ''}\n`);
console.log(`  ${pad('scene', 18)}${lpad('GL calls', 10)}${lpad('info.calls', 12)}${lpad('triangles', 12)}${lpad('programs', 10)}${lpad('over', 8)}`);
console.log(`  ${'-'.repeat(70)}`);
for (const r of results) {
  const over = r.draw.calls - BUDGET;
  // Triangles from the counter's own vertex tally, so the sea gets a figure
  // too. Where three.js also reports one the two agree to within the handful
  // of non-triangle primitives a scene draws.
  const tris = Math.round(r.draw.vertices / 3);
  console.log(
    `  ${pad(r.label, 18)}${lpad(r.draw.calls, 10)}${lpad(r.info ? r.info.calls : '—', 12)}` +
    `${lpad(tris.toLocaleString('en-US'), 12)}${lpad(r.info ? r.info.programs : '—', 10)}` +
    `${lpad(over > 0 ? `+${over}` : 'OK', 8)}`
  );
}
console.log('\n  GL calls: every draw* the driver was asked for, shadow pass included.');
console.log('  info.calls: three.js\'s own count, published by the island only. They agree.');
console.log('  triangles: from the counter\'s own vertex tally, so the sea has one at all.');

if (byProgram) {
  console.log('\nWHERE THE CALLS GO, by material\n');
  for (const r of results) {
    if (!r.programs || !r.programs.length) continue;
    const total = r.programs.reduce((a, p) => a + p.calls, 0);
    console.log(`  ${r.label} — ${total} calls`);
    for (const p of r.programs) {
      const share = ((p.calls / total) * 100).toFixed(0);
      console.log(`    ${lpad(p.calls, 6)}  ${lpad(share + '%', 5)}  ${p.name}`);
    }
    console.log('');
  }
  console.log('  Names come from three.js\'s own SHADER_NAME define, so a row is a');
  console.log('  material, not a mesh. Shadow and depth permutations are folded in.');
}

if (callsOnly) {
  const worstQ = results.reduce((a, r) => (r.draw.calls > a.draw.calls ? r : a));
  console.log(`\nworst: ${worstQ.label} at ${worstQ.draw.calls} / ${BUDGET}`);
  if (flag('json')) {
    fs.writeFileSync(flag('json'), JSON.stringify({ measured: new Date().toISOString(), budget: BUDGET, parts, results }, null, 2) + '\n');
  }
  process.exit(worstQ.draw.calls > BUDGET ? 1 : exitCode);
}

console.log('\nFRAME COST — SwiftShader. NOT a phone. See the header of this file.\n');
console.log(`  ${pad('scene', 18)}${lpad('js+queue ms', 13)}${lpad('whole ms', 11)}${lpad('rasteriser', 12)}${lpad('heap/frame KB', 22)}`);
console.log(`  ${'-'.repeat(76)}`);
for (const r of results) {
  const t = r.timing;
  const raster = t.whole - t.queued;
  // Heap as median and range across the windows. One number here would be a
  // lie by precision: the collector fires when it likes, and two windows of the
  // same scene can differ threefold. The range is the measurement.
  const h = t.heap
    ? `${(t.heap.median / 1024).toFixed(0)} (${(t.heap.lo / 1024).toFixed(0)}-${(t.heap.hi / 1024).toFixed(0)}, n=${t.heap.n})`
    : '—';
  console.log(
    `  ${pad(r.label, 18)}${lpad(t.queued.toFixed(2), 13)}${lpad(t.whole.toFixed(2), 11)}` +
    `${lpad(raster.toFixed(2) + ' ms', 12)}${lpad(h, 22)}`
  );
}
console.log('\n  js+queue is OUR JavaScript plus command translation — CPU work that');
console.log('  transfers to a phone, upward, because phone CPUs are slower than this one.');
console.log('  rasteriser is SwiftShader doing a GPU\'s job on a CPU. It transfers to');
console.log('  NOTHING. 60 fps on a mid-range device remains unverified and unverifiable here.');

/* -------------------------------------------------------------------------
 * What a draw call costs the CPU.
 *
 * `js+queue` above is two things added together and the split matters: one is
 * fixed per frame (the mixers, the water uniforms, the sim tick) and one is
 * paid per draw call (three.js walking its render list, binding, uploading
 * uniforms, and the driver translating each command). Three scenes at three
 * very different call counts are three points on that line, so the split can be
 * SOLVED rather than assumed.
 *
 * This is a fit, not a measurement, and it is printed as one — with the residual
 * against every point, so a reader can see whether the line actually holds
 * before believing what it implies.
 * ---------------------------------------------------------------------- */
if (results.length >= 2) {
  const xs = results.map((r) => r.draw.calls);
  const ys = results.map((r) => r.timing.queued);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const perCall = sxx > 0 ? sxy / sxx : 0;
  const fixed = my - perCall * mx;

  console.log('\n  CPU per frame, split by least squares over the three scenes above:');
  console.log(`    fixed cost        ${fixed.toFixed(2)} ms/frame  (our update: mixers, water, sim tick)`);
  console.log(`    per draw call     ${(perCall * 1000).toFixed(1)} us         (render list + bind + uniforms + driver)`);
  for (const r of results) {
    const predicted = fixed + perCall * r.draw.calls;
    console.log(`    ${pad(r.label, 18)}predicted ${predicted.toFixed(2)} ms, measured ${r.timing.queued.toFixed(2)} ms` +
      `  (${(r.timing.queued - predicted >= 0 ? '+' : '') + (r.timing.queued - predicted).toFixed(2)})`);
  }
  console.log('\n  This is the arithmetic behind the 100-call budget: the calls are CPU');
  console.log('  cost before they are GPU cost, and CPU is where a mid-range phone is weak.');
}

if (flag('json')) {
  fs.writeFileSync(flag('json'), JSON.stringify({ measured: new Date().toISOString(), budget: BUDGET, parts, results }, null, 2) + '\n');
  console.log(`\njson → ${flag('json')}`);
}

const worst = results.reduce((a, r) => (r.draw.calls > a.draw.calls ? r : a));
console.log(`\n${'='.repeat(72)}`);
console.log(`worst scene: ${worst.label} at ${worst.draw.calls} draw calls / ${BUDGET} — ${worst.draw.calls <= BUDGET ? 'OK' : 'OVER BUDGET'}`);
if (worst.draw.calls > BUDGET) exitCode = 1;
process.exit(exitCode);
