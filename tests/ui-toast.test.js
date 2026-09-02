import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { showToast } from '../src/ui.js';

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast"></div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let an earlier hide timer remove a newer toast', () => {
    showToast('SHORT MESSAGE');
    vi.advanceTimersByTime(2000);
    showToast(
      'RING READY UPDATED — REOPEN OR REFRESH BEFORE SUBMITTING A WORKOUT',
      { readable: true },
    );

    vi.advanceTimersByTime(500);
    expect(document.getElementById('toast').classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(document.getElementById('toast').classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(2500);
    expect(document.getElementById('toast').classList.contains('show')).toBe(false);
  });
});
