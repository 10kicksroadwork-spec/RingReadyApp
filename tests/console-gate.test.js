import { describe, expect, it } from 'vitest';
import { attachConsoleGate } from './e2e/helpers/console-gate.js';

function createFakePage() {
  const handlers = new Map();
  return {
    on(event, handler) {
      const list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
    },
    emit(event, payload) {
      (handlers.get(event) || []).forEach((handler) => handler(payload));
    },
  };
}

describe('browser console gate', () => {
  it('fails healthy tests when checkpoint persistence errors are logged', () => {
    const page = createFakePage();
    const gate = attachConsoleGate(page);

    page.emit('console', {
      type: () => 'error',
      text: () => 'Could not persist active sprint session',
    });

    expect(() => gate.assertClean()).toThrow(/Could not persist active sprint session/i);
  });

  it('allows only explicitly allowlisted errors in failure-injection tests', () => {
    const page = createFakePage();
    const gate = attachConsoleGate(page, {
      allowlist: [/Could not write storage key/i],
    });

    page.emit('console', {
      type: () => 'error',
      text: () => 'Could not write storage key ringReadyAthleteProfile',
    });

    expect(() => gate.assertClean()).not.toThrow();
  });
});
