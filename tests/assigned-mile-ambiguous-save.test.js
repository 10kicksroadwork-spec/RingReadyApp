import { readFileSync } from 'node:fs';
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

function mockQuery(result) {
  const maybeSingle = async () => result;
  const eq = () => ({ eq, maybeSingle });
  const select = () => ({ eq, maybeSingle });
  return { select };
}

const completedWc = {
  id: 'wc-1',
  client_record_id: 'rec-1',
  completion_key: '5:3',
  week_index: 5,
  workout_index: 3,
  record_json: { status: 'completed', type: 'daily-workout-completion' },
  proof_pending: false,
};

const matchingMile = {
  id: 'mile-1',
  client_record_id: 'rec-1',
  test_key: 'program:7:5:3',
  distance: 1,
  total_minutes: 7.5,
  avg_bpm: 150,
  max_bpm: 170,
  proof_pending: false,
};

function mockRows({ wc = completedWc, mile = matchingMile } = {}) {
  from.mockImplementation((table) => {
    if (table === 'workout_completions') return mockQuery({ data: wc, error: null });
    if (table === 'mile_tests') return mockQuery({ data: mile, error: null });
    return mockQuery({ data: null, error: null });
  });
}

async function loadAuth() {
  const auth = await import('../src/auth.js');
  // Auth module exports getCurrentUser from session state; stub for save path.
  auth.__setCurrentUserForTest?.(mockUser);
  return auth;
}

describe('assigned mile ambiguous save reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('treats timeout as SUCCESS when WC+Mile prove the requested save', async () => {
    mockRows();
    const auth = await loadAuth();
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
  });

  it('does not treat skipped assignment + mile absence as save success', async () => {
    mockRows({
      wc: {
        ...completedWc,
        record_json: { status: 'skipped', type: 'daily-workout-skip' },
      },
      mile: null,
    });
    const auth = await loadAuth();
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
    let wcBuilderCount = 0;
    from.mockImplementation((table) => {
      if (table === 'workout_completions') {
        wcBuilderCount += 1;
        const row = wcBuilderCount === 1
          ? { data: { ...completedWc, id: 'wc-key' }, error: null }
          : { data: { ...completedWc, id: 'wc-pos', completion_key: 'legacy' }, error: null };
        const maybeSingle = async () => row;
        const eq = () => ({ eq, maybeSingle });
        const select = () => ({ eq, maybeSingle });
        return { select };
      }
      return mockQuery({ data: matchingMile, error: null });
    });
    const auth = await loadAuth();
    const reconciled = await auth.reconcileAssignedMileSaveOutcome({
      owner: { id: 'op-1' },
      userId: mockUser.id,
      testKey: 'program:7:5:3',
      weekIndex: 5,
      workoutIndex: 3,
      clientRecordId: 'rec-1',
    });
    expect(reconciled).toBeNull();
  });

  it('does NOT succeed when cloud proves old proof A but save requested proof B', async () => {
    mockRows({
      wc: { ...completedWc, attachment_id: 'attachment-a', proof_policy_version: 1 },
      mile: { ...matchingMile, attachment_id: 'attachment-a', proof_policy_version: 1 },
    });
    const auth = await loadAuth();
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
      attachmentId: 'attachment-b',
      proofPolicyVersion: 1,
    });
    expect(reconciled).toBeNull();
  });

  it('DOES succeed when cloud proves requested proof B on both WC and Mile', async () => {
    mockRows({
      wc: { ...completedWc, attachment_id: 'attachment-b', proof_policy_version: 2 },
      mile: { ...matchingMile, attachment_id: 'attachment-b', proof_policy_version: 2 },
    });
    const auth = await loadAuth();
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
      attachmentId: 'attachment-b',
      proofPolicyVersion: 2,
    });
    expect(reconciled).toMatchObject({ status: 'completed', reconciled: true });
  });

  it('does NOT reconcile while either row is still proof_pending', async () => {
    mockRows({
      wc: { ...completedWc, attachment_id: 'attachment-b', proof_policy_version: 2, proof_pending: true },
      mile: { ...matchingMile, attachment_id: 'attachment-b', proof_policy_version: 2 },
    });
    const auth = await loadAuth();
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
      attachmentId: 'attachment-b',
      proofPolicyVersion: 2,
    });
    expect(reconciled).toBeNull();
  });
});

describe('assigned mile save source contract', () => {
  it('reconciles ambiguous RPC failures before reporting failure', () => {
    const src = readFileSync('src/auth.js', 'utf8');
    expect(src).toMatch(/reconcileAssignedMileSaveOutcome/);
    expect(src).toMatch(/save_assigned_mile_result/);
    const start = src.indexOf('export async function saveCloudAssignedMileResult');
    const body = src.slice(start, start + 4500);
    expect(body).toMatch(/catch \(error\)/);
    expect(body).toMatch(/isAmbiguousCloudError/);
    expect(body).toMatch(/reconcileAssignedMileSaveOutcome/);
    expect(body).toMatch(/if \(reconciled\) return reconciled/);
  });

  it('keeps Save/Skip/Clear on serialized server RPCs', () => {
    const migration = readFileSync('scripts/migrations/021_assigned_mile_serialized_transitions.sql', 'utf8');
    expect(migration).toMatch(/lock_assigned_workout_transition/);
    expect(migration).toMatch(/resolve_assigned_workout_completion_id/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/save_assigned_mile_result/);
    expect(migration).toMatch(/skip_assigned_mile/);
    expect(migration).toMatch(/clear_assigned_mile_with_proof/);
    const clearIdx = migration.indexOf('create or replace function public.clear_assigned_mile_with_proof');
    const clearBody = migration.slice(clearIdx, clearIdx + 2000);
    expect(clearBody.indexOf('lock_assigned_workout_transition'))
      .toBeLessThan(clearBody.indexOf('delete from public.mile_tests'));
  });

  it('generic clear joins assignment lock and removes subordinate Mile detail', () => {
    const migration = readFileSync('scripts/migrations/022_generic_clear_assignment_authority.sql', 'utf8');
    expect(migration).toMatch(/lock_assigned_workout_transition/);
    expect(migration).toMatch(/clear_workout_completion_with_proof/);
    expect(migration).toMatch(/delete from public\.mile_tests/);
    const fnIdx = migration.indexOf('create or replace function public.clear_workout_completion_with_proof');
    const body = migration.slice(fnIdx);
    expect(body.indexOf('lock_assigned_workout_transition'))
      .toBeLessThan(body.indexOf('delete from public.workout_completions'));
  });

  it('routes Mile Clear Skip through assigned clear in workout detail', () => {
    const src = readFileSync('src/shell.js', 'utf8');
    const start = src.indexOf('async function clearCompletionFromDetailOwned');
    const body = src.slice(start, start + 2600);
    expect(body).toMatch(/workout\?\.action === 'mile-test'/);
    expect(body).toMatch(/clearCloudAssignedMileWithProof/);
    expect(body).toMatch(/clearCloudWorkoutCompletionWithProof/);
  });
});
