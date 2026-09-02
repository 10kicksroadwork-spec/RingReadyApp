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
  __handleProofFileForTest,
  ensureWorkoutProofUploaded,
  initWorkoutProof,
  buildProofFlightKey,
  canReplaceWorkoutProof,
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

  it('returns a friendly error when both decoders fail', async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed');
    });
    globalThis.Image = class {
      set onload(_handler) {}
      set onerror(handler) {
        this._onerror = handler;
      }
      set src(_value) {
        this._onerror?.();
      }
    };
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();
    document.body.innerHTML = '<div data-proof-host="detail"></div>';
    initWorkoutProof('detail', { proofKey: 'program:7:0:1', context: {} });
    const blob = new Blob(['fake'], { type: 'image/png' });
    const file = new File([blob], 'proof.png', { type: 'image/png' });

    await __handleProofFileForTest('detail', file);

    const state = __getProofStateForTest('detail');
    expect(state.error).toContain('Could not read');
    expect(state.processed).toBeNull();
    expect(canReplaceWorkoutProof('detail')).toBe(true);
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
  it('classifies storage timeout failures with storage phase', () => {
    const err = createProofUploadError(new OperationTimeoutError('proof_storage_upload', 20000));
    expect(err.proofFailurePhase).toBe(PROOF_UPLOAD_PHASE.STORAGE);
    expect(err.proofAmbiguous).toBe(true);
    expect(err.proofFailureKind).toBe('storage_upload');
  });

  it('classifies rpc timeout failures with rpc phase', () => {
    const err = createProofUploadError(new OperationTimeoutError('proof_rpc', 12000));
    expect(err.message).toBe(AMBIGUOUS_PROOF_MESSAGE);
    expect(err.proofFailurePhase).toBe(PROOF_UPLOAD_PHASE.RPC);
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

  it('classifies TypeError Load failed transport rejections as ambiguous rpc failures', () => {
    const err = createProofUploadError(new TypeError('Load failed'), PROOF_UPLOAD_PHASE.RPC);
    expect(err.proofFailurePhase).toBe(PROOF_UPLOAD_PHASE.RPC);
    expect(err.proofAmbiguous).toBe(true);
    expect(err.proofDeterministic).toBe(false);
    expect(isProofErrorDeterministic(err)).toBe(false);
  });

  it('classifies TypeError Load failed transport rejections as ambiguous storage failures', () => {
    const err = createProofUploadError(new TypeError('Load failed'), PROOF_UPLOAD_PHASE.STORAGE);
    expect(err.proofFailurePhase).toBe(PROOF_UPLOAD_PHASE.STORAGE);
    expect(err.proofAmbiguous).toBe(true);
    expect(isProofErrorDeterministic(err)).toBe(false);
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

  async function seedProcessedProof(surface, overrides = {}) {
    document.body.innerHTML = `<div data-proof-host="${surface}"></div>`;
    initWorkoutProof(surface, {
      proofKey: 'program:7:0:1',
      context: { campLength: 7, weekIndex: 0, workoutIndex: 1, workoutType: 'Threshold' },
    });
    const state = __getProofStateForTest(surface);
    state.processed = { blob: new Blob(['x'], { type: 'image/webp' }), width: 100, height: 100, mimeType: 'image/webp' };
    state.uploadId = 'upload-identity-1';
    state.storagePath = 'user-1/program-7-0-1/upload-identity-1.webp';
    state.filename = 'proof-a.png';
    state.previewUrl = 'blob:preview';
    Object.assign(state, overrides);
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

  it('assigns a new upload identity after a successful save and new screenshot', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toMatchObject({ id: 'attachment-1' });

    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 120,
      height: 120,
      close: () => {},
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    }));
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/webp;base64,abc');
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(['y'], { type: 'image/webp' }));
    });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:new-preview');
    globalThis.URL.revokeObjectURL = vi.fn();

    const firstPath = 'user-1/program-7-0-1/upload-identity-1.webp';
    await __handleProofFileForTest('detail', new File([new Blob(['y'], { type: 'image/png' })], 'proof-b.png', { type: 'image/png' }));
    const secondPath = __getProofStateForTest('detail').storagePath;

    expect(secondPath).toBeTruthy();
    expect(secondPath).not.toBe(firstPath);
    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toBeTruthy();
    expect(storageUpload.mock.calls.at(-1)[0]).toBe(secondPath);
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

  it('sets ambiguousRpcPending and blocks replacement after ambiguous rpc failure', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    rpc.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toBeTruthy();
    const state = __getProofStateForTest('detail');
    expect(state.ambiguousRpcPending).toBe('upload-identity-1');
    expect(canReplaceWorkoutProof('detail')).toBe(false);
    expect(document.querySelector('[data-proof-input="detail"]')?.disabled).toBe(true);
  });

  it('clears ambiguousRpcPending after successful reconciliation retry', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    rpc.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toBeTruthy();

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toMatchObject({ id: 'attachment-1' });
    const state = __getProofStateForTest('detail');
    expect(state.ambiguousRpcPending).toBeNull();
    expect(canReplaceWorkoutProof('detail')).toBe(true);
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

  it('uses attempt metadata even if state mutates during upload', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    storageUpload.mockImplementationOnce(async () => {
      const state = __getProofStateForTest('detail');
      state.filename = 'mutated.png';
      state.processed = { blob: new Blob(['z'], { type: 'image/webp' }), width: 999, height: 999, mimeType: 'image/webp' };
      return { error: null };
    });

    await ensureWorkoutProofUploaded('detail', 'record-1');

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_original_filename: 'proof-a.png',
      p_file_size: 1,
      p_width: 100,
      p_height: 100,
    });
  });

  it('blocks replacement while storage upload is in flight', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    let releaseUpload;
    storageUpload.mockImplementationOnce(() => new Promise((resolve) => {
      releaseUpload = () => resolve({ error: null });
    }));

    const uploadPromise = ensureWorkoutProofUploaded('detail', 'record-1');
    await vi.waitFor(() => {
      expect(canReplaceWorkoutProof('detail')).toBe(false);
    });

    const replacementBlob = new Blob(['replacement'], { type: 'image/png' });
    await __handleProofFileForTest('detail', new File([replacementBlob], 'proof-b.png', { type: 'image/png' }));

    const state = __getProofStateForTest('detail');
    expect(state.uploadId).toBe('upload-identity-1');
    expect(state.filename).toBe('proof-a.png');

    releaseUpload();
    await uploadPromise;
  });

  it('deduplicates concurrent ensureWorkoutProofUploaded calls for the same upload identity', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    const key = buildProofFlightKey('detail', 'program:7:0:1', 'upload-identity-1');

    await Promise.all([
      ensureWorkoutProofUploaded('detail', 'record-1'),
      ensureWorkoutProofUploaded('detail', 'record-1'),
    ]);

    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(key).toBe('proof:detail:program:7:0:1:upload-identity-1');
  });

  it('disables the picker while contract health is pending', async () => {
    await seedProcessedProof('detail');
    let releaseHealth;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      releaseHealth = () => resolve({
        ok: true,
        json: async () => ({
          ok: true,
          service: 'ringready',
          buildSha: 'abc1234',
          proofContractVersion: 2,
          environment: 'development',
        }),
      });
    }));

    const uploadPromise = ensureWorkoutProofUploaded('detail', 'record-1');
    await vi.waitFor(() => {
      expect(__getProofStateForTest('detail').uploading).toBe(true);
      expect(canReplaceWorkoutProof('detail')).toBe(false);
    }, { timeout: 2000 });
    expect(document.querySelector('[data-proof-input="detail"]')?.disabled).toBe(true);

    releaseHealth();
    await uploadPromise;
  }, 10000);

  it('preserves active upload lock when the same proof surface reinitializes', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    storageUpload.mockImplementationOnce(() => new Promise(() => {}));

    const stateBefore = __getProofStateForTest('detail');
    ensureWorkoutProofUploaded('detail', 'record-1');
    await vi.waitFor(() => expect(canReplaceWorkoutProof('detail')).toBe(false));

    initWorkoutProof('detail', {
      proofKey: 'program:7:0:1',
      context: { campLength: 7, weekIndex: 0, workoutIndex: 1, workoutType: 'Threshold' },
    });

    expect(__getProofStateForTest('detail')).toBe(stateBefore);
    expect(canReplaceWorkoutProof('detail')).toBe(false);
    expect(stateBefore.uploading).toBe(true);
  });

  it('reconciles and unlocks after reinit when upload completes', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    let releaseUpload;
    storageUpload.mockImplementationOnce(() => new Promise((resolve) => {
      releaseUpload = () => resolve({ error: null });
    }));

    const stateBefore = __getProofStateForTest('detail');
    const uploadPromise = ensureWorkoutProofUploaded('detail', 'record-1');
    await vi.waitFor(() => expect(stateBefore.uploading).toBe(true));

    initWorkoutProof('detail', {
      proofKey: 'program:7:0:1',
      context: { campLength: 7, weekIndex: 0, workoutIndex: 1, workoutType: 'Threshold' },
    });
    expect(__getProofStateForTest('detail')).toBe(stateBefore);

    releaseUpload();
    await uploadPromise;

    expect(stateBefore.uploading).toBe(false);
    expect(stateBefore.ambiguousRpcPending).toBeNull();
    expect(stateBefore.processed).toBeNull();
    expect(stateBefore.uploadId).toBeNull();
    expect(stateBefore.existingAttachment).toMatchObject({ id: 'attachment-1' });
    expect(canReplaceWorkoutProof('detail')).toBe(true);
  });

  it('treats rejected rpc transport failures as ambiguous without deleting storage', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    rpc.mockImplementationOnce(() => Promise.reject(new TypeError('Load failed')));

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toMatchObject({
      proofFailurePhase: PROOF_UPLOAD_PHASE.RPC,
      proofAmbiguous: true,
      proofDeterministic: false,
    });
    expect(storageRemove).not.toHaveBeenCalled();
    expect(__getProofStateForTest('detail').ambiguousLinkedRecordId).toBe('record-1');
  });

  it('rejects proof retry when linked record id diverges from ambiguous attempt', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    const state = __getProofStateForTest('detail');
    state.ambiguousRpcPending = 'upload-identity-1';
    state.ambiguousLinkedRecordId = 'record-A';

    await expect(ensureWorkoutProofUploaded('detail', 'record-B')).rejects.toMatchObject({
      proofDiagnosticDetail: 'proof_retry_identity_mismatch',
      proofPreserveProvisionalIdentity: true,
    });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(state.ambiguousRpcPending).toBe('upload-identity-1');
  });

  it('keeps ambiguity sticky after deterministic failure following ambiguous rpc', async () => {
    mockHealthyContract();
    await seedProcessedProof('detail');
    rpc.mockImplementationOnce(() => Promise.reject(new TypeError('Load failed')));
    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toMatchObject({
      proofAmbiguous: true,
    });

    rpc.mockResolvedValueOnce({
      data: null,
      error: new Error('linked_record_id not found or context mismatch for caller'),
    });
    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toMatchObject({
      proofPreserveProvisionalIdentity: true,
    });

    const state = __getProofStateForTest('detail');
    expect(state.ambiguousRpcPending).toBe('upload-identity-1');
    expect(state.ambiguousLinkedRecordId).toBe('record-1');
    expect(storageRemove).not.toHaveBeenCalled();
  });
});
