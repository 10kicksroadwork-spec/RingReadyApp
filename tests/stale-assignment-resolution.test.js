import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetVolatileStorageForTest, resetStorageAvailabilityCache } from '../src/safe-storage.js';
import { getWorkoutCompletion, getWorkoutCompletions, persistWorkoutCompletion } from '../src/storage.js';

const mockUser = { id: 'user-stale' };
const showToast = vi.fn();
const showScreen = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  saveCloudWorkoutCompletion: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  saveCloudMileTest: vi.fn(),
  saveCloudAssignedMileResult: vi.fn(),
  skipCloudAssignedMile: vi.fn(),
  clearCloudAssignedMileWithProof: vi.fn(),
  saveCloudHRInfo: vi.fn(),
  saveCloudProfile: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  archiveAndResetCamp: vi.fn(),
  clearAuthRedirectParams: vi.fn(),
  isPasswordRecoveryRedirect: vi.fn(() => false),
  loadCoachRosterPayload: vi.fn(),
  saveCoachCampStartDate: vi.fn(),
  saveCoachNote: vi.fn(),
  saveCoachNotificationClear: vi.fn(),
  restoreCoachNotificationClear: vi.fn(),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: false,
  supabase: {},
}));

vi.mock('../src/ui.js', () => ({
  showScreen: (...args) => showScreen(...args),
  setStatus: vi.fn(),
  setTimerDisplay: vi.fn(),
  setMainBtn: vi.fn(),
  resetChips: vi.fn(),
  setRing: vi.fn(),
  showToast: (...args) => showToast(...args),
  showExportModal: vi.fn(),
  closeExportModal: vi.fn(),
  vibrate: vi.fn(),
  unlockAudio: vi.fn(),
  restCompleteAlert: vi.fn(),
  startRestLogAlert: vi.fn(),
  stopRestLogAlert: vi.fn(),
  syncHoldToCancelLabels: vi.fn(),
}));

vi.mock('../src/coach-preview.js', () => ({
  canAccessCoachScreens: vi.fn(() => false),
  initCoachPreview: vi.fn(),
  isCoachScreen: vi.fn(() => false),
  openCoachPreviewIfRequested: vi.fn(),
  refreshCoachPreview: vi.fn(),
  renderCoachPage: vi.fn(),
  setSelectedCoachAthlete: vi.fn(),
  syncCoachPreviewChrome: vi.fn(),
}));

vi.mock('../src/sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    enqueueSessionForSync: vi.fn(),
    flushSyncQueue: vi.fn(() => Promise.resolve({ dispatched: 0, status: 'idle' })),
    getAthleteProfile: vi.fn(() => ({ athleteName: 'Stale Tab Athlete', campLength: '7' })),
  };
});

import { completeWorkoutFromDetail, cloudHydrationTestHooks } from '../src/shell.js';
import { getAthleteProfile } from '../src/sync.js';

function setupShellDom() {
  document.body.innerHTML = `
    <div id="home" class="screen active"></div>
    <div id="workout-detail" class="screen"></div>
    <div id="current-week-label"></div>
    <div id="current-week-focus"></div>
    <div id="header-athlete-name"></div>
    <button id="week-prev-btn"></button>
    <button id="week-next-btn"></button>
    <div id="week-workouts"></div>
    <div id="drawer-week-list"></div>
    <div id="profile-dashboard"></div>
    <div id="toast"></div>
    <button id="detail-action-btn" data-week-index="3" data-workout-index="4" data-action="complete-workout"></button>
    <button id="detail-skip-confirm-btn"></button>
    <button id="detail-clear-completion-btn" data-week-index="3" data-workout-index="4"></button>
    <select id="detail-skip-reason-select"><option value="travel">Travel</option></select>
    <input id="detail-skip-reason-detail" />
    <input id="detail-skip-approved-check" type="checkbox" />
    <div id="detail-skip-card" hidden></div>
    <div id="detail-log-card"></div>
    <div data-proof-host="detail"></div>
  `;
}

describe('stale retired assignment resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    vi.clearAllMocks();
    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '7' });
    setupShellDom();
    cloudHydrationTestHooks.setShellHooksForTest({ showToast, showScreen });
    cloudHydrationTestHooks.seedAthleteRuntimeStateForTest({ activeWeekIndex: 3 });
    window.confirm = vi.fn(() => true);
  });

  it('resolves Week 4:4 under 7-week camp and rejects it after camp becomes 4', () => {
    expect(cloudHydrationTestHooks.resolveVisibleAssignment(3, 4)?.workout.type).toMatch(/Long Run/i);

    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });

    expect(cloudHydrationTestHooks.resolveVisibleAssignment(3, 4)).toBeNull();
    expect(cloudHydrationTestHooks.resolveVisibleAssignment(5, 0)).toBeNull();
    expect(cloudHydrationTestHooks.resolveVisibleAssignment(3, 0)?.workout.type).toMatch(/Sprint/i);
  });

  it('rejects Complete for retired Week 4:4 without creating a completion or Sprint alias', async () => {
    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });

    await completeWorkoutFromDetail(3, 4);

    expect(showToast).toHaveBeenCalledWith('WORKOUT NO LONGER ASSIGNED');
    expect(getWorkoutCompletion(3, 4)).toBeFalsy();
    expect(getWorkoutCompletion(3, 0)).toBeFalsy();
    expect(Object.keys(getWorkoutCompletions())).toHaveLength(0);
    expect(showScreen).toHaveBeenCalledWith('home');
  });

  it('rejects Complete for a later-week stale assignment without substituting Week 4', async () => {
    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });

    await completeWorkoutFromDetail(5, 3);

    expect(showToast).toHaveBeenCalledWith('WORKOUT NO LONGER ASSIGNED');
    expect(getWorkoutCompletion(5, 3)).toBeFalsy();
    expect(getWorkoutCompletion(3, 3)).toBeFalsy();
    expect(Object.keys(getWorkoutCompletions())).toHaveLength(0);
  });

  it('rejects Skip for a retired assignment without creating a skipped record', async () => {
    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });
    document.getElementById('detail-action-btn').dataset.weekIndex = '3';
    document.getElementById('detail-action-btn').dataset.workoutIndex = '4';
    document.getElementById('detail-skip-reason-select').value = 'travel';
    document.getElementById('detail-skip-approved-check').checked = true;

    await cloudHydrationTestHooks.confirmSkipWorkoutFromDetail();

    expect(showToast).toHaveBeenCalledWith('WORKOUT NO LONGER ASSIGNED');
    expect(getWorkoutCompletion(3, 4)).toBeFalsy();
    expect(getWorkoutCompletion(3, 0)).toBeFalsy();
    expect(Object.keys(getWorkoutCompletions())).toHaveLength(0);
  });

  it('rejects Clear for a retired assignment without wrong-type transition', async () => {
    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });
    persistWorkoutCompletion({
      id: 'stale-skip',
      completionKey: '3:4',
      status: 'skipped',
      completedAt: '2026-10-03T12:00:00.000Z',
      updatedAt: '2026-10-03T12:00:00.000Z',
      workoutContext: {
        weekIndex: 3,
        workoutIndex: 4,
        workoutType: 'Long Run + S&C',
        dayOfWeek: 'Saturday/Sunday',
      },
      cfg: { workoutContext: { weekIndex: 3, workoutIndex: 4 } },
      workoutLog: { skipReason: 'travel', skipReasonLabel: 'Travel', completedAt: '2026-10-03T12:00:00.000Z' },
    });

    await cloudHydrationTestHooks.clearCompletionFromDetail(3, 4);

    expect(showToast).toHaveBeenCalledWith('WORKOUT NO LONGER ASSIGNED');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(getWorkoutCompletion(3, 4)?.id).toBe('stale-skip');
    expect(getWorkoutCompletion(3, 4)?.status).toBe('skipped');
  });

  it('keeps historical 3:4 untouched when booting/rendering as 4-week', () => {
    persistWorkoutCompletion({
      id: 'historical-w4-long',
      completionKey: '3:4',
      completedAt: '2026-10-03T12:00:00.000Z',
      updatedAt: '2026-10-03T12:00:00.000Z',
      workoutContext: {
        weekIndex: 3,
        workoutIndex: 4,
        workoutType: 'Long Run + S&C',
        dayOfWeek: 'Saturday/Sunday',
      },
      cfg: { workoutContext: { weekIndex: 3, workoutIndex: 4 } },
      workoutLog: {
        totalMinutes: 45,
        avgBpm: 137,
        distance: 5.2,
        completedAt: '2026-10-03T12:00:00.000Z',
      },
    });

    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });
    cloudHydrationTestHooks.renderShell();

    expect(getWorkoutCompletion(3, 4)?.id).toBe('historical-w4-long');
    expect(cloudHydrationTestHooks.resolveVisibleAssignment(3, 4)).toBeNull();
    expect(document.querySelector('.week-workout-card[data-workout-index="4"]')).toBeNull();
  });

  it('does not alias cacheAssignedMileCompletion onto a substituted week after camp shrink', () => {
    getAthleteProfile.mockReturnValue({ athleteName: 'Stale Tab Athlete', campLength: '4' });
    cloudHydrationTestHooks.cacheAssignedMileCompletion({
      id: 'mile-stale',
      testKey: 'program:7:5:3',
      savedAt: '2026-10-10T12:00:00.000Z',
      distance: 1,
      totalMinutes: 7,
      avgBpm: 180,
      maxBpm: 190,
    });
    expect(getWorkoutCompletion(5, 3)).toBeFalsy();
    expect(getWorkoutCompletion(3, 3)).toBeFalsy();
  });
});
