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
      try {
        let contents = readFileSync(swPath, 'utf8');
        contents = contents.replace(/__BUILD_ID__/g, buildId);
        writeFileSync(swPath, contents);
      } catch (error) {
        console.warn('Could not patch service worker build id', error);
      }
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
