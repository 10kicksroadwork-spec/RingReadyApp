import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/build-info.js', () => ({
  APP_BUILD_SHA: 'abc1234',
  PROOF_CONTRACT_VERSION: 2,
}));

import {
  CONTRACT_UPDATE_MESSAGE,
  assertProofContractCurrent,
  checkRuntimeContract,
  evaluateContractHealth,
  fetchHealthPayload,
} from '../src/contract-health.js';

const validHealth = {
  ok: true,
  service: 'ringready',
  buildSha: 'abc1234',
  proofContractVersion: 2,
};

describe('contract health evaluation', () => {
  it('returns ok when build and proof contract match', () => {
    const result = evaluateContractHealth(validHealth);

    expect(result.status).toBe('ok');
    expect(result.clientBuild).toBe('abc1234');
    expect(result.serverBuild).toBe('abc1234');
  });

  it('returns mismatch when proof contract differs', () => {
    const result = evaluateContractHealth({
      ...validHealth,
      proofContractVersion: 3,
    });

    expect(result.status).toBe('mismatch');
    expect(result.reason).toBe('proof_contract');
    expect(result.userMessage).toBe(CONTRACT_UPDATE_MESSAGE);
  });

  it('returns mismatch when deployed build differs', () => {
    const result = evaluateContractHealth({
      ...validHealth,
      buildSha: 'def5678',
    });

    expect(result.status).toBe('mismatch');
    expect(result.reason).toBe('build');
  });

  it('returns unavailable when health payload is not ok', () => {
    const result = evaluateContractHealth({ ok: false });
    expect(result.status).toBe('unavailable');
  });

  it('returns unavailable when proof contract version is missing', () => {
    const result = evaluateContractHealth({
      ok: true,
      service: 'ringready',
      buildSha: 'abc1234',
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('invalid_health_schema');
  });

  it('returns unavailable when buildSha is missing', () => {
    const result = evaluateContractHealth({
      ok: true,
      service: 'ringready',
      proofContractVersion: 2,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('invalid_health_schema');
  });

  it('returns unavailable when service is wrong', () => {
    const result = evaluateContractHealth({
      ok: true,
      service: 'other',
      buildSha: 'abc1234',
      proofContractVersion: 2,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('invalid_health_schema');
  });

  it('returns unavailable for non-integer contract version', () => {
    const result = evaluateContractHealth({
      ok: true,
      service: 'ringready',
      buildSha: 'abc1234',
      proofContractVersion: 2.5,
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('invalid_health_schema');
  });

  it('returns unavailable for zero or negative contract version', () => {
    expect(evaluateContractHealth({
      ...validHealth,
      proofContractVersion: 0,
    }).reason).toBe('invalid_health_schema');

    expect(evaluateContractHealth({
      ...validHealth,
      proofContractVersion: -1,
    }).reason).toBe('invalid_health_schema');
  });
});

describe('contract health fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns timeout when health fetch aborts', async () => {
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = fetchHealthPayload({ fetchImpl, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result.error).toBe('timeout');
  });

  it('returns malformed_json for invalid health bodies', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    }));

    const result = await fetchHealthPayload({ fetchImpl });
    expect(result.error).toBe('malformed_json');
  });

  it('returns http_error for non-200 responses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false }),
    }));

    const result = await fetchHealthPayload({ fetchImpl });
    expect(result.error).toBe('http_error');
    expect(result.status).toBe(500);
  });

  it('returns network when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    const result = await fetchHealthPayload({ fetchImpl });
    expect(result.error).toBe('network');
  });
});

describe('checkRuntimeContract', () => {
  it('returns unavailable when health cannot be reached', async () => {
    const result = await checkRuntimeContract({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    expect(result.status).toBe('unavailable');
    expect(result.error).toBe('network');
  });

  it('returns unavailable for valid JSON with invalid schema', async () => {
    const result = await checkRuntimeContract({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          buildSha: 'abc1234',
        }),
      }),
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('invalid_health_schema');
  });

  it('returns mismatch from live health payload', async () => {
    const result = await checkRuntimeContract({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          service: 'ringready',
          buildSha: 'def5678',
          proofContractVersion: 3,
        }),
      }),
    });

    expect(result.status).toBe('mismatch');
    expect(result.serverBuild).toBe('def5678');
    expect(result.serverProofContract).toBe(3);
  });
});

describe('assertProofContractCurrent', () => {
  it('throws on explicit mismatch', async () => {
    await expect(assertProofContractCurrent({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          service: 'ringready',
          buildSha: 'def5678',
          proofContractVersion: 3,
        }),
      }),
    })).rejects.toMatchObject({
      contractHealthStatus: 'mismatch',
      message: CONTRACT_UPDATE_MESSAGE,
    });
  });

  it('does not throw when health is unavailable', async () => {
    const result = await assertProofContractCurrent({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    expect(result.status).toBe('unavailable');
  });

  it('does not throw when health schema is invalid', async () => {
    const result = await assertProofContractCurrent({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          buildSha: 'abc1234',
        }),
      }),
    });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('invalid_health_schema');
  });
});
