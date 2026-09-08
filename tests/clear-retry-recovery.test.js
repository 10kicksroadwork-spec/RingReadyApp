import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  reads: [],
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'athlete-a' } } } }),
      onAuthStateChange: () => ({ data: { subscription: {} } }),
    },
    rpc: (...args) => mocks.rpc(...args),
    from: () => {
      const filters = {};
      const query = {
        select: () => query,
        eq: (column, value) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: () => {
          const handler = mocks.reads.shift();
          if (typeof handler === 'function') return handler(filters);
          return handler || { data: null, error: null };
        },
      };
      return query;
    },
  },
}));

import { initSupabaseAuth, clearCloudWorkoutCompletionWithProof } from '../src/auth.js';

describe('clear retry recovery', () => {
  beforeEach(async () => {
    await initSupabaseAuth();
    mocks.rpc.mockResolvedValue({ error: new Error('Load failed') });
    mocks.reads.length = 0;
    // Default: both identity lookups absent.
    mocks.reads.push({ data: null, error: null }, { data: null, error: null });
  });

  it('recognizes authoritative absence after a lost clear response', async () => {
    await expect(clearCloudWorkoutCompletionWithProof(0, 1)).resolves.toBe(true);
  });

  it('never reports cleared when a completion still exists by week/workout', async () => {
    mocks.reads.length = 0;
    mocks.reads.push(
      { data: null, error: null },
      { data: { id: 'remaining-by-position' }, error: null },
    );
    await expect(clearCloudWorkoutCompletionWithProof(0, 1)).rejects.toThrow('Load failed');
  });

  it('never reports cleared when a legacy row survives only by completion_key', async () => {
    mocks.reads.length = 0;
    mocks.reads.push(
      (filters) => {
        expect(filters.completion_key).toBe('0:1');
        return { data: { id: 'legacy-by-key' }, error: null };
      },
      { data: null, error: null },
    );
    await expect(clearCloudWorkoutCompletionWithProof(0, 1)).rejects.toThrow('Load failed');
  });

  it('keeps the outcome unknown when either reconciliation read fails', async () => {
    mocks.reads.length = 0;
    mocks.reads.push(
      { data: null, error: null },
      { data: null, error: new Error('offline') },
    );
    await expect(clearCloudWorkoutCompletionWithProof(0, 1)).rejects.toThrow('Load failed');
  });
});

// A restored attachment must still be current on the server before reuse.
import { initWorkoutProof, ensureWorkoutProofUploaded, __resetProofStateForTest } from '../src/proof.js';

describe('restored proof validation', () => {
  beforeEach(async () => {
    await initSupabaseAuth();
    __resetProofStateForTest();
    localStorage.clear();
    document.body.innerHTML = '<div id="detailProofHost"></div>';
    initWorkoutProof('detail', { proofKey: 'program:7:0:1', existingAttachment: { id: 'proof-1' } });
    mocks.reads.length = 0;
  });

  it('allows a current attachment after authoritative validation', async () => {
    mocks.reads.push({ data: { id: 'proof-1', is_current: true, completion_cleared: false }, error: null });
    await expect(ensureWorkoutProofUploaded('detail')).resolves.toEqual({ id: 'proof-1' });
  });

  it('rejects a cleared attachment restored from a previous session', async () => {
    mocks.reads.push({ data: { id: 'proof-1', is_current: false, completion_cleared: true }, error: null });
    await expect(ensureWorkoutProofUploaded('detail')).rejects.toThrow('Proof was cleared or replaced');
  });
});
