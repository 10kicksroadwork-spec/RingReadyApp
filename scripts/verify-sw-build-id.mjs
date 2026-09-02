import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

function resolveBuildSha() {
  const fromCi = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

const buildSha = resolveBuildSha();
const swPath = 'dist/sw.js';

let swContents;
try {
  swContents = readFileSync(swPath, 'utf8');
} catch (error) {
  console.error(`FAIL: could not read ${swPath}: ${error.message}`);
  process.exit(1);
}

if (swContents.includes('__BUILD_ID__')) {
  console.error('FAIL: dist/sw.js still contains __BUILD_ID__ placeholder');
  process.exit(1);
}

const buildIdPattern = new RegExp(`const BUILD_ID = ['"]${buildSha}['"]`);
if (!buildIdPattern.test(swContents)) {
  console.error(`FAIL: dist/sw.js missing injected BUILD_ID ${buildSha}`);
  process.exit(1);
}

if (!swContents.includes('ring-ready-shell-${BUILD_ID}')) {
  console.error('FAIL: dist/sw.js missing versioned cache name template');
  process.exit(1);
}

const sourceSw = readFileSync('public/sw.js', 'utf8');
if (!sourceSw.includes("pathname.startsWith('/api/')")) {
  console.error('FAIL: public/sw.js must bypass /api/* from service worker caching');
  process.exit(1);
}

console.log(`PASS: service worker build id ${buildSha}`);
