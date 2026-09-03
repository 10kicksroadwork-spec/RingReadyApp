import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isConfigured: false,
  supabase: null,
  user: null,
}));

vi.mock('../src/auth.js', () => ({
  getCurrentUser: () => mocks.user,
}));

vi.mock('../src/supabase-client.js', () => ({
  get isSupabaseConfigured() {
    return mocks.isConfigured;
  },
  get supabase() {
    return mocks.supabase;
  },
}));

vi.mock('../src/build-info.js', () => ({
  APP_BUILD_SHA: 'abc1234',
  PROOF_CONTRACT_VERSION: 2,
  formatBuildLabel: () => 'abc1234',
}));

import {
  __getProofStateForTest,
  __resetProofStateForTest,
  ensureWorkoutProofUploaded,
  initWorkoutProof,
} from '../src/proof.js';

function seedProcessedProof(surface = 'detail') {
  document.body.innerHTML = `<div data-proof-host="${surface}"></div>`;
  initWorkoutProof(surface, {
    proofKey: 'program:7:0:1',
    context: {
      campLength: 7,
      weekIndex: 0,
      workoutIndex: 1,
      workoutType: 'Threshold',
    },
  });
  const state = __getProofStateForTest(surface);
  state.processed = {
    blob: new Blob(['x'], { type: 'image/webp' }),
    width: 100,
    height: 100,
    mimeType: 'image/webp',
  };
  return state;
}

describe('proof local-athlete vs signed-out cloud authority', () => {
  beforeEach(() => {
    __resetProofStateForTest();
    mocks.isConfigured = false;
    mocks.supabase = null;
    mocks.user = null;
  });

  it('allows processed proof when Supabase is not configured (local-athlete mode)', async () => {
    mocks.isConfigured = false;
    mocks.supabase = null;
    mocks.user = null;
    seedProcessedProof('detail');

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toBeNull();
  });

  it('blocks processed proof when Supabase is configured but the user is signed out', async () => {
    mocks.isConfigured = true;
    mocks.supabase = { storage: { from: () => ({}) }, rpc: vi.fn() };
    mocks.user = null;
    seedProcessedProof('detail');

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toThrow(
      'Sign in before submitting workout proof.',
    );
  });
});
