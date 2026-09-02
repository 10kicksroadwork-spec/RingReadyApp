import { describe, expect, it } from 'vitest';
import { PROOF_CONTRACT_VERSION as clientVersion } from '../src/build-info.js';
import { PROOF_CONTRACT_VERSION as serverVersion } from '../src/proof-contract-version.js';

describe('proof contract version source', () => {
  it('keeps client and shared contract version in sync', () => {
    expect(clientVersion).toBe(serverVersion);
    expect(clientVersion).toBe(2);
  });
});
