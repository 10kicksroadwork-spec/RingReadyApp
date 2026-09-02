import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CONTRACT_UPDATE_MESSAGE } from '../src/contract-health.js';
import {
  ensureWorkoutProofUploaded,
  initWorkoutProof,
} from '../src/proof.js';

const storageUpload = vi.fn();
const rpc = vi.fn();

vi.mock('../src/build-info.js', () => ({
  APP_BUILD_SHA: 'abc1234',
  PROOF_CONTRACT_VERSION: 2,
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
        remove: vi.fn(),
      }),
    },
    rpc: (...args) => rpc(...args),
  },
}));

async function seedProcessedProof(surface) {
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

  const blob = new Blob(['fake'], { type: 'image/png' });
  globalThis.createImageBitmap = vi.fn(async () => ({
    width: 100,
    height: 100,
    close: () => {},
  }));

  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  }));
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/webp;base64,abc');
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
    callback(blob);
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();

  const file = new File([blob], 'proof.png', { type: 'image/png' });
  const input = document.querySelector(`[data-proof-input="${surface}"]`);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await vi.waitFor(() => {
    expect(document.querySelector('.proof-preview')).toBeTruthy();
  });
}

describe('proof contract gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageUpload.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({
      data: {
        id: 'attachment-1',
        proof_key: 'program:7:0:1',
        storage_path: 'user-1/path/proof.png',
        original_filename: 'proof.png',
        mime_type: 'image/png',
        file_size: 4,
        width: 100,
        height: 100,
        transfer_status: 'pending',
        uploaded_at: '2026-09-01T00:00:00.000Z',
      },
      error: null,
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('blocks storage upload and rpc on explicit contract mismatch', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        buildSha: 'def5678',
        proofContractVersion: 3,
      }),
    }));

    await seedProcessedProof('detail');

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).rejects.toMatchObject({
      contractHealthStatus: 'mismatch',
      message: CONTRACT_UPDATE_MESSAGE,
    });

    expect(storageUpload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('attempts proof upload when health is unavailable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    await seedProcessedProof('detail');

    await expect(ensureWorkoutProofUploaded('detail', 'record-1')).resolves.toMatchObject({
      id: 'attachment-1',
    });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('service worker runtime api bypass', () => {
  it('does not intercept /api/* requests', () => {
    const swContents = readFileSync('public/sw.js', 'utf8');
    expect(swContents).toMatch(/pathname\.startsWith\(['"]\/api\//);
    expect(swContents).toMatch(/\/api\//);
  });
});

describe('api health handler', () => {
  it('returns a secret-free deployment contract payload', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'e42525d952904a52e2ca88a10681105d1deba566';
    process.env.VERCEL_ENV = 'production';
    process.env.RING_READY_SUPABASE_URL = 'https://abcprojectref.supabase.co';

    const health = (await import('../api/health.js')).default;
    const headers = {};
    const res = {
      setHeader(name, value) {
        headers[name] = value;
      },
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await health({}, res);

    expect(headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({
      ok: true,
      service: 'ringready',
      buildSha: 'e42525d',
      proofContractVersion: 2,
      environment: 'production',
      supabaseProjectRef: 'abcprojectref',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/anon[_-]?key|service[_-]?role|secret|password/i);
  });
});
