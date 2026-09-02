import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd());
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const styleCss = readFileSync(join(root, 'src/style.css'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'));
const swJs = readFileSync(join(root, 'public/sw.js'), 'utf8');
const pwaJs = readFileSync(join(root, 'src/pwa.js'), 'utf8');

describe('ios shell contract', () => {
  it('includes viewport-fit=cover in the viewport meta tag', () => {
    expect(indexHtml).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
  });

  it('does not disable browser zoom in the viewport meta tag', () => {
    expect(indexHtml).not.toContain('user-scalable=no');
  });

  it('declares apple-mobile-web-app-capable', () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
  });

  it('points apple-touch-icon at the raster png asset', () => {
    expect(indexHtml).toMatch(/rel="apple-touch-icon"[^>]*href="\.\/apple-touch-icon\.png"/);
    expect(existsSync(join(root, 'public/apple-touch-icon.png'))).toBe(true);
  });

  it('includes png 192/512 icons in the manifest', () => {
    const pngIcons = manifest.icons.filter((icon) => icon.type === 'image/png');
    expect(pngIcons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(pngIcons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(pngIcons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('defines all four safe-area css variables and vh/dvh fallback', () => {
    expect(styleCss).toContain('--safe-top: env(safe-area-inset-top, 0px);');
    expect(styleCss).toContain('--safe-right: env(safe-area-inset-right, 0px);');
    expect(styleCss).toContain('--safe-bottom: env(safe-area-inset-bottom, 0px);');
    expect(styleCss).toContain('--safe-left: env(safe-area-inset-left, 0px);');
    expect(styleCss).toMatch(/#app\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100dvh;/s);
  });

  it('does not auto-activate the service worker during install', () => {
    const installBlock = swJs.match(/self\.addEventListener\('install'[\s\S]*?\n\}\);/)?.[0] || '';
    expect(installBlock).not.toContain('skipWaiting');
    expect(swJs).toContain("event.data?.type === 'SKIP_WAITING'");
  });

  it('exposes iOS install instructions in the welcome shell', () => {
    expect(indexHtml).toContain('id="install-btn"');
    expect(indexHtml).toContain('id="install-instructions"');
    expect(indexHtml).toContain('Add to Home Screen');
    expect(pwaJs).toContain('HOW TO INSTALL');
  });
});
