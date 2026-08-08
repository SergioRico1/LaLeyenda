import sharp from 'sharp';
const [file, ...rest] = process.argv.slice(2);
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i+1], data[i+2]]; };
for (const spec of rest) {
  const [x1, y, x2] = spec.split(',').map(Number);
  const row = [];
  for (let x = x1; x <= (x2 ?? x1); x++) row.push(`${x}:${at(x, y).join('/')}`);
  console.log(`y=${y}`, row.join(' '));
}
