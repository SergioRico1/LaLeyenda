import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { chromium } from '/home/user/LaLeyenda/game/node_modules/playwright/index.mjs';

const ROOT = '/home/user/LaLeyenda/game';
const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const {port}=s.address(); s.close(()=>r(port)); }); });
const server = spawn('npx', ['vite','--port',String(port),'--strictPort'], { cwd: ROOT, stdio:['ignore','pipe','pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => { if (String(d).includes('Local:')) setTimeout(r, 400); }));
const bin = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome'].find((p)=>fs.existsSync(p));
const browser = await chromium.launch({ ...(bin?{executablePath:bin}:{}) , args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:430,height:932}, deviceScaleFactor:1 });
const errs = []; page.on('pageerror',(e)=>errs.push(String(e)));
page.on('console',(m)=>{ if(m.type()==='error') errs.push(m.text()); });
const say = async (l, fn, a) => console.log(l, JSON.stringify(await page.evaluate(fn, a)));

await page.goto(`http://localhost:${port}/?scene=island&shot=1&motion=1&w=430&h=932&t=2.0`, {waitUntil:'load'});
await page.waitForFunction(()=>window.__ready===true||window.__error,{timeout:120000});
console.error('READY');

// ---- 1. does a calc(var(--pct)) width actually interpolate here? ----------
await say('pill fill interpolation', async () => {
  const pill = document.querySelector('.pill');
  const fill = pill.querySelector('.pill__fill');
  pill.style.setProperty('--pct','0');
  await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  pill.style.setProperty('--pct','1');
  const samples = [];
  for (let i=0;i<5;i++){
    await new Promise((r)=>setTimeout(r,90));
    samples.push(Math.round(fill.getBoundingClientRect().width));
  }
  return { samples };
});

// ---- 2. the refusal toast on the locked CTA ------------------------------
await page.locator('button[aria-label="¡Zarpar!"]').click({timeout:15000});
await page.waitForTimeout(80);
await say('after locked CTA tap', () => ({
  toasts: [...document.querySelectorAll('.toast')].map(n=>n.textContent),
  refusing: !!document.querySelector('.tile--cta.is-refused, .is-refused'),
}));

// ---- 3. press state on the chips + timer bar -----------------------------
await say('press states', () => {
  const out = {};
  for (const sel of ['.builder-chip','.status-chip','.world-item .timerbar','.pick-row','.collect-all']) {
    const n = document.querySelector(sel);
    if (!n) { out[sel]='absent'; continue; }
    const rest = getComputedStyle(n).transform;
    n.classList.add('is-pressed');
    const down = getComputedStyle(n).transform;
    n.classList.remove('is-pressed');
    out[sel] = { rest, down, moved: rest !== down };
  }
  return out;
});

// ---- 4. the build bar arrives by travelling ------------------------------
await page.locator('button[aria-label="Construir"]').click({timeout:15000});
await page.waitForSelector('.sheet.is-open .pick-row',{timeout:15000});
await page.waitForTimeout(300);
await say('sheet open transform', () => {
  const p = document.querySelector('.sheet__panel');
  return { t: getComputedStyle(p).transform, origin: getComputedStyle(p).transformOrigin };
});
await say('grab bar height', () => document.querySelector('.sheet__grab').getBoundingClientRect().height);

// ---- 5. counters no longer drop 12px while punching ----------------------
await say('punch does not displace', () => {
  const num = document.querySelector('.pill__num');
  const before = num.getBoundingClientRect().top;
  num.classList.add('is-punching');
  const during = num.getBoundingClientRect().top;
  num.classList.remove('is-punching');
  return { before: Math.round(before*10)/10, during: Math.round(during*10)/10, drop: Math.round((during-before)*10)/10 };
});

console.log('ERRORS', JSON.stringify(errs.slice(0,6)));
await browser.close(); server.kill();
