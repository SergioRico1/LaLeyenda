#!/usr/bin/env node
// Turns the raw VoxEdit glTF exports into small .glb files the game can load.
//
// VoxEdit exports one material + one embedded base64 texture per voxel part, so a
// single model can carry 80+ materials and 160+ images. Left alone that is one draw
// call per part and megabytes of duplicated palette PNGs. Everything below exists to
// collapse that down while keeping the vertex colours and the animation clips intact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, join, flatten, resample, textureCompress, sparse,
} from '@gltf-transform/functions';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const OUT = path.join(HERE, '..', 'public', 'assets', 'models');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.gltf'));
if (!files.length) {
  console.error('No raw assets. Run: npm run assets:fetch');
  process.exit(1);
}

const report = [];
for (const file of files) {
  const id = path.basename(file, '.gltf');
  const srcBytes = fs.statSync(path.join(RAW, file)).size;
  try {
    const doc = await io.read(path.join(RAW, file));
    const before = {
      meshes: doc.getRoot().listMeshes().length,
      materials: doc.getRoot().listMaterials().length,
      textures: doc.getRoot().listTextures().length,
      animations: doc.getRoot().listAnimations().length,
    };

    // flatten/join bake node transforms into geometry. That is safe for a static
    // prop, but these models are skinned: the armature already applies its own
    // transform through the bind matrices, so baking the same scale into the mesh
    // node makes it apply twice — the foundry's 23x armature scale came out as
    // 23x23 and rendered the building hundreds of units across. Skinned documents
    // therefore skip both, and keep their hierarchy exactly as authored.
    const isSkinned = doc.getRoot().listSkins().length > 0 || doc.getRoot().listAnimations().length > 0;

    await doc.transform(
      ...(isSkinned ? [] : [flatten()]),
      dedup(),
      // Palette textures repeat constantly across parts; shrinking them first makes
      // the dedup hash cheap and keeps the atlas tiny.
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 90 }),
      dedup(),
      ...(isSkinned ? [] : [join({ keepNamed: false })]),
      weld({ tolerance: 0 }),
      resample(),
      sparse(),
      prune({ keepAttributes: false, keepLeaves: false })
    );

    // VoxEdit gives every part its own buffer (some models ship 4000+ of them).
    // GLB allows at most one, so fold every accessor onto the first buffer.
    const buffers = doc.getRoot().listBuffers();
    if (buffers.length > 1) {
      const target = buffers[0];
      for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(target);
      for (const buffer of buffers.slice(1)) buffer.dispose();
    }

    const after = {
      meshes: doc.getRoot().listMeshes().length,
      materials: doc.getRoot().listMaterials().length,
      textures: doc.getRoot().listTextures().length,
      animations: doc.getRoot().listAnimations().length,
      clips: doc.getRoot().listAnimations().map((a) => a.getName()),
    };

    const glb = await io.writeBinary(doc);
    fs.writeFileSync(path.join(OUT, `${id}.glb`), glb);

    if (after.animations !== before.animations) {
      throw new Error(`lost animations: ${before.animations} -> ${after.animations}`);
    }
    report.push({ id, srcKB: Math.round(srcBytes / 1024), outKB: Math.round(glb.byteLength / 1024), before, after });
    console.log(
      `  ${id.padEnd(20)} ${String(Math.round(srcBytes / 1024)).padStart(6)}KB -> ${String(Math.round(glb.byteLength / 1024)).padStart(5)}KB` +
      `  mat ${before.materials}->${after.materials}  tex ${before.textures}->${after.textures}` +
      `  clips[${after.clips.join(',') || '-'}]`
    );
  } catch (err) {
    console.error(`  FAILED ${id}: ${err.message}`);
    report.push({ id, error: String(err.message) });
  }
}

// Record each model's true rendered size.
//
// This has to come from the file, not from three.js at runtime: nearly every
// model is a SkinnedMesh whose armature carries a large scale (23x on the
// foundry), and both Box3.setFromObject and SkinnedMesh.computeBoundingBox
// report the pre-armature extent — off by exactly that factor. The game scales
// models to a target footprint, so feeding it the wrong size makes buildings
// render tens of times too large. Reading the accessor bounds through the node
// scales gives the number the GPU actually draws.
// Column-major 4x4 helpers — enough to compose node transforms exactly.
// Rotation matters: several models tilt their parts, and an axis-aligned
// scale-only walk under-reports those (palm fronds came out a third short).
const matMul = (a, b) => {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
};

const composeTRS = (t, q, s) => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};

const applyMat = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

async function trueSize(file) {
  const doc = await io.read(file);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  const visit = (node, parentMatrix) => {
    const world = matMul(parentMatrix, composeTRS(node.getTranslation(), node.getRotation(), node.getScale()));
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const lo = pos.getMin([]);
        const hi = pos.getMax([]);
        // All eight corners, so rotation is accounted for.
        for (let corner = 0; corner < 8; corner++) {
          const p = applyMat(world, [
            corner & 1 ? hi[0] : lo[0],
            corner & 2 ? hi[1] : lo[1],
            corner & 4 ? hi[2] : lo[2],
          ]);
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], p[i]);
            max[i] = Math.max(max[i], p[i]);
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child, world);
  };

  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) visit(node, IDENTITY);
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return size.every((v) => Number.isFinite(v) && v > 0)
    ? { size: size.map((v) => Number(v.toFixed(3))), min: min.map((v) => Number(v.toFixed(3))) }
    : null;
}

const manifest = {};
for (const r of report.filter((x) => !x.error)) {
  const dims = await trueSize(path.join(OUT, `${r.id}.glb`));
  manifest[r.id] = { kb: r.outKB, clips: r.after.clips, ...(dims ?? {}) };
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const totalKB = report.filter((r) => !r.error).reduce((a, r) => a + r.outKB, 0);
const over = report.filter((r) => !r.error && r.outKB > 300);
console.log(`\n${report.filter((r) => !r.error).length} models, ${(totalKB / 1024).toFixed(1)}MB total`);
if (over.length) console.log(`over 300KB budget: ${over.map((r) => `${r.id}(${r.outKB}KB)`).join(', ')}`);
