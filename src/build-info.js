/** Build metadata injected at compile time for deploy diagnostics. */

export const APP_BUILD_SHA = String(import.meta.env.VITE_APP_BUILD_SHA || 'dev');
export const APP_BUILD_TIME = String(import.meta.env.VITE_APP_BUILD_TIME || '');

/** Bump when the athlete proof write contract changes (RPC-only attachments). */
export const PROOF_CONTRACT_VERSION = 2;

export function formatBuildLabel() {
  if (!APP_BUILD_SHA || APP_BUILD_SHA === 'dev') return 'dev';
  return APP_BUILD_SHA.slice(0, 7);
}

export function renderBuildInfo(host = document.getElementById('drawer-build-info')) {
  if (!host) return;
  host.textContent = `Build ${formatBuildLabel()} · proof v${PROOF_CONTRACT_VERSION}`;
  if (APP_BUILD_TIME) {
    host.title = `Built ${APP_BUILD_TIME} (${APP_BUILD_SHA})`;
  }
}
