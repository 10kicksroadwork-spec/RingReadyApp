import { describe, expect, it } from 'vitest';
import {
  assertDurableFinalizedWorkoutRow,
  findWorkoutCompletionIdentity,
  saveWorkoutCompletionReconciled,
} from '../src/workout-completion-reconcile.js';

/** Minimal chainable Supabase mock keyed by filter equality on workout_completions. */
function createCompletionClient(rows, {
  updateResult = 'apply',
} = {}) {
  const state = { updates: [], inserts: [] };

  function matches(filters, row) {
    return filters.every(([col, val]) => String(row[col]) === String(val));
  }

  function query(selectCols) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) {
        filters.push([col, val]);
        return api;
      },
      async maybeSingle() {
        const hit = rows.filter((row) => matches(filters, row));
        return { data: hit[0] || null, error: null };
      },
      async single() {
        const hit = rows.filter((row) => matches(filters, row));
        return { data: hit[0] || null, error: hit[0] ? null : { message: 'not found' } };
      },
    };
    void selectCols;
    return api;
  }

  return {
    state,
    from(table) {
      if (table !== 'workout_completions') throw new Error(`unexpected table ${table}`);
      return {
        select: (cols) => query(cols),
        update(payload) {
          state.updates.push(payload);
          const filters = [];
          const api = {
            eq(col, val) {
              filters.push([col, val]);
              return api;
            },
            select() {
              return {
                async maybeSingle() {
                  if (updateResult === 'zero_row') {
                    return { data: null, error: null };
                  }
                  const hit = rows.filter((row) => matches(filters, row));
                  if (!hit[0]) return { data: null, error: null };
                  if (updateResult === 'leave_pending') {
                    Object.assign(hit[0], payload, { proof_pending: true });
                  } else {
                    Object.assign(hit[0], payload);
                  }
                  return { data: { ...hit[0] }, error: null };
                },
              };
            },
          };
          return api;
        },
        upsert(payload) {
          state.inserts.push(payload);
          return {
            select() {
              return {
                async maybeSingle() {
                  const row = {
                    id: 'new-id',
                    ...payload,
                    proof_pending: payload.proof_pending === true,
                  };
                  rows.push(row);
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        insert(payload) {
          state.inserts.push(payload);
          return {
            select() {
              return {
                async single() {
                  return { data: { id: 'new-id' }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function finishedRecord(overrides = {}) {
  return {
    id: 'client-1',
    workoutContext: { weekIndex: 0, workoutIndex: 4, workoutType: 'Long Run + S&C' },
    workoutLog: {
      totalMinutes: 45,
      avgBpm: 142,
      maxBpm: 168,
      distance: 3.5,
      completedAt: '2026-09-04T13:21:38.505Z',
    },
    completedAt: '2026-09-04T13:21:38.505Z',
    attachment: { id: 'att-1' },
    proofPolicyVersion: 1,
    ...overrides,
  };
}

describe('findWorkoutCompletionIdentity key-position mismatch', () => {
  it('raises explicit conflict when key row exists at the wrong position and positional row is absent', async () => {
    const rowA = {
      id: 'row-a',
      user_id: 'user-1',
      completion_key: '2:1',
      week_index: 1,
      workout_index: 0,
      proof_pending: false,
      client_record_id: 'legacy',
      attachment_id: null,
      proof_policy_version: null,
    };
    const client = createCompletionClient([rowA]);
    const record = {
      id: 'retry',
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
      workoutLog: { totalMinutes: 40, avgBpm: 150 },
    };

    let error = null;
    try {
      await findWorkoutCompletionIdentity(client, 'user-1', record);
    } catch (err) {
      error = err;
    }

    expect(error?.workoutIdentityConflict).toBe('key_position_mismatch');
    expect(error?.completionKeyRowId).toBe('row-a');
  });

  it('does not mutate the key row when save hits key_position_mismatch', async () => {
    const rowA = {
      id: 'row-a',
      user_id: 'user-1',
      completion_key: '2:1',
      week_index: 1,
      workout_index: 0,
      proof_pending: false,
      client_record_id: 'legacy',
      attachment_id: null,
      proof_policy_version: null,
    };
    const client = createCompletionClient([rowA]);
    const record = {
      id: 'retry',
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
      workoutLog: {
        totalMinutes: 40,
        avgBpm: 150,
        maxBpm: 165,
        completedAt: '2026-09-03T12:00:00.000Z',
      },
      completedAt: '2026-09-03T12:00:00.000Z',
    };

    await expect(saveWorkoutCompletionReconciled(client, 'user-1', record))
      .rejects.toMatchObject({ workoutIdentityConflict: 'key_position_mismatch' });
    expect(client.state.updates).toEqual([]);
    expect(client.state.inserts).toEqual([]);
  });

  it('returns positional row when key and position agree', async () => {
    const row = {
      id: 'row-ok',
      user_id: 'user-1',
      completion_key: '2:1',
      week_index: 2,
      workout_index: 1,
      proof_pending: false,
      client_record_id: 'ok',
      attachment_id: null,
      proof_policy_version: null,
    };
    const client = createCompletionClient([row]);
    const found = await findWorkoutCompletionIdentity(client, 'user-1', {
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
    });
    expect(found.id).toBe('row-ok');
  });
});

describe('durable workout finalization postconditions', () => {
  it('rejects zero-row updates that return no error', async () => {
    const provisional = {
      id: 'row-pending',
      user_id: 'user-1',
      completion_key: '0:4',
      week_index: 0,
      workout_index: 4,
      proof_pending: true,
      client_record_id: 'client-1',
      attachment_id: null,
      proof_policy_version: null,
      completed_at: null,
    };
    const client = createCompletionClient([provisional], { updateResult: 'zero_row' });

    await expect(saveWorkoutCompletionReconciled(client, 'user-1', finishedRecord()))
      .rejects.toMatchObject({
        workoutFinalizeFailed: true,
        finalizeReason: 'zero_row',
      });
    expect(client.state.updates).toHaveLength(1);
    expect(provisional.proof_pending).toBe(true);
  });

  it('rejects finalization that leaves proof_pending true', async () => {
    const provisional = {
      id: 'row-pending',
      user_id: 'user-1',
      completion_key: '0:4',
      week_index: 0,
      workout_index: 4,
      proof_pending: true,
      client_record_id: 'client-1',
      attachment_id: null,
      proof_policy_version: null,
      completed_at: null,
    };
    const client = createCompletionClient([provisional], { updateResult: 'leave_pending' });

    await expect(saveWorkoutCompletionReconciled(client, 'user-1', finishedRecord()))
      .rejects.toMatchObject({
        workoutFinalizeFailed: true,
        finalizeReason: 'proof_pending',
      });
  });

  it('finalizes a provisional row and returns a verified durable row', async () => {
    const provisional = {
      id: 'row-pending',
      user_id: 'user-1',
      completion_key: '0:4',
      week_index: 0,
      workout_index: 4,
      proof_pending: true,
      client_record_id: 'client-1',
      attachment_id: null,
      proof_policy_version: null,
      completed_at: null,
    };
    const client = createCompletionClient([provisional]);
    const result = await saveWorkoutCompletionReconciled(client, 'user-1', finishedRecord());

    expect(result.action).toBe('update');
    expect(result.rowId).toBe('row-pending');
    expect(result.verified.proof_pending).toBe(false);
    expect(result.verified.completion_key).toBe('0:4');
    expect(Number(result.verified.week_index)).toBe(0);
    expect(Number(result.verified.workout_index)).toBe(4);
    expect(result.verified.completed_at).toBeTruthy();
    expect(result.verified.attachment_id).toBe('att-1');
    expect(provisional.proof_pending).toBe(false);
  });

  it('assertDurableFinalizedWorkoutRow rejects incomplete cloud snapshots', () => {
    expect(() => assertDurableFinalizedWorkoutRow(null, { completion_key: '0:4' }))
      .toThrow(/affected no row/i);
    expect(() => assertDurableFinalizedWorkoutRow({
      id: 'x',
      proof_pending: false,
      completion_key: '0:4',
      week_index: 0,
      workout_index: 4,
      completed_at: null,
    }, { completion_key: '0:4', week_index: 0, workout_index: 4 }))
      .toThrow(/completed_at/i);
  });

  it('rejects proof_pending=null (must be literal false)', () => {
    expect(() => assertDurableFinalizedWorkoutRow({
      id: 'x',
      proof_pending: null,
      completion_key: '0:4',
      week_index: 0,
      workout_index: 4,
      completed_at: '2026-09-04T13:21:38.505Z',
    }, { completion_key: '0:4', week_index: 0, workout_index: 4 }))
      .toThrow(/proof_pending/i);
  });

  it('rejects week_index=null when expected week is 0 (Number(null) must not pass)', () => {
    expect(() => assertDurableFinalizedWorkoutRow({
      id: 'x',
      proof_pending: false,
      completion_key: '0:4',
      week_index: null,
      workout_index: 4,
      completed_at: '2026-09-04T13:21:38.505Z',
    }, { completion_key: '0:4', week_index: 0, workout_index: 4 }))
      .toThrow(/week_index/i);
  });

  it('rejects workout_index=null when expected workout is 0 (Number(null) must not pass)', () => {
    expect(() => assertDurableFinalizedWorkoutRow({
      id: 'x',
      proof_pending: false,
      completion_key: '0:0',
      week_index: 0,
      workout_index: null,
      completed_at: '2026-09-04T13:21:38.505Z',
    }, { completion_key: '0:0', week_index: 0, workout_index: 0 }))
      .toThrow(/workout_index/i);
  });
});
