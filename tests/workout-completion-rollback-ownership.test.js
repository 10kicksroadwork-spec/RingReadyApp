import { describe, expect, it } from 'vitest';
import {
  canRollbackProvisionalStaging,
  planMileTestIdentityStaging,
  planWorkoutIdentityStaging,
} from '../src/proof-staging.js';

describe('provisional rollback ownership', () => {
  it('marks inserted provisional rows as rollback-owned', () => {
    const plan = planWorkoutIdentityStaging(null, {
      id: 'new-client',
      workoutContext: { weekIndex: 0, workoutIndex: 2 },
    });
    expect(plan).toMatchObject({
      action: 'insert-provisional',
      created: true,
      insertedThisAttempt: true,
      reused: false,
      rollbackOwned: true,
    });
    expect(canRollbackProvisionalStaging(plan, { proof_pending: true })).toBe(true);
  });

  it('does not allow rollback when refreshing a pre-existing proof_pending row', () => {
    const plan = planWorkoutIdentityStaging({
      client_record_id: 'legacy-client',
      proof_pending: true,
      completion_key: 'stale-legacy-key',
    }, {
      id: 'retry-client',
      workoutContext: { weekIndex: 0, workoutIndex: 2 },
    });
    expect(plan).toMatchObject({
      action: 'refresh-provisional',
      created: false,
      insertedThisAttempt: false,
      reused: true,
      rollbackOwned: false,
      clientRecordId: 'legacy-client',
      completionKey: '0:2',
    });
    expect(canRollbackProvisionalStaging(plan, { proof_pending: true })).toBe(false);
  });

  it('applies the same ownership rule to mile-test provisional refresh', () => {
    const plan = planMileTestIdentityStaging({
      client_record_id: 'mile-old',
      proof_pending: true,
    }, { id: 'mile-new', testKey: 'mile-test:baseline' }, { testKey: 'mile-test:baseline' });
    expect(plan.rollbackOwned).toBe(false);
    expect(plan.created).toBe(false);
    expect(canRollbackProvisionalStaging(plan, { proof_pending: true })).toBe(false);
  });
});
