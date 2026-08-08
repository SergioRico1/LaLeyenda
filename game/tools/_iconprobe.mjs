import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { chromium } from 'playwright';
const ROOT='/home/user/LaLeyenda/game';
const port = await new Promise(r=>{const s=net.createServer();s.listen(0,()=>{const{port}=s.address();s.close(()=>r(port));});});
const server = spawn('npx',['vite','--port',String(port),'--strictPort'],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
await new Promise(r=>{const t=setTimeout(()=>r(false),60000);server.stdout.on('data',d=>{if(String(d).includes('ready in')||String(d).includes('Local:')){clearTimeout(t);setTimeout(()=>r(true),400);} });});
const pre=['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome'].find(p=>fs.existsSync(p));
const browser=await chromium.launch({...(pre?{executablePath:pre}:{}) ,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const page=await browser.newPage({viewport:{width:430,height:932},deviceScaleFactor:1});
await page.goto(`http://localhost:${port}/?scene=island&shot=1&w=430&h=932&t=2.0&seed=la-leyenda`,{waitUntil:'load',timeout:60000});
await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000}).catch(()=>{});
const out = await page.evaluate(async ()=>{
  const res=[];
  const imgs=[...document.querySelectorAll('#ui img')];
  for(const img of imgs){
    if(!img.naturalWidth) continue;
    const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      if(d[(y*c.width+x)*4+3]>16){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
    const r=img.getBoundingClientRect();
    const parent = img.closest('.tile,.pill,.cap');
    const pr = parent? parent.getBoundingClientRect() : null;
    res.push({
      cls: img.parentElement.className, nat:[c.width,c.height],
      inkW: maxX-minX+1, inkH: maxY-minY+1,
      fillPct: +(((maxX-minX+1)/c.width)*100).toFixed(1),
      cssBox:[+r.width.toFixed(1),+r.height.toFixed(1)],
      drawnCssW: +((maxX-minX+1)/c.width*r.width).toFixed(1),
      drawnCssH: +((maxY-minY+1)/c.height*r.height).toFixed(1),
      hostBox: pr? [+pr.width.toFixed(1), +pr.height.toFixed(1)] : null,
      pctOfHost: pr? +(((maxX-minX+1)/c.width*r.width)/pr.width*100).toFixed(1) : null,
    });
  }
  return res;
});
console.log(JSON.stringify(out,null,1));
await browser.close(); server.kill(); process.exit(0);
