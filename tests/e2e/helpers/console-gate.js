const DEFAULT_ALLOWLIST = [
  /Service worker registration failed/i,
  /Service worker update check failed/i,
  /Could not persist active sprint session/i,
  /Could not write storage key/i,
  /Could not parse storage JSON/i,
];

export function attachConsoleGate(page, options = {}) {
  const allowlist = [...DEFAULT_ALLOWLIST, ...(options.allowlist || [])];
  const errors = [];

  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (allowlist.some((pattern) => pattern.test(text))) return;
    errors.push(`console.error: ${text}`);
  });

  return {
    assertClean() {
      if (errors.length > 0) {
        throw new Error(`Unexpected browser errors:\n${errors.join('\n')}`);
      }
    },
    getErrors() {
      return [...errors];
    },
  };
}
