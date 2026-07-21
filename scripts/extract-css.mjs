import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.join(__dirname, '..', '..', 'sprint-trainer.html'),
  path.join(__dirname, '..', 'sprint-trainer.html'),
];

const htmlPath = candidates.find((p) => fs.existsSync(p));
if (!htmlPath) {
  throw new Error(`Could not find sprint-trainer.html. Tried:\n${candidates.join('\n')}`);
}
const outPath = path.join(__dirname, '..', 'src', 'style.css');

const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('<style>') + 7;
const end = html.indexOf('</style>');
if (start < 7 || end < 0) throw new Error('Could not find style block');

fs.writeFileSync(outPath, html.slice(start, end).trim());
console.log('Wrote style.css', fs.statSync(outPath).size, 'bytes');
