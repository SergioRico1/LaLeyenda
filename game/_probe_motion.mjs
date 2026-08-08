// Scratch probe: drives the real page and reports DOM/CSS facts. Not committed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = '/home/user/LaLeyenda/game';
const port = await new Promise((r) => {
  const s = net.createServer();
  s.listen(0, () => { const { port } = s.address(); s.close(() => r(port)); });
});
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => { server.stdout.on('data', (d) => { if (String(d).includes('Local:')) setTimeout(r, 400); }); });

const bin = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ ...(bin ? { executablePath: bin } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
browser.contexts; const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e}`));

await page.goto(`http://localhost:${port}/?scene=island&shot=1&motion=1&w=430&h=932&t=2.0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true || window.__error, {timeout:120000});
console.error('READY');

const say = async (label, fn, arg) => console.log(label, JSON.stringify(await page.evaluate(fn, arg), null, 1));

const snap = () => {
  const xp = document.querySelector('.xp');
  const fill = document.querySelector('.xp__fill');
  return {
    found: !!xp,
    pct: xp ? xp.style.getPropertyValue('--pct') : 'NO .xp',
    fillW: fill ? Math.round(fill.getBoundingClientRect().width * 10) / 10 : -1,
    xpBox: xp ? Math.round(xp.getBoundingClientRect().width) : -1,
    level: document.querySelector('.level-badge .num')?.textContent ?? 'none',
    ok: document.querySelectorAll('.ok-bubble').length,
    flyers: [...document.querySelectorAll('.flyer')].map((f) => f.textContent),
    sparks: document.querySelectorAll('.spark').length,
    fx: [...document.querySelectorAll('.layer-celebrate > *')].map((n) => n.className),
    toasts: [...document.querySelectorAll('.toast')].map((n) => n.textContent),
  };
};
await say('xp before', snap);

// finish the town hall with gems
await page.locator('.world-item .timerbar').first().click({force:true, timeout:20000});
console.error('CLICKED BAR');
await page.waitForSelector('.sheet.is-open .sheet__cta', {timeout:20000});
await page.waitForTimeout(400);
await page.locator('.sheet.is-open .sheet__cta').click({force:true, timeout:20000});
console.error('CLICKED CTA');
await page.waitForTimeout(900);

await say('after finish', snap);

await page.locator('.ok-bubble').click({ force: true, timeout:20000 });
console.error('CLICKED OK');
await page.waitForTimeout(120);
await say('120ms after claim', snap);
await page.waitForTimeout(700);
await say('800ms after claim', snap);

console.log('--- logs ---');
console.log(logs.filter((l) => /error|warn|PAGEERROR/i.test(l)).slice(0, 12).join('\n'));
await browser.close();
server.kill();
