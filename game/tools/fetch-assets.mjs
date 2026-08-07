#!/usr/bin/env node
// Downloads the source glTF assets listed in assets-manifest.json from the
// Pirate Nation art repo (CC0-1.0). The repo uses Git LFS, so files are pulled
// one by one from the media endpoint instead of cloning (the full repo is huge).
//
// Every path segment is URL-encoded individually: several folders in that repo
// have trailing spaces ("Mob Enemies /"), which 404 unless encoded as %20.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'assets-manifest.json'), 'utf8'));
const RAW = path.join(HERE, 'raw');
const CONCURRENCY = 6;

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function download(asset) {
  const dest = path.join(RAW, `${asset.id}.gltf`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return { ...asset, status: 'cached' };

  const url = manifest.base + encodePath(asset.source);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // An LFS pointer is a ~130 byte text file; the real asset is much bigger.
      if (buf.length < 1024 && buf.toString('utf8', 0, 20).includes('version https')) {
        throw new Error('got LFS pointer instead of content');
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return { ...asset, status: 'ok', bytes: buf.length };
    } catch (err) {
      if (attempt === 4) return { ...asset, status: 'failed', error: String(err.message || err) };
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
}

const queue = [...manifest.assets];
const results = [];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const asset = queue.shift();
      const r = await download(asset);
      results.push(r);
      const size = r.bytes ? `${(r.bytes / 1024 / 1024).toFixed(1)}MB` : '';
      console.log(`  ${r.status.padEnd(7)} ${r.id.padEnd(20)} ${size}`);
    }
  })
);

const failed = results.filter((r) => r.status === 'failed' && !r.optional);
console.log(`\n${results.filter((r) => r.status !== 'failed').length}/${results.length} assets available in tools/raw/`);
if (failed.length) {
  console.error('\nFAILED (non-optional):');
  for (const f of failed) console.error(`  ${f.id}: ${f.error}\n    ${f.source}`);
  process.exit(1);
}
