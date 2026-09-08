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
  distance: 1,
  total_minutes: 7.5,
  total_seconds: 450,
  avg_bpm: 150,
  max_bpm: 170,
  modality: 'running',
  output_type: 'distance',
  output_value: 1,
};

const matchingMile = {
  id: 'mile-1',
  client_record_id: 'rec-1',
  test_key: 'program:7:5:3',
  distance: 1,
  total_minutes: 7.5,
  total_seconds: 450,
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
      totalSeconds: 450,
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

  it('does NOT reconcile when WC metrics are stale but Mile matches requested save', async () => {
    mockRows({
      wc: {
        ...completedWc,
        total_minutes: 7.67,
        total_seconds: 460,
        avg_bpm: 145,
        max_bpm: 165,
      },
      mile: matchingMile,
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
      totalSeconds: 450,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toBeNull();
  });

  it('reconciles when WC and Mile both prove the full requested postcondition', async () => {
    mockRows({
      wc: completedWc,
      mile: matchingMile,
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
      totalSeconds: 450,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toMatchObject({ status: 'completed', reconciled: true });
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

  it('does NOT reconcile from a key row stored at a different assignment position', async () => {
    from.mockImplementation((table) => {
      if (table === 'workout_completions') {
        const maybeSingle = async () => ({
          // completion_key hit whose stored position belongs to another assignment,
          // and no row at the requested position.
          data: { ...completedWc, id: 'wc-key', week_index: 4, workout_index: 1 },
          error: null,
        });
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
      distance: 1,
      totalMinutes: 7.5,
      totalSeconds: 450,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toBeNull();
  });

  it('still reconciles a legacy key row with no stored assignment position', async () => {
    mockRows({
      wc: { ...completedWc, week_index: null, workout_index: null },
      mile: matchingMile,
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
      totalSeconds: 450,
      avgBpm: 150,
      maxBpm: 170,
    });
    expect(reconciled).toMatchObject({ status: 'completed', reconciled: true });
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

  it('generic clear joins assignment lock and uses fail-closed identity resolver', () => {
    const migration = readFileSync('scripts/migrations/022_generic_clear_assignment_authority.sql', 'utf8');
    expect(migration).toMatch(/lock_assigned_workout_transition/);
    expect(migration).toMatch(/resolve_assigned_workout_completion_id/);
    expect(migration).toMatch(/clear_workout_completion_with_proof/);
    expect(migration).toMatch(/delete from public\.mile_tests/);
    expect(migration).not.toMatch(/wc\.completion_key = v_completion_key\s*\n\s*or/i);
    const fnIdx = migration.indexOf('create or replace function public.clear_workout_completion_with_proof');
    const body = migration.slice(fnIdx);
    expect(body.indexOf('lock_assigned_workout_transition'))
      .toBeLessThan(body.indexOf('resolve_assigned_workout_completion_id'));
    expect(body.indexOf('resolve_assigned_workout_completion_id'))
      .toBeLessThan(body.indexOf('delete from public.workout_completions'));
  });

  it('resolves assignment identity with position as canonical authority', () => {
    const migration = readFileSync('scripts/migrations/021_assigned_mile_serialized_transitions.sql', 'utf8');
    const fnIdx = migration.indexOf('create or replace function public.resolve_assigned_workout_completion_id_for');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = migration.slice(fnIdx, migration.indexOf('$$;', fnIdx));
    // dual-row conflict
    expect(body).toMatch(/v_by_key_id is distinct from v_by_position/);
    // key-only row whose stored position disagrees with the requested assignment
    expect(body).toMatch(/v_by_key_week is distinct from p_week_index/);
    expect(body).toMatch(/v_by_key_workout is distinct from p_workout_index/);
    // legacy key rows without a stored position stay recoverable
    expect(body).toMatch(/v_by_key_week is not null or v_by_key_workout is not null/);
    expect(body).toMatch(/return coalesce\(v_by_key_id, v_by_position\)/);
    expect(migration).toMatch(/resolve_assigned_workout_completion_id_for\(\s*auth\.uid\(\)/);
  });

  it('enforces the assigned mutation perimeter for stale clients', () => {
    const migration = readFileSync('scripts/migrations/023_assignment_mutation_perimeter.sql', 'utf8');

    // Direct mile_tests writes join the same assignment lock before the row lands.
    const beforeIdx = migration.indexOf('create or replace function public.tg_assigned_mile_detail_before');
    const beforeBody = migration.slice(beforeIdx, migration.indexOf('$function$;', beforeIdx));
    expect(beforeBody).toMatch(/lock_assigned_workout_transition_for/);
    expect(beforeBody).toMatch(/resolve_assigned_workout_completion_id_for/);
    expect(beforeBody).toMatch(/resolve_assigned_mile_attachment_id/);
    expect(beforeBody).toMatch(/sync_assigned_mile_proof_mirrors/);

    // Proof freshness: never trust a non-null incoming attachment without workout_attachments authority.
    expect(migration).toMatch(/create or replace function public\.resolve_assigned_mile_attachment_id/);
    expect(migration).toMatch(/create or replace function public\.is_authoritative_assigned_mile_attachment/);
    expect(migration).toMatch(/wa\.is_current = true/);
    expect(migration).toMatch(/wa\.completion_cleared = false/);

    // Legacy Mile-only saves gain a canonical completion instead of standing alone.
    const afterIdx = migration.indexOf('create or replace function public.tg_assigned_mile_detail_after');
    const afterBody = migration.slice(afterIdx, migration.indexOf('$function$;', afterIdx));
    expect(afterBody).toMatch(/insert into public\.workout_completions/);
    expect(afterBody).toMatch(/update public\.workout_completions/);
    // Relational + JSON proof mirrors must stay synchronized; do not coalesce a stale id back in.
    expect(afterBody).toMatch(/attachment_id = new\.attachment_id/);
    expect(afterBody).toMatch(/sync_assigned_mile_proof_mirrors/);
    expect(afterBody).toMatch(/v_wc_json_attachment_id is not distinct from \(new\.attachment_id::text\)/);

    // Skipped or cleared assignments must not keep subordinate Mile detail or proof.
    const skipIdx = migration.indexOf('create or replace function public.tg_assigned_workout_after');
    const skipBody = migration.slice(skipIdx, migration.indexOf('$function$;', skipIdx));
    expect(skipBody).toMatch(/retire_assigned_workout_proof/);
    expect(skipBody).toMatch(/delete from public\.mile_tests/);

    // Provisional proof staging and standalone baseline Mile stay outside the perimeter.
    expect(migration).toMatch(/coalesce\(p_proof_pending, false\) = false/);
    expect(migration).toMatch(/\^program:\[0-9\]\+:\[0-9\]\+:\[0-9\]\+\$/);
    expect(migration).not.toMatch(/revoke .*(insert|update|delete).*mile_tests/i);
    expect(migration).not.toMatch(/drop policy .*mile_tests_(insert|update)_own/i);

    for (const trigger of [
      'assigned_mile_detail_before',
      'assigned_mile_detail_after',
      'assigned_workout_before',
      'assigned_workout_after',
    ]) {
      expect(migration).toMatch(new RegExp(`create trigger ${trigger}\\b`));
    }
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
