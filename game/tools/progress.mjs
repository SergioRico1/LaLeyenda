#!/usr/bin/env node
/**
 * tools/progress.mjs — the live progress page.
 *
 *   node tools/progress.mjs
 *
 * Reads PROGRESS.json (appended to after every round) and writes progress.html,
 * a self-contained page with every frame embedded. It is published as an
 * Artifact, which runs under a strict CSP: no CDN, no external font, no remote
 * image. Everything is inlined, including the game's own two typefaces — the
 * page is literally made of the thing it documents.
 *
 * The page KEEPS THE BLIND. Each round's two frames are shown unlabelled, the
 * way the judging agent saw them, and which is which is revealed only when the
 * reader asks. A progress page that captions "ours" and "theirs" up front is
 * asking to be read charitably; this one makes you commit first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'PROGRESS.json'), 'utf8'));

const font = (file) =>
  fs.readFileSync(path.join(ROOT, 'public/fonts', file)).toString('base64');

/** A frame, downscaled and inlined. The 16MB artifact ceiling is generous but
 *  a dozen rounds of 1280px PNGs would eat it. */
async function frame(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  const buf = await sharp(full).resize(720, null, { withoutEnlargement: true })
    .jpeg({ quality: 74 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const VERDICT_LABEL = {
  'ours-better': 'ahead',
  close: 'level',
  'ours-worse': 'behind',
  'ours-much-worse': 'far behind',
};

const plates = [];
for (const r of data.rounds) {
  const a = await frame(r.a);
  const b = await frame(r.b);
  if (!a || !b) continue;

  const decided = r.better
    ? `<p class="call">
         The judge chose <b>${esc(r.better)}</b> — ${r.weWon
           ? '<span class="won">ours</span>' : '<span class="lost">the shipped game</span>'},
         gap <b>${esc(r.gapSize ?? '—')}</b>.
       </p>`
    : '<p class="call">Baseline. No judgement taken.</p>';

  const pieces = (r.pieces ?? []).map((p) => `
    <li>
      <span class="chip chip--${esc(p.verdict ?? 'close')}">${esc(VERDICT_LABEL[p.verdict] ?? p.verdict ?? '—')}</span>
      <b>${esc(p.piece)}</b>
      <span>${esc(p.biggestGap)}</span>
    </li>`).join('');

  plates.push(`
  <article class="plate" id="r${r.round}">
    <header class="plate__head">
      <span class="rnd">Round ${String(r.round).padStart(2, '0')}</span>
      <h2>${esc(r.title ?? 'The island, held against the shipped game')}</h2>
    </header>

    <div class="pair" data-revealed="false">
      <figure><img src="${a}" alt="Frame A"><figcaption><span class="tag">A</span><span class="who">${esc(r.key?.a ?? '')}</span></figcaption></figure>
      <figure><img src="${b}" alt="Frame B"><figcaption><span class="tag">B</span><span class="who">${esc(r.key?.b ?? '')}</span></figcaption></figure>
    </div>
    <button class="reveal" type="button">Reveal which is which</button>

    ${decided}
    ${r.biggestFlaw ? `<p class="gap"><span>Biggest remaining gap</span>${esc(r.biggestFlaw)}</p>` : ''}
    ${r.differences?.length ? `<ol class="diffs">${r.differences.map((d) => `<li>${esc(d)}</li>`).join('')}</ol>` : ''}
    ${pieces ? `<ul class="pieces">${pieces}</ul>` : ''}
  </article>`);
}

const latest = data.rounds[data.rounds.length - 1] ?? {};

const html = `<title>La Leyenda Pirata — held against the bar</title>
<style>
  @font-face { font-family:'Lilita'; src:url(data:font/woff2;base64,${font('LilitaOne-Regular.woff2')}) format('woff2'); font-display:swap; }
  @font-face { font-family:'Fredoka'; src:url(data:font/woff2;base64,${font('Fredoka-SemiBold.woff2')}) format('woff2'); font-weight:600; font-display:swap; }

  /* The palette is the game's own token file. Light is chart paper, dark is
     the deep water the whole thing is set in. */
  :root {
    --ink:#14100C; --body:#3A3630; --faint:#7A7266;
    --ground:#EFE7D6; --panel:#F8F3E7; --edge:#D8CCB2;
    --accent:#177C90; --gold:#9A6B0E; --won:#2F7D2A; --lost:#9A3320;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink:#F2EADA; --body:#CBBFA8; --faint:#8A9AA6;
      --ground:#06202F; --panel:#0C2E42; --edge:#17455E;
      --accent:#4FC3D8; --gold:#F3BB26; --won:#7ED957; --lost:#FF8A6B;
    }
  }
  :root[data-theme="dark"] {
    --ink:#F2EADA; --body:#CBBFA8; --faint:#8A9AA6;
    --ground:#06202F; --panel:#0C2E42; --edge:#17455E;
    --accent:#4FC3D8; --gold:#F3BB26; --won:#7ED957; --lost:#FF8A6B;
  }

  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--body);
    font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;
    padding:0 20px 80px;
  }
  .wrap { max-width:940px; margin:0 auto; }

  header.top { padding:56px 0 30px; border-bottom:2px solid var(--edge); }
  h1 {
    font-family:'Lilita',system-ui,sans-serif; font-weight:400;
    font-size:clamp(34px,6vw,58px); line-height:1.02; margin:0 0 10px;
    color:var(--ink); text-wrap:balance; letter-spacing:.2px;
  }
  .sub { max-width:62ch; margin:0; }
  .standing {
    display:flex; flex-wrap:wrap; gap:10px 26px; margin-top:24px;
    font-family:'Fredoka',system-ui,sans-serif; font-weight:600;
    font-variant-numeric:tabular-nums;
  }
  .standing div { display:flex; flex-direction:column; gap:2px; }
  .standing span { font-size:11px; letter-spacing:.10em; text-transform:uppercase; color:var(--faint); }
  .standing b { font-size:23px; color:var(--ink); font-weight:600; }

  .plate { padding:44px 0; border-bottom:1px solid var(--edge); }
  .plate__head { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-bottom:18px; }
  .rnd {
    font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:12px;
    letter-spacing:.12em; text-transform:uppercase; color:var(--accent);
    font-variant-numeric:tabular-nums;
  }
  .plate h2 {
    font-family:'Lilita',system-ui,sans-serif; font-weight:400;
    font-size:clamp(20px,2.6vw,27px); margin:0; color:var(--ink); text-wrap:balance;
  }

  /* The blind. Captions carry the answer but stay hidden until asked for. */
  .pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width:620px) { .pair { grid-template-columns:1fr; } }
  .pair figure { margin:0; }
  .pair img {
    display:block; width:100%; height:auto; border-radius:5px;
    border:1px solid var(--edge); background:var(--panel);
  }
  figcaption {
    display:flex; align-items:center; gap:9px; margin-top:8px;
    font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:13px;
  }
  .tag {
    display:grid; place-items:center; width:23px; height:23px; border-radius:4px;
    background:var(--ink); color:var(--ground); font-size:12px;
  }
  .who { color:var(--faint); opacity:0; transition:opacity .18s ease; }
  .pair[data-revealed="true"] .who { opacity:1; color:var(--accent); }

  .reveal {
    margin-top:14px; font:inherit; font-family:'Fredoka',system-ui,sans-serif;
    font-weight:600; font-size:13px; cursor:pointer;
    background:none; color:var(--accent);
    border:1px solid var(--edge); border-radius:999px; padding:7px 15px;
  }
  .reveal:hover { border-color:var(--accent); }
  .reveal:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }

  .call { margin:22px 0 0; color:var(--ink); }
  .won { color:var(--won); font-weight:700; }
  .lost { color:var(--lost); font-weight:700; }

  .gap {
    margin:16px 0 0; padding:14px 16px; background:var(--panel);
    border-left:3px solid var(--gold); border-radius:0 5px 5px 0; color:var(--ink);
  }
  .gap span {
    display:block; font-family:'Fredoka',system-ui,sans-serif; font-weight:600;
    font-size:11px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--faint); margin-bottom:4px;
  }

  .diffs { margin:16px 0 0; padding-left:22px; }
  .diffs li { margin:5px 0; }

  .pieces { list-style:none; margin:22px 0 0; padding:0; display:grid; gap:8px; }
  .pieces li {
    display:grid; grid-template-columns:auto auto 1fr; gap:11px; align-items:baseline;
    padding:10px 12px; background:var(--panel); border-radius:5px; font-size:14px;
  }
  .pieces b { font-family:'Fredoka',system-ui,sans-serif; font-weight:600; color:var(--ink); }
  .chip {
    font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:11px;
    letter-spacing:.06em; text-transform:uppercase; padding:3px 9px; border-radius:999px;
    background:var(--edge); color:var(--ink); white-space:nowrap;
  }
  .chip--ours-better { background:var(--won); color:var(--ground); }
  .chip--close { background:var(--gold); color:var(--ground); }
  .chip--ours-worse, .chip--ours-much-worse { background:var(--lost); color:var(--ground); }

  footer { padding-top:34px; color:var(--faint); font-size:14px; max-width:62ch; }
  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
</style>

<div class="wrap">
  <header class="top">
    <h1>Held against the bar</h1>
    <p class="sub">
      Pirate Nation shipped a commercial game from the same CC0 voxel library this one is
      built from, so every difference between their screenshot and ours is execution, not art.
      Each round below puts the two frames side by side with the labels off — the way the
      judging agent sees them — and records which one a cold eye picks.
    </p>
    <div class="standing">
      <div><span>Rounds run</span><b>${data.rounds.filter((r) => r.better).length}</b></div>
      <div><span>Blind wins</span><b>${data.rounds.filter((r) => r.weWon).length}</b></div>
      <div><span>Current gap</span><b>${esc(latest.gapSize ?? 'unjudged')}</b></div>
    </div>
  </header>

  ${plates.join('\n')}

  <footer>
    Frames are captured from the running game by <code>tools/blind.mjs</code>, which renders ours
    at the reference's size and aspect so the comparison is of craft rather than crop. The judging
    agent is never told which frame is which and never reads the source.
  </footer>
</div>

<script>
  for (const button of document.querySelectorAll('.reveal')) {
    button.addEventListener('click', () => {
      const pair = button.previousElementSibling;
      const shown = pair.dataset.revealed === 'true';
      pair.dataset.revealed = shown ? 'false' : 'true';
      button.textContent = shown ? 'Reveal which is which' : 'Hide the labels again';
    });
  }
</script>`;

fs.writeFileSync(path.join(ROOT, 'progress.html'), html);
console.log(`progress.html — ${data.rounds.length} rounds, ${(html.length / 1024 / 1024).toFixed(2)} MB`);
