import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isCurrentSkipWaitingMessage,
  SW_ACTIVATION_PROTOCOL,
  SW_SKIP_WAITING_MESSAGE_TYPE,
} from '../src/pwa-activation-protocol.js';

const root = join(process.cwd());
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const styleCss = readFileSync(join(root, 'src/style.css'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'));
const swJs = readFileSync(join(root, 'public/sw.js'), 'utf8');
const pwaJs = readFileSync(join(root, 'src/pwa.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function selectorUsesHorizontalSafeArea(selectorPattern) {
  const match = styleCss.match(selectorPattern);
  expect(match, `Expected selector ${selectorPattern}`).toBeTruthy();
  const block = match[0];
  expect(block).toMatch(/var\(--safe-left\)/);
  expect(block).toMatch(/var\(--safe-right\)/);
}

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

  it('applies horizontal safe areas on critical edge surfaces', () => {
    selectorUsesHorizontalSafeArea(/\.boot-screen\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.auth-screen\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.setup-header\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.home-header,\s*\.detail-header\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.page-header\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.session-top\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.results-header\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.main-btn-wrap\s*\{[\s\S]*?\}/);
    selectorUsesHorizontalSafeArea(/\.results-actions\s*\{[\s\S]*?\}/);
  });

  it('does not auto-activate the service worker during install', () => {
    const installBlock = swJs.match(/self\.addEventListener\('install'[\s\S]*?\n\}\);/)?.[0] || '';
    expect(installBlock).not.toContain('skipWaiting');
  });

  it('ignores legacy Charlie skip-waiting messages in the service worker', () => {
    expect(swJs).toContain('SW_SKIP_WAITING_MESSAGE_TYPE');
    expect(swJs).toContain('SW_ACTIVATION_PROTOCOL');
    expect(swJs).not.toMatch(/type === 'SKIP_WAITING'/);
    expect(isCurrentSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(false);
  });

  it('caches boot branding logo in the offline shell', () => {
    expect(swJs).toContain('./10-kicks-logo.jpg');
  });

  it('uses ringready:screen-changed instead of a body MutationObserver', () => {
    expect(pwaJs).toContain('ringready:screen-changed');
    expect(pwaJs).not.toContain('MutationObserver');
    expect(pwaJs).toContain('buildSkipWaitingMessage');
  });

  it('posts skip-waiting directly to the waiting worker without rediscovering it', () => {
    expect(pwaJs).toContain('waitingServiceWorker');
    expect(pwaJs).toContain('postSkipWaitingToWorker');
    expect(pwaJs).toContain('clearWaitingServiceWorker');
    expect(pwaJs).not.toMatch(/navigator\.serviceWorker\.ready[\s\S]*buildSkipWaitingMessage/);
  });

  it('declines live activation when more than one window client is open', () => {
    const messageBlock = swJs.match(/self\.addEventListener\('message'[\s\S]*?\n\}\);/)?.[0] || '';
    expect(messageBlock).toContain('clients.matchAll');
    expect(messageBlock).toContain('clients.length !== 1');
  });

  it('keeps client and service worker activation protocol constants aligned', () => {
    expect(swJs).toContain(`const SW_ACTIVATION_PROTOCOL = ${SW_ACTIVATION_PROTOCOL};`);
    expect(swJs).toContain(`const SW_SKIP_WAITING_MESSAGE_TYPE = '${SW_SKIP_WAITING_MESSAGE_TYPE}';`);
  });

  it('exposes browser-neutral iOS install instructions in the welcome shell', () => {
    expect(indexHtml).toContain('id="install-btn"');
    expect(indexHtml).toContain('id="install-instructions"');
    expect(indexHtml).toContain('Add to Home Screen');
    expect(indexHtml).toContain("Tap your browser's Share button.");
    expect(indexHtml).not.toContain("Tap Safari's Share button.");
    expect(pwaJs).toContain('HOW TO INSTALL');
  });

  it('includes an npm script to regenerate pwa icons', () => {
    expect(packageJson.scripts['generate:pwa-icons']).toBe('node scripts/generate-pwa-icons.mjs');
  });
});
