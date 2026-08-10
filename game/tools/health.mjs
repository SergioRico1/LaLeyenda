#!/usr/bin/env node
/**
 * tools/health.mjs — is anything actually still working?
 *
 *   node tools/health.mjs           fast: git, workflows, production
 *   node tools/health.mjs --full    also runs tsc and the suite (slow)
 *
 * This exists because of a specific, repeated failure. Twice now a workflow has
 * died silently — once when the container restarted and took five agents with
 * it, once when an agent was interrupted mid-run — and both times it was hours
 * before anybody noticed. Both times the thing that would have caught it in
 * thirty seconds was the same question: WHEN DID ANYTHING LAST WRITE A FILE?
 *
 * THE RULE THIS ENFORCES: **liveness is a file mtime, not a counter.** An agent
 * that hung ten hours ago and an agent working hard right now look identical in
 * a started/finished tally, and reading that tally is how a dead run got
 * reported as healthy twice. Every judgement below is made on timestamps.
 *
 * Nothing here is allowed to be slow enough that somebody skips running it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL = process.argv.includes('--full');

/** Seconds since a path was last written, or null if it is not there. */
const age = (p) => {
  try { return Math.round((Date.now() - fs.statSync(p).mtimeMs) / 1000); }
  catch { return null; }
};

const mins = (s) => (s === null ? '—' : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);

const sh = (cmd, cwd = ROOT) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

const lines = [];
const say = (s) => lines.push(s);
let worst = 'OK';
const raise = (level) => {
  const rank = { OK: 0, WATCH: 1, STALLED: 2, BROKEN: 3 };
  if (rank[level] > rank[worst]) worst = level;
};

// ---------------------------------------------------------------------------
say('## git');

const branch = sh('git rev-parse --abbrev-ref HEAD') ?? '?';
const dirty = (sh('git status --porcelain') ?? '').split('\n').filter(Boolean);
const ahead = sh(`git rev-list --count origin/${branch}..HEAD`) ?? '?';
const head = sh('git log --oneline -1') ?? '?';

say(`branch      ${branch}`);
say(`head        ${head}`);
say(`unpushed    ${ahead} commit(s)`);
say(`uncommitted ${dirty.length} file(s)${dirty.length ? ' — ' + dirty.slice(0, 6).map((l) => l.slice(3)).join(', ') : ''}`);
if (Number(ahead) > 0) raise('WATCH');

// Uncommitted work is only a problem if nothing is writing it any more. A dirty
// tree with a live agent in it is a round in progress; a dirty tree that has
// been still for an hour is work somebody forgot to land.
if (dirty.length) {
  const youngest = Math.min(...dirty
    .map((l) => age(path.join(ROOT, l.slice(3).replace(/^game\//, ''))))
    .filter((a) => a !== null));
  say(`last edit   ${mins(youngest)} ago`);
  if (youngest > 3600) { say('  ^ dirty and nobody is writing — land it or explain it'); raise('STALLED'); }
}

// ---------------------------------------------------------------------------
say('');
say('## workflows');

const WF = path.join(
  process.env.HOME ?? '/root',
  '.claude/projects/-home-user-LaLeyenda/639e22bd-90e5-54e6-ba9b-4a7b95847f10/subagents/workflows',
);

let runs = [];
try { runs = fs.readdirSync(WF).filter((d) => d.startsWith('wf_')); } catch { /* none yet */ }

if (!runs.length) say('(no workflow runs on disk)');

for (const run of runs.sort()) {
  const dir = path.join(WF, run);
  const journal = path.join(dir, 'journal.jsonl');
  let started = 0, done = 0;
  try {
    for (const line of fs.readFileSync(journal, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const type = JSON.parse(line).type;
      if (type === 'started') started++;
      if (type === 'result') done++;
    }
  } catch { /* unreadable */ }

  // The whole point: the youngest agent transcript, not the counter.
  const agents = fs.readdirSync(dir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
  const freshest = agents.length ? Math.min(...agents.map((f) => age(path.join(dir, f)))) : null;

  const running = started - done;
  let verdict;
  if (running <= 0) verdict = 'finished';
  else if (freshest === null) verdict = 'BROKEN — agents started but no transcript';
  else if (freshest < 300) verdict = 'ALIVE';
  else if (freshest < 1800) verdict = 'WATCH — quiet a while';
  // A stalled run is only ACTIONABLE while its work is still on the floor.
  // Once the tree is clean there is nothing left to salvage from it, and
  // shouting about a run that died yesterday is how a real one gets missed —
  // four ancient corpses were firing the alarm every heartbeat and would
  // eventually have masked a fresh death. Still listed, just not alarming.
  else if (dirty.length === 0) verdict = 'abandoned — nothing to recover, tree is clean';
  else verdict = 'STALLED — nothing written, treat as dead';

  if (verdict.startsWith('STALLED') || verdict.startsWith('BROKEN')) raise('STALLED');
  else if (verdict.startsWith('WATCH')) raise('WATCH');

  say(`${run}  ${done}/${started} done · last write ${mins(freshest)} ago · ${verdict}`);
}

// ---------------------------------------------------------------------------
say('');
say('## production');

// A deployment URL answers 200 with Vercel's LOGIN PAGE when protection is on,
// so a status code proves nothing. The title is the only honest check.
const title = sh(`curl -s -L --max-time 20 https://project-i07zk.vercel.app | grep -o '<title>[^<]*</title>'`);
if (title && title.includes('La Leyenda Pirata')) say('project-i07zk.vercel.app  serving the game');
else { say(`project-i07zk.vercel.app  NOT THE GAME — got: ${title ?? '(no response)'}`); raise('BROKEN'); }

// ---------------------------------------------------------------------------
if (FULL) {
  say('');
  say('## gates');
  const tsc = sh('npx tsc --noEmit -p tsconfig.json 2>&1') ;
  say(tsc === null || tsc === '' ? 'tsc     clean' : `tsc     FAILING\n${tsc.split('\n').slice(0, 5).join('\n')}`);
  if (tsc) raise('BROKEN');

  const test = sh('npm test 2>&1 | tail -3');
  const passed = /(\d+) passed/.exec(test ?? '');
  const failed = /(\d+) failed/.exec(test ?? '');
  say(`tests   ${passed ? passed[1] + ' passed' : '?'}${failed ? ', ' + failed[1] + ' FAILED' : ''}`);
  if (failed) raise('BROKEN');
}

console.log(`# health — ${worst}\n`);
console.log(lines.join('\n'));
process.exit(worst === 'BROKEN' ? 2 : worst === 'STALLED' ? 1 : 0);
