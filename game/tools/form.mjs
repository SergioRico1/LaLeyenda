#!/usr/bin/env node
// DOES FORM TURN? — the measurement behind round 14's scoreboard.
//
// The blind verdict that picked the shipped game over ours named one cause:
// *"FORM DOES NOT TURN. Surfaces facing different directions are rendered at
// the same value. Eight luma between two roof planes that should be thirty to
// forty apart."* That is a claim about pixels grouped by SURFACE, and eyeballing
// a sample box onto a roof plane is exactly how a previous round measured the
// wrong plane and believed itself.
//
// So this renders the same frame three times and lines the three up per pixel:
//
//   COLOUR   the frame as shipped — tone curve, sRGB, shadows, everything.
//   ID       every top-level scene child in a flat unique colour, so a pixel
//            can be attributed to the pagoda rather than to the tree in front
//            of it.
//   NORMAL   view-space normals from three's own vertex path (so instancing and
//            skinning come along), rotated into world on the CPU with the
//            camera's own matrix.
//
// Then, per named object, it clusters that object's pixels by world normal and
// reports the median luma of each cluster. A "roof plane" stops being a box a
// human drew and becomes every pixel whose surface points that way.
//
//   node tools/form.mjs                       the demo island at 1280x720
//   node tools/form.mjs --graph               dump the scene graph and stop
//   node tools/form.mjs --casters             what casts a visible shadow
//
// The caster census is the other half of the verdict (*"the flagpole casts
// nothing, the entire pier casts nothing, the PAGODA casts nothing"*) and it is
// measured the only way that cannot lie: turn one object's castShadow off,
// render again, and count the pixels that changed. A shadow nobody can see does
// not count, which is the point the verdict was making.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const W = Number(flag('w', 1280));
const H = Number(flag('h', 720));
const SAVE = flag('save', 'demo');

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error: ' + e));
  const url = `http://localhost:${port}/?screen=island&shot=1&w=${W}&h=${H}&t=2.0` +
    `&seed=la-leyenda&save=${SAVE}&hud=0`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);

  if (flag('isolate', null)) {
    // Everything but one object hidden, so a claim about which pixels belong to
    // which building is settled by looking rather than by a centroid.
    const name = flag('isolate', null);
    await page.evaluate((n) => {
      for (const child of window.__stage.scene.children) {
        if (child.isLight) continue;
        if (child.name !== n) child.visible = false;
      }
      window.__stage.render();
    }, name);
    const out = flag('out', `shots/isolate_${name}.png`);
    await page.screenshot({ path: path.join(ROOT, out) });
    console.log(out);
  } else if (has('graph')) {
    const graph = await page.evaluate(() => {
      const out = [];
      for (const child of window.__stage.scene.children) {
        let meshes = 0, casters = 0;
        child.traverse?.((n) => { if (n.isMesh) { meshes++; if (n.castShadow) casters++; } });
        out.push({ name: child.name || '(unnamed)', type: child.type, meshes, casters });
      }
      return out;
    });
    for (const g of graph) {
      console.log(`${(g.name || '').padEnd(28)} ${g.type.padEnd(16)} meshes=${String(g.meshes).padStart(4)} casts=${String(g.casters).padStart(4)}`);
    }
  } else if (has('casters')) {
    const rows = await page.evaluate(async () => {
      const stage = window.__stage;
      const canvas = stage.renderer.domElement;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const w = canvas.width, h = canvas.height;
      const shot = () => {
        stage.render();
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const base = shot();
      const diff = (a, b) => {
        let n = 0, sum = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d > 6) { n++; sum += d; }
        }
        return { px: n, mean: n ? sum / n : 0 };
      };

      // The candidates the verdict named, plus a control. Matched on the node's
      // own name and on the model kind the scatter instances it under, because
      // the decor is InstancedMesh per kind and a flagpole has no node of its own.
      // On the demo save bldg_2 is the pagoda (the tallest thing in frame) and
      // bldg_9 is the Muelle with its pier — the two the verdict said cast
      // nothing. Both are enumerated below with every other building, so they
      // are not listed twice here; the ids are save-dependent and a hand-written
      // one would go quietly wrong the day the demo island is re-laid.
      const targets = [
        ['sun (all shadows)', () => [stage.sun]],
        ['flags (deco_flag)', () => {
          const out = [];
          stage.scene.traverse((n) => { if (n.isMesh && /flag/i.test(n.name)) out.push(n); });
          return out;
        }],
      ];
      // Every building, one at a time.
      for (const c of stage.scene.children) {
        if (/^bldg_/.test(c.name)) targets.push([c.name, () => [c]]);
      }

      const rows = [];
      for (const [name, pick] of targets) {
        const nodes = pick();
        if (!nodes.length) { rows.push({ name, found: 0, px: 0, mean: 0 }); continue; }
        const saved = [];
        for (const n of nodes) {
          if (n.isLight) { saved.push([n, n.castShadow]); n.castShadow = false; }
          else n.traverse((m) => { if (m.isMesh && m.castShadow) { saved.push([m, true]); m.castShadow = false; } });
        }
        const off = shot();
        for (const [n, v] of saved) n.castShadow = v;
        const d = diff(base, off);
        rows.push({ name, found: saved.length, px: d.px, mean: +d.mean.toFixed(1) });
      }
      return rows;
    });
    console.log('what casts a shadow this frame — pixels that change when it stops casting\n');
    for (const r of rows) {
      console.log(`${r.name.padEnd(22)} meshes=${String(r.found).padStart(4)}  changed=${String(r.px).padStart(7)} px  mean d=${String(r.mean).padStart(6)}`);
    }
  } else {
    if (has('albedo')) {
      await page.goto(page.url() + '&albedo=1', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 });
    }
    const result = await page.evaluate(async () => {
      const stage = window.__stage;
      const THREE = window.__THREE;
      const canvas = stage.renderer.domElement;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const w = canvas.width, h = canvas.height;

      const read = () => {
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };

      stage.render();
      let colour = read();

      // --albedo re-reads the frame with every material replaced by an UNLIT
      // copy of itself (same map, same colour, tone mapping off). What comes
      // back is what the models are MADE of, with the lighting taken away — the
      // only way to tell "this plane is badly lit" from "this plane is painted
      // dark", and the two want opposite fixes.
      const albedoPass = new URLSearchParams(location.search).get('albedo') === '1';
      if (albedoPass) {
        const unlit = [];
        stage.scene.traverse((n) => {
          if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
          const m = n.material;
          if (!m.color) return;
          const flat = new THREE.MeshBasicMaterial({
            color: m.color.clone(), map: m.map ?? null,
            // The terrain carries its whole palette in a vertex attribute and
            // nothing else — drop this and the ground comes back pure white,
            // which is how the first run of this read the sand.
            vertexColors: m.vertexColors === true,
            transparent: m.transparent, alphaTest: m.alphaTest, side: m.side,
          });
          flat.toneMapped = false;
          unlit.push([n, m]);
          n.material = flat;
        });
        stage.render();
        colour = read();
        for (const [n, m] of unlit) n.material = m;
      }

      // --- the two probe materials ---------------------------------------
      const idMat = (hex) => new THREE.ShaderMaterial({
        uniforms: { uId: { value: new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace) } },
        vertexShader: [
          '#include <common>',
          'void main() {',
          '#include <begin_vertex>',
          '#include <project_vertex>',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uId;',
          'void main() { gl_FragColor = vec4(uId, 1.0); }',
        ].join('\n'),
      });
      const normalMat = new THREE.ShaderMaterial({
        vertexShader: [
          '#include <common>',
          'varying vec3 vN;',
          'void main() {',
          '#include <beginnormal_vertex>',
          '#include <defaultnormal_vertex>',
          '  vN = normalize(transformedNormal);',
          '#include <begin_vertex>',
          '#include <project_vertex>',
          '}',
        ].join('\n'),
        fragmentShader: [
          'varying vec3 vN;',
          'void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }',
        ].join('\n'),
        side: THREE.DoubleSide,
      });

      // Ids: one per top-level scene child that owns geometry. 8 bits a channel
      // and under 300 objects, so a plain index in the red channel is unique and
      // exact — no packing, no rounding.
      const owners = [];
      for (const child of stage.scene.children) {
        let any = false;
        child.traverse?.((n) => { if (n.isMesh) any = true; });
        if (any) owners.push(child);
      }
      const swapped = [];
      owners.forEach((child, i) => {
        const mat = idMat(((i + 1) << 16));
        child.traverse((n) => {
          if (!n.isMesh) return;
          swapped.push([n, n.material, n.visible]);
          n.material = mat;
        });
      });
      const savedTone = stage.renderer.toneMapping;
      const savedSpace = stage.renderer.outputColorSpace;
      stage.renderer.toneMapping = THREE.NoToneMapping;
      stage.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      stage.render();
      const ids = read();

      for (const [n] of swapped) n.material = normalMat;
      stage.render();
      const normals = read();

      for (const [n, m] of swapped) n.material = m;
      stage.renderer.toneMapping = savedTone;
      stage.renderer.outputColorSpace = savedSpace;
      stage.render();

      // --- world normals, and the clustering ------------------------------
      const e = stage.camera.matrixWorld.elements;
      const toWorld = (x, y, z) => [
        e[0] * x + e[4] * y + e[8] * z,
        e[1] * x + e[5] * y + e[9] * z,
        e[2] * x + e[6] * y + e[10] * z,
      ];
      const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

      const byOwner = new Map();
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        const id = ids[o];                   // red channel carries (i+1)
        if (!id || id > owners.length) continue;
        const nx = normals[o] / 127.5 - 1, ny = normals[o + 1] / 127.5 - 1, nz = normals[o + 2] / 127.5 - 1;
        const len = Math.hypot(nx, ny, nz);
        // Antialiasing blends normals across a silhouette, and a blended normal
        // belongs to neither surface. Two things reject them: a averaged normal
        // is short, and an edge pixel has a neighbour with another owner.
        if (len < 0.93) continue;
        const x = i % w, y = (i / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
        if (ids[o - 4] !== id || ids[o + 4] !== id
            || ids[o - w * 4] !== id || ids[o + w * 4] !== id) continue;
        const wn = toWorld(nx / len, ny / len, nz / len);
        const name = owners[id - 1].name || `child_${id - 1}`;
        if (!byOwner.has(name)) byOwner.set(name, []);
        // readPixels is bottom-up; y is flipped back so the centroid can be
        // read against a screenshot without a second conversion in the head.
        byOwner.get(name).push([wn, luma(colour[o], colour[o + 1], colour[o + 2]),
          colour[o], colour[o + 1], colour[o + 2], i % w, h - 1 - Math.floor(i / w)]);
      }

      const out = [];
      for (const [name, px] of byOwner) {
        if (px.length < 200) continue;
        // Greedy clustering on the normal: a new cluster whenever a sample is
        // more than ~25 degrees off every seed so far. Voxel art has a handful
        // of exact face normals, so this is not a judgement call — it separates
        // (0,1,0) from (0,0,1) and never splits one plane in two.
        const seeds = [];
        for (const [n, L, r, g, b] of px) {
          let hit = null;
          for (const s of seeds) {
            if (s.n[0] * n[0] + s.n[1] * n[1] + s.n[2] * n[2] > 0.906) { hit = s; break; }
          }
          if (!hit) { hit = { n, sum: [0, 0, 0], L: [], rgb: [0, 0, 0] }; seeds.push(hit); }
          hit.L.push(L);
          hit.sum[0] += n[0]; hit.sum[1] += n[1]; hit.sum[2] += n[2];
          hit.rgb[0] += r; hit.rgb[1] += g; hit.rgb[2] += b;
        }
        const planes = seeds
          .filter((s) => s.L.length >= 60)
          .map((s) => {
            const sorted = s.L.slice().sort((a, b) => a - b);
            // The cluster's MEAN normal, not its seed. The seed is whichever
            // pixel arrived first and can be an antialiased edge, which once
            // labelled a plateau of flat ground (0.32, 0.95, 0).
            const ln = Math.hypot(s.sum[0], s.sum[1], s.sum[2]) || 1;
            return {
              n: s.sum.map((v) => +(v / ln).toFixed(2)),
              px: s.L.length,
              L: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
              r: Math.round(s.rgb[0] / s.L.length),
              g: Math.round(s.rgb[1] / s.L.length),
              b: Math.round(s.rgb[2] / s.L.length),
            };
          })
          .sort((a, b) => b.px - a.px);
        // Spread into Math.min blows the stack at half a million samples, which
        // is what the sea's shadow catcher is.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of px) {
          if (p[5] < x0) x0 = p[5];
          if (p[5] > x1) x1 = p[5];
          if (p[6] < y0) y0 = p[6];
          if (p[6] > y1) y1 = p[6];
        }
        const box = [x0, y0, x1, y1];
        if (planes.length) out.push({ name, px: px.length, box, planes });
      }
      out.sort((a, b) => b.px - a.px);
      return { owners: owners.map((o) => o.name || '(unnamed)'), out };
    });

    const want = flag('only', null);
    for (const o of result.out) {
      if (want && !o.name.includes(want)) continue;
      console.log(`\n${o.name}  (${o.px} px, box ${o.box.join(',')})`);
      for (const p of o.planes.slice(0, 6)) {
        const hue = (() => {
          const [r, g, b] = [p.r, p.g, p.b];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
          if (!c) return 0;
          let x = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
          return ((x * 60) % 360 + 360) % 360;
        })();
        console.log(
          `   n=(${String(p.n[0]).padStart(5)},${String(p.n[1]).padStart(5)},${String(p.n[2]).padStart(5)})` +
          `  ${String(p.px).padStart(6)} px   L=${String(p.L).padStart(6)}` +
          `  rgb(${String(p.r).padStart(3)},${String(p.g).padStart(3)},${String(p.b).padStart(3)})  hue=${hue.toFixed(0)}`
        );
      }
    }
  }
} catch (e) {
  console.error(String(e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
process.exit(exitCode);
