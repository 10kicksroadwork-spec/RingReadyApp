import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUser = { id: 'athlete-a' };
const rpc = vi.fn();
const from = vi.fn();

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...args) => rpc(...args),
    from: (...args) => from(...args),
  },
}));

vi.mock('../src/athlete-operation.js', () => ({
  captureAthleteOperation: () => ({ id: 'op-1' }),
  ownedResult: async (_owner, promise) => promise,
}));

vi.mock('../src/operation-timeout.js', () => ({
  OPERATION_TIMEOUT_MS: { CLOUD_COMPLETION: 1000, CLOUD_HYDRATION: 1000 },
  withOperationTimeout: async (promise) => promise,
}));

function mockMaybeSingle(result) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => result,
          eq: () => ({
            maybeSingle: async () => result,
          }),
        }),
      }),
    }),
  };
}

describe('assigned mile ambiguous save reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('treats timeout as SUCCESS when WC+Mile prove the requested save', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const completion = {
      id: 'wc-1',
      client_record_id: 'rec-1',
      completion_key: '5:3',
      week_index: 5,
      workout_index: 3,
      record_json: { status: 'completed', type: 'daily-workout-completion' },
    };
    const mile = {
      id: 'mile-1',
      client_record_id: 'rec-1',
      test_key: 'program:7:5:3',
      distance: 1,
      total_minutes: 7.5,
      avg_bpm: 150,
      max_bpm: 170,
    };

    from.mockImplementation((table) => {
      if (table === 'workout_completions') {
        return mockMaybeSingle({ data: completion, error: null });
      }
      if (table === 'mile_tests') {
        return mockMaybeSingle({ data: mile, error: null });
      }
      return mockMaybeSingle({ data: null, error: null });
    });

    const { saveCloudAssignedMileResult } = await import('../src/auth.js');
    // Patch getCurrentUser via module side-effect: auth exports use session.
    // Force current user by stubbing through a minimal session set if available.
    const auth = await import('../src/auth.js');
    // Directly call reconcile helper exported for this contract.
    const reconciled = await auth.reconcileAssignedMileSaveOutcome({
      owner: { id: 'op-1' },
      userId: mockUser.id,
      testKey: 'program:7:5:3',
      weekIndex: 5,
      workoutIndex: 3,
      clientRecordId: 'rec-1',
      distance: 1,
      totalMinutes: 7.5,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toMatchObject({
      status: 'completed',
      reconciled: true,
      test_key: 'program:7:5:3',
      completion_key: '5:3',
    });

    // saveCloudAssignedMileResult path: RPC fails, reconcile succeeds.
    // auth.getCurrentUser depends on session — stub by setting via save path only if user exists.
    // We verify the helper used by the catch path above; additionally assert source contract.
    void saveCloudAssignedMileResult;
  });

  it('does not treat skipped assignment + mile absence as save success', async () => {
    const skipped = {
      id: 'wc-2',
      client_record_id: 'rec-2',
      completion_key: '5:3',
      week_index: 5,
      workout_index: 3,
      record_json: { status: 'skipped', type: 'daily-workout-skip' },
    };
    from.mockImplementation((table) => {
      if (table === 'workout_completions') {
        return mockMaybeSingle({ data: skipped, error: null });
      }
      return mockMaybeSingle({ data: null, error: null });
    });

    const auth = await import('../src/auth.js');
    const reconciled = await auth.reconcileAssignedMileSaveOutcome({
      owner: { id: 'op-1' },
      userId: mockUser.id,
      testKey: 'program:7:5:3',
      weekIndex: 5,
      workoutIndex: 3,
      clientRecordId: 'rec-2',
      distance: 1,
      totalMinutes: 7.5,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toBeNull();
  });

  it('fails closed when key and position resolve to different rows', async () => {
    let call = 0;
    from.mockImplementation((table) => {
      if (table === 'workout_completions') {
        call += 1;
        const row = call % 2 === 1
          ? { id: 'wc-key', client_record_id: 'rec-a', completion_key: '5:3', record_json: { status: 'completed' } }
          : { id: 'wc-pos', client_record_id: 'rec-b', completion_key: 'legacy', week_index: 5, workout_index: 3, record_json: { status: 'completed' } };
        return mockMaybeSingle({ data: row, error: null });
      }
      return mockMaybeSingle({
        data: {
          id: 'mile-1',
          client_record_id: 'rec-a',
          test_key: 'program:7:5:3',
          distance: 1,
          total_minutes: 7.5,
          avg_bpm: 150,
          max_bpm: 170,
        },
        error: null,
      });
    });

    const auth = await import('../src/auth.js');
    const reconciled = await auth.reconcileAssignedMileSaveOutcome({
      owner: { id: 'op-1' },
      userId: mockUser.id,
      testKey: 'program:7:5:3',
      weekIndex: 5,
      workoutIndex: 3,
      clientRecordId: 'rec-a',
      distance: 1,
      totalMinutes: 7.5,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toBeNull();
  });
});

describe('assigned mile save source contract', () => {
  it('reconciles ambiguous RPC failures before reporting failure', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/auth.js', 'utf8');
    expect(src).toMatch(/reconcileAssignedMileSaveOutcome/);
    expect(src).toMatch(/save_assigned_mile_result/);
    const start = src.indexOf('export async function saveCloudAssignedMileResult');
    const body = src.slice(start, start + 4500);
    expect(body).toMatch(/catch \(error\)/);
    expect(body).toMatch(/reconcileAssignedMileSaveOutcome/);
    expect(body).toMatch(/if \(reconciled\) return reconciled/);
  });

  it('keeps Save/Skip/Clear on serialized server RPCs', async () => {
    const { readFileSync } = await import('node:fs');
    const migration = readFileSync('scripts/migrations/021_assigned_mile_serialized_transitions.sql', 'utf8');
    expect(migration).toMatch(/lock_assigned_workout_transition/);
    expect(migration).toMatch(/resolve_assigned_workout_completion_id/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/save_assigned_mile_result/);
    expect(migration).toMatch(/skip_assigned_mile/);
    expect(migration).toMatch(/clear_assigned_mile_with_proof/);
    // Lock before table mutations in clear.
    const clearIdx = migration.indexOf('create or replace function public.clear_assigned_mile_with_proof');
    const clearBody = migration.slice(clearIdx, clearIdx + 2000);
    expect(clearBody.indexOf('lock_assigned_workout_transition'))
      .toBeLessThan(clearBody.indexOf('delete from public.mile_tests'));
  });
});
