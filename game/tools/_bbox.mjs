import sharp from 'sharp';
// _bbox.mjs <img> <x> <y> <w> <h> <mode:ink|nonbg> [bgHex]
const [,, src, X, Y, W, H, mode='ink'] = process.argv;
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const px=(x,y)=>{const i=(y*info.width+x)*4;return [data[i],data[i+1],data[i+2]];};
let minX=1e9,minY=1e9,maxX=-1,maxY=-1,count=0;
for(let y=+Y;y<+Y+ +H;y++)for(let x=+X;x<+X+ +W;x++){
  const [r,g,b]=px(x,y); const L=0.299*r+0.587*g+0.114*b;
  const hit = mode==='ink' ? (L<70) : (L>=70);
  if(hit){count++; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;}
}
console.log(JSON.stringify({minX,minY,maxX,maxY,w:maxX-minX+1,h:maxY-minY+1,count}));
