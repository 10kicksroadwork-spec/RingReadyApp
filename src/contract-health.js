import { APP_BUILD_SHA, PROOF_CONTRACT_VERSION } from './build-info.js';

export const CONTRACT_UPDATE_MESSAGE =
  'RING READY UPDATED — REOPEN OR REFRESH BEFORE SUBMITTING A WORKOUT';

export const HEALTH_PATH = '/api/health';
export const HEALTH_TIMEOUT_MS = 4000;

function isValidHealthSchema(healthBody) {
  const serverBuild = typeof healthBody?.buildSha === 'string'
    ? healthBody.buildSha.trim()
    : '';
  const serverProofContract = Number(healthBody?.proofContractVersion);

  return healthBody?.ok === true
    && healthBody?.service === 'ringready'
    && Boolean(serverBuild)
    && Number.isInteger(serverProofContract)
    && serverProofContract > 0;
}

export async function fetchHealthPayload(options = {}) {
  const {
    timeoutMs = HEALTH_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    healthPath = HEALTH_PATH,
  } = options;

  if (typeof fetchImpl !== 'function') {
    return { error: 'network', detail: 'fetch_unavailable' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(healthPath, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { error: 'http_error', status: response.status };
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return { error: 'malformed_json' };
    }

    return { body };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { error: 'timeout' };
    }
    return {
      error: 'network',
      detail: String(error?.message || error || 'fetch_failed'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function evaluateContractHealth(healthBody, client = {}) {
  const clientBuild = String(client.clientBuild ?? APP_BUILD_SHA ?? 'dev');
  const clientProofContract = Number(
    client.clientProofContract ?? PROOF_CONTRACT_VERSION,
  );

  const serverBuild = typeof healthBody?.buildSha === 'string'
    ? healthBody.buildSha.trim()
    : '';
  const serverProofContract = Number(healthBody?.proofContractVersion);

  const base = {
    clientBuild,
    clientProofContract,
    serverBuild,
    serverProofContract,
  };

  if (!healthBody || healthBody.ok !== true) {
    return {
      ...base,
      status: 'unavailable',
      reason: 'health_not_ok',
    };
  }

  if (!isValidHealthSchema(healthBody)) {
    return {
      ...base,
      status: 'unavailable',
      reason: 'invalid_health_schema',
    };
  }

  const proofMismatch = serverProofContract !== clientProofContract;

  const buildMismatch = Boolean(
    serverBuild
    && serverBuild !== 'dev'
    && clientBuild
    && clientBuild !== 'dev'
    && serverBuild !== clientBuild,
  );

  if (proofMismatch || buildMismatch) {
    return {
      ...base,
      status: 'mismatch',
      reason: proofMismatch ? 'proof_contract' : 'build',
      userMessage: CONTRACT_UPDATE_MESSAGE,
    };
  }

  return {
    ...base,
    status: 'ok',
  };
}

export async function checkRuntimeContract(options = {}) {
  const fetched = await fetchHealthPayload(options);

  if (fetched.error) {
    return {
      status: 'unavailable',
      clientBuild: APP_BUILD_SHA,
      clientProofContract: PROOF_CONTRACT_VERSION,
      error: fetched.error,
      detail: fetched.detail,
      statusCode: fetched.status,
    };
  }

  return evaluateContractHealth(fetched.body, options.client);
}

export async function assertProofContractCurrent(options = {}) {
  const result = await checkRuntimeContract(options);

  if (result.status === 'mismatch') {
    const err = new Error(result.userMessage || CONTRACT_UPDATE_MESSAGE);
    err.contractHealthStatus = 'mismatch';
    err.contractHealth = result;
    throw err;
  }

  return result;
}
