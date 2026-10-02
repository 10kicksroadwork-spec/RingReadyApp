import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROGRAM,
  getProgramForCampLength,
  getWeekForCampLength,
  normalizeCampLength,
} from '../src/program.js';
import { buildAthleteRecord, liveAthleteConfig } from '../src/coach-preview.js';
import { resetVolatileStorageForTest, resetStorageAvailabilityCache } from '../src/safe-storage.js';
import { getWorkoutCompletion, persistWorkoutCompletion } from '../src/storage.js';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => ({ id: 'user-4wk' })),
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
  isSupabaseConfigured: true,
  supabase: {},
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
    getAthleteProfile: vi.fn(() => ({ athleteName: 'Four Week Fighter', campLength: '4' })),
  };
});

import { cloudHydrationTestHooks } from '../src/shell.js';
import { getAthleteProfile } from '../src/sync.js';

/** Week 4 Monday = 2026-09-28 when camp starts 2026-09-07. */
const CAMP_START = '2026-09-07';

function atLocalMorning(isoDate) {
  return new Date(`${isoDate}T08:00:00`);
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
  `;
}

describe('normalizeCampLength', () => {
  it('treats 4 / "4" as four-week and everything else as seven-week', () => {
    expect(normalizeCampLength(4)).toBe(4);
    expect(normalizeCampLength('4')).toBe(4);
    expect(normalizeCampLength(7)).toBe(7);
    expect(normalizeCampLength('7')).toBe(7);
    expect(normalizeCampLength(undefined)).toBe(7);
    expect(normalizeCampLength(null)).toBe(7);
  });
});

describe('getProgramForCampLength', () => {
  it('returns the shared PROGRAM reference for the 7-week camp', () => {
    expect(getProgramForCampLength(7)).toBe(PROGRAM);
    expect(getProgramForCampLength('7')).toBe(PROGRAM);
  });

  it('does not mutate PROGRAM when building the 4-week schedule', () => {
    const week4Before = PROGRAM[3].workouts.map((w) => w.type);
    const fourWeek = getProgramForCampLength(4);
    expect(fourWeek[3].workouts).toHaveLength(4);
    expect(PROGRAM[3].workouts.map((w) => w.type)).toEqual(week4Before);
    expect(PROGRAM[3].workouts).toHaveLength(5);
    expect(PROGRAM[3].workouts[4].type).toBe('Long Run + S&C');
  });

  it('4-week Week 4 has exactly Mon–Thu workouts and no weekend Long Run', () => {
    const fourWeek = getProgramForCampLength(4);
    expect(fourWeek).toHaveLength(4);

    const week4 = fourWeek[3];
    expect(week4.workouts).toHaveLength(4);
    expect(week4.workouts.map((w) => w.day)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
    ]);
    expect(week4.workouts.some((w) => /saturday/i.test(w.day))).toBe(false);
    expect(week4.workouts.some((w) => /long run/i.test(w.type))).toBe(false);

    // Indices 0–3 unchanged relative to shared PROGRAM.
    for (let i = 0; i < 4; i += 1) {
      expect(week4.workouts[i]).toBe(PROGRAM[3].workouts[i]);
      expect(week4.workouts[i].type).toBe(PROGRAM[3].workouts[i].type);
    }
  });

  it('7-week Week 4 still contains the 45-min Long Run + S&C', () => {
    const sevenWeek = getProgramForCampLength(7);
    const week4 = sevenWeek[3];
    expect(week4.workouts).toHaveLength(5);
    const weekend = week4.workouts[4];
    expect(weekend.day).toBe('Saturday/Sunday');
    expect(weekend.type).toBe('Long Run + S&C');
    expect(weekend.description).toMatch(/45 min/i);
  });

  it('keeps Weeks 1–3 identical between 4-week and 7-week templates', () => {
    const fourWeek = getProgramForCampLength(4);
    const sevenWeek = getProgramForCampLength(7);
    for (let i = 0; i < 3; i += 1) {
      expect(fourWeek[i]).toBe(sevenWeek[i]);
      expect(fourWeek[i].workouts).toHaveLength(5);
      expect(fourWeek[i].workouts[4].type).toBe('Long Run + S&C');
    }
  });

  it('getWeekForCampLength reads from the camp-specific program', () => {
    expect(getWeekForCampLength(4, 3).workouts).toHaveLength(4);
    expect(getWeekForCampLength(7, 3).workouts).toHaveLength(5);
  });
});

describe('coach schedule for 4-week final week', () => {
  it('does not expect or mark Week 4 weekend Long Run missing for a 4-week athlete', () => {
    // Monday after Week 4 weekend (camp started Sep 7 → Week 4 weekend is Oct 3–4).
    const athlete = buildAthleteRecord({
      id: 'four-week',
      name: 'Four Week Fighter',
      campLength: 4,
      currentWeekIndex: 3,
      campStartDate: CAMP_START,
      now: atLocalMorning('2026-10-05'),
      missing: ['3:0', '3:1', '3:2', '3:3'],
      skipped: [],
      missingProofs: [],
    });

    expect(athlete.sessions.some((s) => s.key === '3:4')).toBe(false);
    expect(athlete.sessions.filter((s) => s.weekIndex === 3)).toHaveLength(4);
    expect(athlete.sessions.some((s) => s.weekIndex === 3 && /long run/i.test(s.type))).toBe(false);
    expect(athlete.sessions.some((s) => s.key === '3:4' && s.status === 'missing')).toBe(false);
  });

  it('still expects Week 4 weekend Long Run for a 7-week athlete', () => {
    const athlete = buildAthleteRecord({
      id: 'seven-week',
      name: 'Seven Week Fighter',
      campLength: 7,
      currentWeekIndex: 3,
      campStartDate: CAMP_START,
      now: atLocalMorning('2026-10-05'),
      missing: ['3:4'],
      skipped: [],
      missingProofs: [],
    });

    const weekend = athlete.sessions.find((s) => s.key === '3:4');
    expect(weekend).toBeTruthy();
    expect(weekend.type).toMatch(/Long Run/i);
    expect(weekend.status).toBe('missing');
  });

  it('liveAthleteConfig does not put Week 4:4 in missing for a 4-week athlete', () => {
    const profile = {
      athlete_name: 'Four Week Fighter',
      camp_length: 4,
      fight_date: '2026-10-04',
      training_tenure: '1-3 years',
    };
    const config = liveAthleteConfig(
      profile,
      { max_hr: 190, resting_hr: 55 },
      [
        // Mon–Thu completed; no weekend row (and none should be expected).
        { week_index: 3, workout_index: 0, completed_at: '2026-09-28T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 160 } } },
        { week_index: 3, workout_index: 1, completed_at: '2026-09-29T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 136 } } },
        { week_index: 3, workout_index: 2, completed_at: '2026-09-30T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 150 } } },
        { week_index: 3, workout_index: 3, completed_at: '2026-10-01T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 130 } } },
      ],
      [],
      [],
      '',
      'fighter@example.com',
      CAMP_START,
      [],
      null,
      null,
      null,
      atLocalMorning('2026-10-05'),
    );

    expect(config.missing).not.toContain('3:4');
    expect(config.campLength).toBe(4);

    const athlete = buildAthleteRecord(config);
    expect(athlete.sessions.some((s) => s.key === '3:4')).toBe(false);
  });

  it('preserves a historical 4-week Week 4:4 completion without treating it as an expected miss', () => {
    const historical = {
      week_index: 3,
      workout_index: 4,
      completed_at: '2026-10-03T12:00:00.000Z',
      record_json: {
        workoutLog: {
          totalMinutes: 45,
          avgBpm: 137,
          distance: 5.2,
        },
        workoutContext: { weekIndex: 3, workoutIndex: 4, workoutType: 'Long Run + S&C' },
      },
    };
    const profile = {
      athlete_name: 'Legacy Four Week',
      camp_length: 4,
      fight_date: '2026-10-04',
      training_tenure: '1-3 years',
    };
    const config = liveAthleteConfig(
      profile,
      { max_hr: 190, resting_hr: 55 },
      [
        { week_index: 3, workout_index: 0, completed_at: '2026-09-28T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 160 } } },
        { week_index: 3, workout_index: 1, completed_at: '2026-09-29T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 136 } } },
        { week_index: 3, workout_index: 2, completed_at: '2026-09-30T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 150 } } },
        { week_index: 3, workout_index: 3, completed_at: '2026-10-01T12:00:00.000Z', record_json: { workoutLog: { avgBpm: 130 } } },
        historical,
      ],
      [],
      [],
      '',
      'legacy@example.com',
      CAMP_START,
      [],
      null,
      null,
      null,
      atLocalMorning('2026-10-05'),
    );

    // Historical row is not deleted from the input set; schedule simply ignores it.
    expect(config.missing).not.toContain('3:4');
    const athlete = buildAthleteRecord(config);
    expect(athlete.sessions.some((s) => s.key === '3:4')).toBe(false);
    expect(athlete.sessions.some((s) => s.key === '3:4' && s.status === 'missing')).toBe(false);
    // Week 4 Mon–Thu were provided — none of those should be missing either.
    expect(config.missing.filter((key) => key.startsWith('3:'))).toEqual([]);
  });
});

describe('athlete UI Week 4 cards for 4-week camp', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    vi.clearAllMocks();
    getAthleteProfile.mockReturnValue({ athleteName: 'Four Week Fighter', campLength: '4' });
    setupHomeDom();
    cloudHydrationTestHooks.seedAthleteRuntimeStateForTest({ activeWeekIndex: 3 });
  });

  it('renders no final weekend Long Run card for a 4-week profile', () => {
    cloudHydrationTestHooks.renderShell();

    const cards = [...document.querySelectorAll('.week-workout-card')];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.querySelector('.week-card-day')?.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
    ]);
    expect(cards.some((card) => /Long Run/i.test(card.querySelector('.week-card-title')?.textContent || ''))).toBe(false);
    expect(document.querySelector('.week-workout-card[data-workout-index="4"]')).toBeNull();
  });

  it('keeps a historical Week 4:4 completion in storage after render', () => {
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
      cfg: {
        workoutContext: {
          weekIndex: 3,
          workoutIndex: 4,
          workoutType: 'Long Run + S&C',
          dayOfWeek: 'Saturday/Sunday',
        },
      },
      workoutLog: {
        totalMinutes: 45,
        avgBpm: 137,
        distance: 5.2,
        completedAt: '2026-10-03T12:00:00.000Z',
      },
    });

    expect(getWorkoutCompletion(3, 4)?.id).toBe('historical-w4-long');
    cloudHydrationTestHooks.renderShell();
    expect(getWorkoutCompletion(3, 4)?.id).toBe('historical-w4-long');
    expect(document.querySelector('.week-workout-card[data-workout-index="4"]')).toBeNull();
  });
});
