import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'athlete-a' } } } }),
      onAuthStateChange: () => ({ data: { subscription: {} } }),
    },
    rpc: (...args) => mocks.rpc(...args),
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: () => mocks.read() };
      return query;
    },
  },
}));
import { initSupabaseAuth, clearCloudWorkoutCompletionWithProof } from '../src/auth.js';
describe('clear retry recovery', () => {
  beforeEach(async () => {
    await initSupabaseAuth();
    mocks.rpc.mockResolvedValue({ error: new Error('Load failed') });
    mocks.read.mockResolvedValue({ data: null, error: null });
  });
  it('recognizes authoritative absence after a lost clear response', async () => {
    await expect(clearCloudWorkoutCompletionWithProof(0, 1)).resolves.toBe(true);
  });
  it('never reports cleared when a completion or provisional row still exists', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'remaining-row' }, error: null });
    await expect(clearCloudWorkoutCompletionWithProof(0, 1)).rejects.toThrow('Load failed');
  });
  it('keeps the outcome unknown when reconciliation also fails', async () => {
    mocks.read.mockResolvedValue({ data: null, error: new Error('offline') });
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
  });
  it('allows a current attachment after authoritative validation', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'proof-1', is_current: true, completion_cleared: false }, error: null });
    await expect(ensureWorkoutProofUploaded('detail')).resolves.toEqual({ id: 'proof-1' });
  });
  it('rejects a cleared attachment restored from a previous session', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'proof-1', is_current: false, completion_cleared: true }, error: null });
    await expect(ensureWorkoutProofUploaded('detail')).rejects.toThrow('Proof was cleared or replaced');
  });
});
