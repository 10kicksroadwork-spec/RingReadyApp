import { getCurrentUser } from './auth.js';

let generation = 0;
const assignmentLocks = new Map();

export class AthleteMutationBusyError extends Error {
  constructor(activeOperation, requestedOperation) {
    super('SAVE IN PROGRESS — TRY AGAIN IN A MOMENT');
    this.name = 'AthleteMutationBusyError';
    this.busy = true;
    this.activeOperation = activeOperation;
    this.requestedOperation = requestedOperation;
  }
}

export function captureAthleteOperation() {
  return { userId: getCurrentUser()?.id || '', generation };
}

export function isAthleteOperationCurrent(owner) {
  return !!owner && owner.userId === (getCurrentUser()?.id || '') && owner.generation === generation;
}

export function invalidateAthleteOperations() {
  generation += 1;
  assignmentLocks.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ringready:account-boundary'));
  }
}

export function assertAthleteOperationCurrent(owner) {
  if (!isAthleteOperationCurrent(owner)) {
    const error = new Error('Account changed. Open the workout in your current account.');
    error.accountChanged = true;
    throw error;
  }
}

export async function ownedResult(owner, promise) {
  try {
    return await promise;
  } finally {
    assertAthleteOperationCurrent(owner);
  }
}

export function getAssignmentMutation(assignmentKey) {
  return assignmentLocks.get(String(assignmentKey)) || null;
}

export function isAssignmentBusy(assignmentKey) {
  return assignmentLocks.has(String(assignmentKey));
}

export function clearAthleteMutationLocksForTest() {
  assignmentLocks.clear();
}

/**
 * Serialize athlete mutations for one assignment.
 * - Same operation may coalesce onto the in-flight Promise.
 * - A different operation must never silently inherit another Promise.
 */
export function runAthleteMutation(assignmentKey, operation, task) {
  if (typeof operation === 'function' && task == null) {
    // Back-compat for accidental two-arg calls during integration — treat as anonymous op.
    task = operation;
    operation = 'mutation';
  }

  const owner = captureAthleteOperation();
  const key = String(assignmentKey);
  const op = String(operation || 'mutation');
  const existing = assignmentLocks.get(key);

  if (existing) {
    if (existing.operation === op) return existing.promise;
    return Promise.reject(new AthleteMutationBusyError(existing.operation, op));
  }

  const promise = Promise.resolve()
    .then(async () => {
      if (!isAthleteOperationCurrent(owner)) return;
      try {
        return await task(owner);
      } catch (error) {
        if (!isAthleteOperationCurrent(owner)) return;
        throw error;
      }
    })
    .finally(() => {
      if (assignmentLocks.get(key)?.promise === promise) {
        assignmentLocks.delete(key);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ringready:assignment-mutation-idle', {
            detail: { key, operation: op },
          }));
        }
      }
    });

  assignmentLocks.set(key, { operation: op, promise });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ringready:assignment-mutation-busy', {
      detail: { key, operation: op },
    }));
  }
  return promise;
}
