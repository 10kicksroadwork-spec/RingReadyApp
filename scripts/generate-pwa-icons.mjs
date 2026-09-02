import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const sourceSvg = join(publicDir, 'app-icon.svg');
const maskableSvg = join(publicDir, 'maskable-icon.svg');

const targets = [
  { input: sourceSvg, output: 'apple-touch-icon.png', size: 180 },
  { input: sourceSvg, output: 'icon-192.png', size: 192 },
  { input: sourceSvg, output: 'icon-512.png', size: 512 },
  { input: maskableSvg, output: 'icon-maskable-512.png', size: 512 },
];

for (const target of targets) {
  const svg = readFileSync(target.input);
  const png = await sharp(svg)
    .resize(target.size, target.size, { fit: 'cover' })
    .png()
    .toBuffer();

  writeFileSync(join(publicDir, target.output), png);
  console.log(`Wrote ${target.output} (${target.size}x${target.size})`);
}
