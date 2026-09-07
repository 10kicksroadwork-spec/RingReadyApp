import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/ui.js', () => ({
  showScreen: vi.fn(),
  setStatus: vi.fn(),
  setTimerDisplay: vi.fn(),
  setMainBtn: vi.fn(),
  resetChips: vi.fn(),
  setRing: vi.fn(),
  showToast: vi.fn(),
  showExportModal: vi.fn(),
  closeExportModal: vi.fn(),
  vibrate: vi.fn(),
  unlockAudio: vi.fn(),
  recoverAudioAfterBackground: vi.fn(),
  restCompleteAlert: vi.fn(),
  startRestLogAlert: vi.fn(),
  stopRestLogAlert: vi.fn(),
  syncHoldToCancelLabels: vi.fn(),
  withSavingButton: vi.fn(async (_el, fn) => fn()),
}));

import { showScreen, showToast } from '../src/ui.js';
import {
  restoreActiveSprintScreenIfPresent,
  resetSprintRuntimeForAccountBoundary,
  tryAutoResumeActiveSession,
  state,
} from '../src/app.js';
import {
  doesActiveSprintOwnNavigation,
  setActiveSprintOwnsNavigation,
} from '../src/sprint-navigation.js';

describe('active sprint foreground authority', () => {
  beforeEach(() => {
    showScreen.mockClear();
    showToast.mockClear();
    resetSprintRuntimeForAccountBoundary();
  });

  afterEach(() => {
    setActiveSprintOwnsNavigation(false);
    resetSprintRuntimeForAccountBoundary();
  });

  it('restores the session screen without a second resume toast when the Sprint is already in memory', () => {
    state.phase = 'sprinting';
    state.currentRep = 1;

    expect(restoreActiveSprintScreenIfPresent()).toBe(true);
    expect(showScreen).toHaveBeenCalledWith('session');
    expect(showToast).not.toHaveBeenCalled();
    expect(doesActiveSprintOwnNavigation()).toBe(true);
  });

  it('does not re-toast when auto-resume is asked again for an already-owned Sprint', () => {
    state.phase = 'manual-entry';
    state.currentRep = 1;
    setActiveSprintOwnsNavigation(true);

    expect(tryAutoResumeActiveSession()).toBe(true);
    expect(showScreen).toHaveBeenCalledWith('session');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('releases navigation ownership on account-boundary reset', () => {
    setActiveSprintOwnsNavigation(true);
    state.phase = 'sprinting';
    resetSprintRuntimeForAccountBoundary();
    expect(doesActiveSprintOwnNavigation()).toBe(false);
    expect(state.phase).toBe('idle');
  });
});
