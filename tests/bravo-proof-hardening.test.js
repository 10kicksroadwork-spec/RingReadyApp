import { describe, expect, it, vi, beforeEach } from 'vitest';

const storageUpload = vi.fn();
const storageRemove = vi.fn();
const rpc = vi.fn();

vi.mock('../src/build-info.js', () => ({
  APP_BUILD_SHA: 'abc1234',
  PROOF_CONTRACT_VERSION: 2,
  formatBuildLabel: () => 'abc1234',
}));

vi.mock('../src/auth.js', () => ({
  getCurrentUser: () => ({ id: 'user-1' }),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {
    storage: {
      from: () => ({
        upload: (...args) => storageUpload(...args),
        remove: (...args) => storageRemove(...args),
      }),
    },
    rpc: (...args) => rpc(...args),
  },
}));

import {
  loadImage,
  __resetProofStateForTest,
  __getProofStateForTest,
  ensureWorkoutProofUploaded,
  initWorkoutProof,
  buildProofFlightKey,
} from '../src/proof.js';
import { runSingleFlight, clearSingleFlightsForTest } from '../src/single-flight.js';
import { OperationTimeoutError, withOperationTimeout } from '../src/operation-timeout.js';
import {
  AMBIGUOUS_PROOF_MESSAGE,
  createProofUploadError,
  isProofErrorAmbiguous,
  isProofErrorDeterministic,
  PROOF_UPLOAD_PHASE,
} from '../src/proof-diagnostics.js';
import { withSavingButton } from '../src/ui.js';

describe('Bravo image decoding', () => {
  it('falls back to HTMLImageElement when createImageBitmap rejects', async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed');
    });
    const blob = new Blob(['fake'], { type: 'image/png' });
    const file = new File([blob], 'proof.png', { type: 'image/png' });
    globalThis.Image = class {
      set onload(handler) {
        this._onload = handler;
      }
      set onerror(handler) {
        this._onerror = handler;
      }
      set src(_value) {
        this.width = 10;
        this.height = 10;
        this._onload?.();
      }
    };
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();

    const image = await loadImage(file);
    expect(image.width).toBe(10);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});

describe('Bravo single-flight', () => {
  beforeEach(() => {
    clearSingleFlightsForTest();
  });

  it('returns the same promise for concurrent callers', async () => {
    let runs = 0;
    const task = vi.fn(async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'done';
    });

    const [a, b] = await Promise.all([
      runSingleFlight('proof:detail:test', task),
      runSingleFlight('proof:detail:test', task),
    ]);

    expect(a).toBe('done');
    expect(b).toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
    expect(runs).toBe(1);
  });
});

describe('Bravo operation timeout', () => {
  it('marks timeout failures as ambiguous', async () => {
    await expect(withOperationTimeout(new Promise(() => {}), {
      timeoutMs: 20,
      operation: 'proof_rpc',
    })).rejects.toMatchObject({
      name: 'OperationTimeoutError',
      ambiguous: true,
      operation: 'proof_rpc',
    });
  });
});

describe('Bravo saving button state', () => {
  it('restores button state after failure', async () => {
    document.body.innerHTML = '<button id="save-btn">SAVE</button>';
    const button = document.getElementById('save-btn');

    await expect(withSavingButton(button, async () => {
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe('SAVING...');
      expect(button.getAttribute('aria-busy')).toBe('true');
      throw new Error('save failed');
    })).rejects.toThrow('save failed');

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('SAVE');
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Bravo proof diagnostics', () => {
  it('classifies timeout failures as retryable and ambiguous', () => {
    const err = createProofUploadError(new OperationTimeoutError('proof_rpc', 12000), PROOF_UPLOAD_PHASE.RPC);
    expect(err.message).toBe(AMBIGUOUS_PROOF_MESSAGE);
    expect(err.proofAmbiguous).toBe(true);
    expect(err.proofRetryable).toBe(true);
    expect(isProofErrorAmbiguous(err)).toBe(true);
    expect(isProofErrorDeterministic(err)).toBe(false);
  });

  it('classifies linked identity errors as deterministic', () => {
    const err = createProofUploadError(
      new Error('linked_record_id not found or context mismatch for caller'),
      PROOF_UPLOAD_PHASE.RPC,
    );
    expect(isProofErrorDeterministic(err)).toBe(true);
    expect(isProofErrorAmbiguous(err)).toBe(false);
  });
});

describe('Bravo proof upload pipeline', () => {
  beforeEach(() => {
    __resetProofStateForTest();
    clearSingleFlightsForTest();
    vi.clearAllMocks();
    storageUpload.mockResolvedValue({ error: null });
    storageRemove.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({
      data: {
        id: 'attachment-1',
        proof_key: 'program:7:0:1',
        storage_path: 'user-1/program-7-0-1/upload.webp',
        original_filename: 'proof.png',
        mime_type: 'image/webp',
        file_size: 4,
        width: 100,
        height: 100,
        transfer_status: 'pending',
        uploaded_at: '2026-09-01T00:00:00.000Z',
      },
      error: null,
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  });

  async function seedProcessedProof(surface) {
    document.body.innerHTML = `<div data-proof-host="${surface}"></div>`;
    initWorkoutProof(surface, {
      proofKey: 'program:7:0:1',
      context: { campLength: 7, weekIndex: 0, workoutIndex: 1, workoutType: 'Threshold' },
    });
    const state = __getProofStateForTest(surface);
    state.processed = { blob: new Blob(['x'], { type: 'image/webp' }), width: 100, height: 100, mimeType: 'image/webp' };
    state.uploadId = 'upload-identity-1';
    state.storagePath = 'user-1/program-7-0-1/upload-identity-1.webp';
    state.previewUrl = 'blob:preview';
  }

  function mockHealthyContract() {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: 'ringready',
        buildSha: 'abc1234',
        proofContractVersion: 2,
        environment: 'development',
      }),
    }));
  }

  it('attempts proof upload when navigator.onLine is false', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toMatchObject({ id: 'attachment-1' });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageUpload.mock.calls[0][2]).toMatchObject({ upsert: true });
  });

  it('reuses the same storage path on retry', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');

    rpc.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toBeTruthy();
    rpc.mockResolvedValueOnce({
      data: {
        id: 'attachment-1',
        proof_key: 'program:7:0:1',
        storage_path: 'user-1/program-7-0-1/upload-identity-1.webp',
        original_filename: 'proof.png',
        mime_type: 'image/webp',
        file_size: 4,
        width: 100,
        height: 100,
        transfer_status: 'pending',
        uploaded_at: '2026-09-01T00:00:00.000Z',
      },
      error: null,
    });

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toMatchObject({ id: 'attachment-1' });
    const paths = storageUpload.mock.calls.map((call) => call[0]);
    expect(new Set(paths).size).toBe(1);
    expect(paths[0]).toBe('user-1/program-7-0-1/upload-identity-1.webp');
  });

  it('does not delete storage after ambiguous rpc failure', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    rpc.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toMatchObject({
      proofAmbiguous: true,
    });
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('deletes storage after deterministic rpc failure', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    rpc.mockResolvedValueOnce({
      data: null,
      error: new Error('linked_record_id not found or context mismatch for caller'),
    });

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toBeTruthy();
    expect(storageRemove).toHaveBeenCalledWith(['user-1/program-7-0-1/upload-identity-1.webp']);
  });

  it('deduplicates concurrent ensureWorkoutProofUploaded calls', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    const key = buildProofFlightKey('detail', 'program:7:0:1');

    await Promise.all([
      ensureWorkoutProofUploaded('detail', 'record-1'),
      ensureWorkoutProofUploaded('detail', 'record-1'),
    ]);

    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(key).toBe('proof:detail:program:7:0:1');
  });
});
