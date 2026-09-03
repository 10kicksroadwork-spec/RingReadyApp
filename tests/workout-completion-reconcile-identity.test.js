import { describe, expect, it } from 'vitest';
import {
  findWorkoutCompletionIdentity,
  saveWorkoutCompletionReconciled,
} from '../src/workout-completion-reconcile.js';

/** Minimal chainable Supabase mock keyed by filter equality on workout_completions. */
function createCompletionClient(rows) {
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
            then(resolve) {
              resolve({ data: null, error: null });
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
                  return { data: { id: 'new-id' }, error: null };
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
