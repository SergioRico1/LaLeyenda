// Boots the game like shoot.mjs, optionally runs an act, then dumps geometry +
// the four-layer-relevant computed styles for every element under #ui.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { chromium } from 'playwright';
import { ACTS } from '/home/user/LaLeyenda/game/tools/acts.mjs';

const ROOT = '/home/user/LaLeyenda/game';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--'+n); return i>=0 && argv[i+1] ? argv[i+1] : d; };
const act = flag('act', null);
const width = Number(flag('w', 430)), height = Number(flag('h', 932));
const sel = flag('sel', '#ui *');

const port = await new Promise(r => { const s=net.createServer(); s.listen(0,()=>{const{port}=s.address(); s.close(()=>r(port));}); });
const server = spawn('npx', ['vite','--port',String(port),'--strictPort'], { cwd: ROOT, stdio:['ignore','pipe','pipe'] });
await new Promise(r => { const t=setTimeout(()=>r(false),60000); server.stdout.on('data',d=>{ if(String(d).includes('ready in')||String(d).includes('Local:')){clearTimeout(t);setTimeout(()=>r(true),400);} }); });

const pre = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome'].find(p=>fs.existsSync(p));
const browser = await chromium.launch({ ...(pre?{executablePath:pre}:{}) , args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const page = await browser.newPage({ viewport:{width,height}, deviceScaleFactor:1 });
await page.goto(`http://localhost:${port}/?scene=island&shot=1&w=${width}&h=${height}&t=2.0&seed=la-leyenda`, {waitUntil:'load', timeout:60000});
await page.waitForFunction(()=>window.__ready===true, null, {timeout:60000}).catch(()=>{});
if (act && ACTS[act]) await ACTS[act](page);

const rows = await page.evaluate((sel) => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll(sel).forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
    out.push({
      sel: el.tagName.toLowerCase() + (el.className && typeof el.className==='string' ? '.'+el.className.trim().split(/\s+/).join('.') : ''),
      x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      bw: cs.borderTopWidth, br: cs.borderTopLeftRadius,
      bg: (cs.backgroundImage!=='none' ? cs.backgroundImage.slice(0,220) : cs.backgroundColor),
      bs: cs.boxShadow === 'none' ? '' : cs.boxShadow.slice(0,200),
      fs: cs.fontSize, ff: cs.fontFamily.split(',')[0], fw: cs.fontWeight,
      stroke: cs.webkitTextStrokeWidth, strokeC: cs.webkitTextStrokeColor,
      ts: cs.textShadow === 'none' ? '' : cs.textShadow.slice(0,120),
      po: cs.paintOrder, color: cs.color,
      txt: (el.children.length===0 ? (el.textContent||'').trim().slice(0,24) : ''),
    });
  });
  return out;
}, sel);
console.log(JSON.stringify(rows, null, 1));
await browser.close(); server.kill();
