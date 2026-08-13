#!/usr/bin/env node
/**
 * tools/test.mjs — the test runner. No framework.
 *
 * The suite is TypeScript that imports src/sim directly (and src/data/balance.json
 * through it), so it exercises exactly the code the game ships rather than a
 * transpiled copy. esbuild — already in the tree as a Vite dependency — bundles
 * it to one ESM file, and node imports that.
 *
 * `npm test` runs this. UI_SPEC §7 asks for the storage-invariant check to fail
 * the build; a non-zero exit here is what does that.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'tools', 'tests', 'all.ts');
const outFile = path.join(root, 'node_modules', '.cache', 'laleyenda', 'tests.mjs');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: 'inline',
  // `.css` as text so a test can assert on a stylesheet's own source (see
  // tokens.test.ts) without reaching for node:fs — the suite has no @types/node
  // and does not want one.
  loader: { '.json': 'json', '.css': 'text' },
  write: false,
  logLevel: 'warning',
});

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, result.outputFiles[0].text);

const suite = await import(pathToFileURL(outFile).href);
const failures = await suite.run();
process.exit(failures > 0 ? 1 : 0);
