import { describe, expect, it, beforeEach, vi } from 'vitest';
import { STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY } from '../src/constants.js';
import {
  resetVolatileStorageForTest,
  resetStorageAvailabilityCache,
  writeJSON,
} from '../src/safe-storage.js';
import {
  getSessionHistory,
  getWorkoutCompletion,
  persistSessionRecord,
} from '../src/storage.js';
import { mapCloudSprintSessionRow } from '../src/cloud-record-mapper.js';
import {
  getLatestSprintSessionForWorkout,
  pickAssignedSprintResultRecord,
} from '../src/sprint-session-access.js';

const mockUser = { id: 'user-a' };
const saveCloudSprintSession = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  saveCloudWorkoutCompletion: vi.fn(),
  saveCloudSprintSession: (...args) => saveCloudSprintSession(...args),
  saveCloudMileTest: vi.fn(),
  saveCloudProfile: vi.fn(),
  saveCloudHRInfo: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  archiveAndResetCamp: vi.fn(),
  clearAuthRedirectParams: vi.fn(),
  isPasswordRecoveryRedirect: vi.fn(() => false),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {},
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
  restCompleteAlert: vi.fn(),
  startRestLogAlert: vi.fn(),
  stopRestLogAlert: vi.fn(),
  syncHoldToCancelLabels: vi.fn(),
}));

vi.mock('../src/sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    enqueueSessionForSync: vi.fn(),
    flushSyncQueue: vi.fn(() => Promise.resolve({ dispatched: 0, status: 'idle' })),
    getAthleteProfile: vi.fn(() => ({ athleteName: 'Recovery Athlete', campLength: 7 })),
  };
});

import { cloudHydrationTestHooks } from '../src/shell.js';
import {
  cfg,
  finishSession,
  showSavedWorkoutResult,
  state,
} from '../src/app.js';

const SESSION_ID = 'w1-sprint-saved';
const INTERVALS = [
  { sprintHR: 172, restHR: 118, drop: 54, suspicious: false },
  { sprintHR: 175, restHR: 120, drop: 55, suspicious: false },
  { sprintHR: 178, restHR: 122, drop: 56, suspicious: false },
  { sprintHR: 180, restHR: 124, drop: 56, suspicious: false },
  { sprintHR: 176, restHR: 121, drop: 55, suspicious: false },
];

function buildSavedSprint(overrides = {}) {
  return {
    id: SESSION_ID,
    date: '2026-09-07T12:00:00.000Z',
    cfg: {
      reps: 5,
      rest: 90,
      maxHR: 183,
      targetPct: 90,
      workoutContext: { weekIndex: 0, workoutIndex: 0, workoutType: 'Sprint Intervals' },
    },
    data: INTERVALS,
    avgDrop: 55,
    peakHR: 180,
    ...overrides,
  };
}

function setupHomeDom() {
  document.body.innerHTML = `
    <div id="current-week-label"></div>
    <div id="current-week-focus"></div>
    <div id="header-athlete-name"></div>
    <button id="week-prev-btn"></button>
    <button id="week-next-btn"></button>
    <div id="week-workouts"></div>
    <div id="drawer-week-list"></div>
    <div id="detail-action-btn"></div>
    <div id="results-body"></div>
    <div id="results-date"></div>
    <div id="results-kicker">Session Complete</div>
    <div id="sprint-recovery-banner" hidden>
      <div class="sprint-recovery-kicker">SPRINT SAVED</div>
      <p id="sprint-recovery-banner-copy">Proof required to complete this workout.</p>
    </div>
    <div data-proof-host="sprint"></div>
    <button id="complete-workout-btn"></button>
    <button id="clear-result-completion-btn" hidden></button>
    <div id="sprint-completion-hints"></div>
  `;
}

function week1SprintCard() {
  return document.querySelector('.week-workout-card[data-week-index="0"][data-workout-index="0"]');
}

describe('sprint result recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    vi.clearAllMocks();
    saveCloudSprintSession.mockResolvedValue(undefined);
    cloudHydrationTestHooks.invalidateCloudHydration();
    setupHomeDom();
  });

  it('does not write workout_completions when a Sprint session is saved', async () => {
    cfg.reps = 5;
    cfg.rest = 90;
    cfg.maxHR = 183;
    cfg.targetPct = 90;
    cfg.workoutContext = { weekIndex: 0, workoutIndex: 0, workoutType: 'Sprint Intervals' };
    Object.assign(state, {
      phase: 'resting',
      currentRep: 5,
      data: INTERVALS,
      pendingRep: null,
      awaitingModal: false,
    });

    await finishSession();

    expect(getSessionHistory()[0]?.data).toHaveLength(5);
    expect(getSessionHistory()[0]?.cfg?.workoutContext).toMatchObject({ weekIndex: 0, workoutIndex: 0 });
    expect(getWorkoutCompletion(0, 0)).toBeNull();
  });

  it('renders Proof Needed / RESULTS for a saved Sprint without a final completion', () => {
    persistSessionRecord(buildSavedSprint());
    cloudHydrationTestHooks.renderShell();

    const card = week1SprintCard();
    expect(card.classList.contains('proof-needed')).toBe(true);
    expect(card.classList.contains('completed')).toBe(false);
    expect(card.querySelector('.workout-tag').textContent).toBe('Proof Needed');
    expect(card.querySelector('.workout-action').textContent).toBe('RESULTS');
  });

  it('keeps OPEN TIMER when no Sprint session or completion exists', () => {
    cloudHydrationTestHooks.renderShell();
    const card = week1SprintCard();
    expect(card.querySelector('.workout-tag').textContent).toBe('Timer Ready');
    expect(card.querySelector('.workout-action').textContent).toBe('OPEN TIMER');
  });

  it('renders Finish Save / RESULTS when proof exists but completion does not', () => {
    persistSessionRecord(buildSavedSprint({
      attachment: { id: 'attachment-1', storagePath: 'user/week1/proof.webp' },
      proofPolicyVersion: 1,
    }));
    cloudHydrationTestHooks.renderShell();

    const card = week1SprintCard();
    expect(card.classList.contains('finish-save')).toBe(true);
    expect(card.classList.contains('proof-needed')).toBe(false);
    expect(card.classList.contains('completed')).toBe(false);
    expect(card.querySelector('.workout-tag').textContent).toBe('Finish Save');
    expect(card.querySelector('.workout-action').textContent).toBe('RESULTS');
  });

  it('does not say proof is required when a saved Sprint already has an attachment', () => {
    const record = buildSavedSprint({
      attachment: { id: 'attachment-1', storagePath: 'user/week1/proof.webp' },
      proofPolicyVersion: 1,
    });
    showSavedWorkoutResult(record);
    expect(document.getElementById('results-kicker').textContent).toBe('SPRINT SAVED');
    expect(document.getElementById('sprint-recovery-banner').hidden).toBe(false);
    expect(document.getElementById('sprint-recovery-banner-copy').textContent)
      .toBe('Finish saving this workout to your account.');
    expect(document.getElementById('sprint-recovery-banner').textContent)
      .not.toMatch(/Proof required/i);
  });

  it('renders Done / RESULTS after a finalized Sprint completion', () => {
    const completed = {
      ...buildSavedSprint(),
      completedAt: '2026-09-07T13:00:00.000Z',
      completionKey: '0:0',
    };
    persistSessionRecord(completed);
    writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, { '0:0': completed });
    cloudHydrationTestHooks.renderShell();

    const card = week1SprintCard();
    expect(card.classList.contains('completed')).toBe(true);
    expect(card.querySelector('.workout-tag').textContent).toBe('Done');
    expect(card.querySelector('.workout-action').textContent).toBe('RESULTS');
  });

  it('opens workout detail as view-results for a pending-proof Sprint', () => {
    persistSessionRecord(buildSavedSprint());
    cloudHydrationTestHooks.openWorkoutDetail(0, 0);
    const action = document.getElementById('detail-action-btn');
    expect(action.dataset.action).toBe('view-results');
    expect(action.textContent).toBe('VIEW RESULTS');
    expect(action.disabled).toBe(false);
  });

  it('restores saved HR rows and pending-proof copy on Results', () => {
    const record = buildSavedSprint();
    showSavedWorkoutResult(record);
    expect(document.getElementById('results-kicker').textContent).toBe('SPRINT SAVED');
    expect(document.getElementById('sprint-recovery-banner').hidden).toBe(false);
    expect(document.getElementById('sprint-recovery-banner').textContent).toMatch(/Proof required to complete this workout/i);
    expect(document.querySelectorAll('.result-card')).toHaveLength(5);
    expect(document.querySelector('.result-card .result-hr-val').textContent).toMatch(/172/);
    expect(document.querySelector('.summary-val').textContent).toBe('55');
    expect(pickAssignedSprintResultRecord(null, record).id).toBe(SESSION_ID);
  });

  it('restores access from cloud sprint_sessions after local cache loss', async () => {
    const cloudSession = mapCloudSprintSessionRow({
      session_id: SESSION_ID,
      session_at: '2026-09-07T12:00:00.000Z',
      week_index: 0,
      workout_index: 0,
      session_json: buildSavedSprint(),
    });

    localStorage.removeItem(STORAGE_KEY);
    expect(getLatestSprintSessionForWorkout(getSessionHistory(), 0, 0)).toBeNull();

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [cloudSession] },
      mileResult: { ok: true, value: null },
    });

    const restored = getLatestSprintSessionForWorkout(getSessionHistory(), 0, 0);
    expect(restored?.id).toBe(SESSION_ID);
    expect(restored?.data).toEqual(INTERVALS);
    expect(getWorkoutCompletion(0, 0)).toBeNull();

    cloudHydrationTestHooks.renderShell();
    expect(week1SprintCard().querySelector('.workout-action').textContent).toBe('RESULTS');
  });

  it('clears Athlete A pending Sprint results when switching to Athlete B', () => {
    persistSessionRecord(buildSavedSprint());
    expect(getLatestSprintSessionForWorkout(getSessionHistory(), 0, 0)?.id).toBe(SESSION_ID);

    mockUser.id = 'user-b';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(getLatestSprintSessionForWorkout(getSessionHistory(), 0, 0)).toBeNull();
    expect(getSessionHistory()).toEqual([]);
  });
});
