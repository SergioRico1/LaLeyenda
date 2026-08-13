#!/usr/bin/env node
// Turns the raw VoxEdit glTF exports into small .glb files the game can load.
//
// VoxEdit exports one material + one embedded base64 texture per voxel part, so a
// single model can carry 80+ materials and 160+ images. Left alone that is one draw
// call per part and megabytes of duplicated palette PNGs. Everything below exists to
// collapse that down while keeping the vertex colours and the animation clips intact.
//
//   node tools/optimize.mjs                    every model in tools/raw/
//   node tools/optimize.mjs --only av_body_tan just these, leaving the rest alone
//
// A model can also name the clips it ships with — see `clips` in
// assets-manifest.json, and the clip-keeping block below.
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

// --only limits the run to named ids. Everything else keeps the .glb and the
// manifest entry it already has, so re-cutting one model cannot disturb the rest
// of the library (or a calibration someone measured by hand).
const argv = process.argv.slice(2);
const onlyArg = argv.indexOf('--only');
const only = onlyArg >= 0 && argv[onlyArg + 1] ? argv[onlyArg + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

// Which clips each model is allowed to keep, from assets-manifest.json.
const source = JSON.parse(fs.readFileSync(path.join(HERE, 'assets-manifest.json'), 'utf8'));
const keepClipsById = new Map(
  source.assets.filter((a) => Array.isArray(a.clips)).map((a) => [a.id, a.clips])
);

const allFiles = fs.readdirSync(RAW).filter((f) => f.endsWith('.gltf'));
if (!allFiles.length) {
  console.error('No raw assets. Run: npm run assets:fetch');
  process.exit(1);
}
const files = only ? allFiles.filter((f) => only.includes(path.basename(f, '.gltf'))) : allFiles;
if (only) {
  const missing = only.filter((id) => !allFiles.includes(`${id}.gltf`));
  if (missing.length) {
    console.error(`No raw asset for: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`only: ${only.join(', ')}`);
}

/**
 * Removes an animation channel AND the sampler holding its keyframes.
 *
 * Disposing the channel alone is not enough, and the difference is most of the
 * file. gltf-transform's Animation and AnimationChannel do not dispose what they
 * own, so a channel disposed on its own leaves its sampler behind, orphaned but
 * still referencing the keyframe accessors — and prune() does not sweep
 * samplers, so those accessors still look used and get written out. Dropping 26
 * of 30 clips that way made the body files BIGGER: 4 clips of live keyframes
 * plus 26 clips of dead ones, 527KB of data no channel could reach.
 */
const dropChannel = (channel) => {
  const sampler = channel.getSampler();
  channel.dispose();
  // glTF lets two channels share one sampler (translation and scale are both
  // VEC3), so it only goes once nothing points at it any more.
  if (sampler && !sampler.listParents().some((p) => p.propertyType === 'AnimationChannel')) {
    sampler.dispose();
  }
};

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

    // Keep only the clips this model ships with.
    //
    // The avatar bodies carry thirty animations — every dance, every combat
    // swing — and the keyframes are the overwhelming majority of the file: 647KB
    // against PLAN.md's 300KB budget. A captain uses four of them. Dropping the
    // rest here rather than at runtime is what actually saves the download.
    //
    // Both this and the scale-track drop below happen BEFORE the transform chain,
    // so the prune() at the end of it collects the keyframe accessors they free
    // and resample() only works on what survives. A clip named in
    // assets-manifest.json that the model does not have is a build failure:
    // silently shipping a body with no walk is worse than not shipping.
    const keepClips = keepClipsById.get(id);
    const droppedClips = [];
    if (keepClips) {
      const present = doc.getRoot().listAnimations().map((a) => a.getName());
      const missing = keepClips.filter((name) => !present.includes(name));
      if (missing.length) {
        throw new Error(`assets-manifest asks to keep clips this model does not have: ${missing.join(', ')}`);
      }
      for (const anim of doc.getRoot().listAnimations()) {
        if (keepClips.includes(anim.getName())) continue;
        droppedClips.push(anim.getName());
        for (const channel of anim.listChannels()) dropChannel(channel);
        anim.dispose();
      }
    }

    // Drop every scale channel from every clip.
    //
    // VoxEdit bakes its normalization as a large scale on the armature (23x on
    // the foundry) and then has each clip re-assert some version of it, on the
    // armature root and on bones underneath. The size the game computes for a
    // model is therefore only valid until the mixer ticks, and it lands
    // somewhere different per clip — the foundry measured 115 units under its
    // "action" clip and over 460 under "idle", which is how a 5-unit building
    // ended up filling the screen.
    //
    // These are voxel props: their parts translate and rotate, they do not
    // grow. Nothing of the authored motion is lost by removing scale, and the
    // model's footprint becomes a fixed, knowable number.
    //
    // Worth being clear about what this does NOT do, because it has been blamed
    // for a size bug it did not cause: on the avatar bodies every one of these
    // channels holds a constant [1,1,1]. Removing them changes nothing about how
    // those models draw. A skinned model's size comes from its bones, and the
    // bones are reached through the skeleton — see instantiate() in assets.ts.
    let droppedScaleTracks = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      for (const channel of anim.listChannels()) {
        if (channel.getTargetPath() !== 'scale') continue;
        dropChannel(channel);
        droppedScaleTracks++;
      }
    }
    if (droppedScaleTracks) console.log(`    dropped ${droppedScaleTracks} scale track(s)`);

    // flatten/join bake node transforms into geometry. That is safe for a static
    // prop, but these models are skinned: the armature already applies its own
    // transform through the bind matrices, so baking the same scale into the mesh
    // node makes it apply twice — the foundry's 23x armature scale came out as
    // 23x23 and rendered the building hundreds of units across. Skinned documents
    // therefore skip both, and keep their hierarchy exactly as authored.
    // Read from `before`, not from what is left: a model that was animated stays
    // on the skinned path even if the clip filter above took all but one of its
    // clips. flatten/join must not start baking transforms because of a filter.
    const isSkinned = doc.getRoot().listSkins().length > 0 || before.animations > 0;

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

    // Clips may only go missing on purpose. Everything the filter did not name
    // has to survive the transform chain, as it always has.
    const expectedAnimations = before.animations - droppedClips.length;
    if (after.animations !== expectedAnimations) {
      throw new Error(`lost animations: expected ${expectedAnimations}, got ${after.animations}`);
    }
    report.push({ id, srcKB: Math.round(srcBytes / 1024), outKB: Math.round(glb.byteLength / 1024), before, after });
    console.log(
      `  ${id.padEnd(20)} ${String(Math.round(srcBytes / 1024)).padStart(6)}KB -> ${String(Math.round(glb.byteLength / 1024)).padStart(5)}KB` +
      `  mat ${before.materials}->${after.materials}  tex ${before.textures}->${after.textures}` +
      (droppedClips.length ? `  dropped ${droppedClips.length} clip(s)` : '') +
      `  clips[${after.clips.join(',') || '-'}]`
    );
  } catch (err) {
    console.error(`  FAILED ${id}: ${err.message}`);
    report.push({ id, error: String(err.message) });
  }
}

// Record each model's true rendered size.
//
// This has to come from the file, not from a naive three.js measurement: the
// game scales every model to a target footprint, so feeding it the wrong size
// makes buildings render tens of times too large — or, the other way round,
// leaves a model that draws at a fraction of the space it was given.
//
// Two different transforms decide where a vertex lands, and using the wrong one
// is how this has gone wrong before:
//
//   static mesh  — the node's own world transform, accessor bounds through it.
//   skinned mesh — glTF says the node's transform is IGNORED. The vertices go
//                  through the joints instead, as sum(weight * jointWorld *
//                  inverseBind * v). Walking the node scales for one of these
//                  reports whatever the armature happens to carry: bldg_foundry
//                  measures 2685 units that way and draws at 115.
//
// So each mesh is measured the way it is actually drawn.
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

  const expand = (p) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  };

  // Every node's world matrix first — a joint can sit anywhere in the hierarchy,
  // including outside the subtree of the mesh it drives.
  const world = new Map();
  const visit = (node, parentMatrix) => {
    const m = matMul(parentMatrix, composeTRS(node.getTranslation(), node.getRotation(), node.getScale()));
    world.set(node, m);
    for (const child of node.listChildren()) visit(child, m);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) visit(node, IDENTITY);
  }

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const nodeWorld = world.get(node) ?? IDENTITY;
    const skin = node.getSkin();
    const inverseBinds = skin?.getInverseBindMatrices();
    const joints = skin?.listJoints() ?? [];

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const jointIndex = prim.getAttribute('JOINTS_0');
      const jointWeight = prim.getAttribute('WEIGHTS_0');

      if (skin && jointIndex && jointWeight) {
        // Skinned: every vertex, through the joints. The accessor bounds are no
        // use here — they describe the mesh before the skeleton moves it, and
        // the eight corners of that box are not where any vertex ends up.
        const vertex = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, vertex);
          const indices = jointIndex.getElement(i, []);
          const weights = jointWeight.getElement(i, []);
          const out = [0, 0, 0];
          let total = 0;
          for (let k = 0; k < 4; k++) {
            const weight = weights[k];
            if (!weight) continue;
            const joint = joints[indices[k]];
            if (!joint) continue;
            const bind = inverseBinds ? inverseBinds.getElement(indices[k], []) : IDENTITY;
            const skinned = applyMat(matMul(world.get(joint) ?? IDENTITY, bind), vertex);
            for (let axis = 0; axis < 3; axis++) out[axis] += skinned[axis] * weight;
            total += weight;
          }
          // A vertex bound to nothing is drawn where its node puts it.
          expand(total > 0 ? out : applyMat(nodeWorld, vertex));
        }
      } else {
        // Static: the accessor bounds through the node's world transform. All
        // eight corners, so rotation is accounted for — several models tilt
        // their parts, and an axis-aligned scale-only walk under-reports those
        // (palm fronds came out a third short).
        const lo = pos.getMin([]);
        const hi = pos.getMax([]);
        for (let corner = 0; corner < 8; corner++) {
          expand(applyMat(nodeWorld, [
            corner & 1 ? hi[0] : lo[0],
            corner & 2 ? hi[1] : lo[1],
            corner & 4 ? hi[2] : lo[2],
          ]));
        }
      }
    }
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return size.every((v) => Number.isFinite(v) && v > 0)
    ? { size: size.map((v) => Number(v.toFixed(3))), min: min.map((v) => Number(v.toFixed(3))) }
    : null;
}

// Merged into the manifest, never written over it. Two reasons: a --only run
// must leave every other model's entry exactly as it found it, and calibrate.mjs
// adds fields of its own (widestClip) that this pass has no opinion about.
const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
for (const r of report.filter((x) => !x.error)) {
  const dims = await trueSize(path.join(OUT, `${r.id}.glb`));
  const entry = { ...manifest[r.id], kb: r.outKB, clips: r.after.clips, ...(dims ?? {}) };
  // A calibration that names a clip this model no longer has is stale.
  if (entry.widestClip && !entry.clips.includes(entry.widestClip)) delete entry.widestClip;
  manifest[r.id] = entry;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Budget reported across the whole library, not just this run — a --only run
// should still tell you where the download stands.
const built = report.filter((r) => !r.error);
const entries = Object.entries(manifest);
const totalKB = entries.reduce((a, [, m]) => a + (m.kb ?? 0), 0);
const over = entries.filter(([, m]) => (m.kb ?? 0) > 300);
console.log(`\nbuilt ${built.length} model(s); ${entries.length} in the manifest, ${(totalKB / 1024).toFixed(1)}MB total`);
if (over.length) console.log(`over 300KB budget: ${over.map(([id, m]) => `${id}(${m.kb}KB)`).join(', ')}`);
