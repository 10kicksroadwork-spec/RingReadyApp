import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function resolveBuildSha() {
  const fromCi = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

function injectServiceWorkerBuildId(buildId) {
  return {
    name: 'inject-sw-build-id',
    closeBundle() {
      const swPath = resolve('dist/sw.js');
      let contents;
      try {
        contents = readFileSync(swPath, 'utf8');
      } catch (error) {
        throw new Error(`Service worker not found at ${swPath}: ${error.message}`);
      }

      if (!contents.includes('__BUILD_ID__')) {
        throw new Error('Service worker missing __BUILD_ID__ placeholder before injection');
      }

      const patched = contents.replace(/__BUILD_ID__/g, buildId);
      if (patched.includes('__BUILD_ID__')) {
        throw new Error('Service worker build id injection incomplete: __BUILD_ID__ remains');
      }

      writeFileSync(swPath, patched);
    },
  };
}

export default defineConfig(({ mode }) => {
  const buildSha = resolveBuildSha();
  const buildTime = new Date().toISOString();

  return {
    base: './',
    define: {
      'import.meta.env.VITE_APP_BUILD_SHA': JSON.stringify(buildSha),
      'import.meta.env.VITE_APP_BUILD_TIME': JSON.stringify(buildTime),
    },
    plugins: mode === 'production' ? [injectServiceWorkerBuildId(buildSha)] : [],
  };
});
