#!/usr/bin/env node
// Prints the native bounding box of every optimized model. Model scale in the
// source library is wildly inconsistent, so the game has to normalize — this is
// how we see what it is normalizing from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'public', 'assets', 'models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort()) {
  const doc = await io.read(path.join(DIR, file));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (node, parentScale) => {
    const s = node.getScale();
    const t = node.getTranslation();
    const scale = [parentScale[0] * s[0], parentScale[1] * s[1], parentScale[2] * s[2]];
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const pmin = pos.getMin([]);
        const pmax = pos.getMax([]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], t[i] + pmin[i] * scale[i], t[i] + pmax[i] * scale[i]);
          max[i] = Math.max(max[i], t[i] + pmin[i] * scale[i], t[i] + pmax[i] * scale[i]);
        }
      }
    }
    for (const child of node.listChildren()) visit(child, scale);
  };

  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) visit(node, [1, 1, 1]);
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const ok = size.every((v) => Number.isFinite(v) && v > 0);
  console.log(
    `${path.basename(file, '.glb').padEnd(20)} ` +
    (ok
      ? `size ${size.map((v) => v.toFixed(1).padStart(7)).join(' x ')}   minY ${min[1].toFixed(1)}`
      : 'DEGENERATE BOUNDS')
  );
}
