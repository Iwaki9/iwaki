// Рендер кадров сцены в PNG.
//   node src/render.mjs --out /tmp/frames --fps 30 --w 1280 --h 720
//   node src/render.mjs --times 0.5,1.9,2.0 --out /tmp/stills
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// scene.js — классический UMD-скрипт (он же грузится в браузер), поэтому
// подгружаем его в изолированный контекст, а не через import.
const scenePath = new URL('./scene.js', import.meta.url);
const sandbox = { module: { exports: {} }, console };
sandbox.exports = sandbox.module.exports;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(scenePath, 'utf8'), sandbox, { filename: 'scene.js' });
const scene = sandbox.module.exports;

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};

const W = parseInt(get('w', 1280), 10);
const H = parseInt(get('h', 720), 10);
const fps = parseFloat(get('fps', 30));
const outDir = get('out', '/tmp/frames');
const timesArg = get('times', null);
const duration = parseFloat(get('duration', scene.DURATION));

fs.mkdirSync(outDir, { recursive: true });

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const times = timesArg
  ? timesArg.split(',').map(Number)
  : Array.from({ length: Math.round(duration * fps) }, (_, i) => i / fps);

let i = 0;
for (const t of times) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(W / scene.W, H / scene.H);
  scene.drawFrame(ctx, t);
  const file = path.join(outDir, `${timesArg ? 'still' : 'frame'}_${String(i).padStart(4, '0')}.png`);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  i++;
  if (i % 30 === 0) process.stdout.write(`\r${i}/${times.length}`);
}

// позиция кончика клюва в момент удара — для калибровки
for (const pk of scene.PECKS) {
  const st = scene.chickenState(pk.impact);
  const bw = scene.beakWorld(st);
  console.log(
    `peck @${pk.impact.toFixed(2)}s  beak=(${bw.x.toFixed(0)}, ${bw.y.toFixed(0)})`,
    `grain=${pk.grain ? `(${pk.grain.x.toFixed(0)}, ${pk.grain.y.toFixed(0)})` : 'нет'}`
  );
}
console.log(`\n${i} кадров → ${outDir}`);
