import { getCurrentUser } from './auth.js';
import { runSingleFlight } from './single-flight.js';

let generation = 0;
export function captureAthleteOperation() {
  return { userId: getCurrentUser()?.id || '', generation };
}
export function isAthleteOperationCurrent(owner) {
  return !!owner && owner.userId === (getCurrentUser()?.id || '') && owner.generation === generation;
}
export function invalidateAthleteOperations() {
  generation += 1;
  window.dispatchEvent(new Event('ringready:account-boundary'));
}
export function assertAthleteOperationCurrent(owner) {
  if (!isAthleteOperationCurrent(owner)) {
    const error = new Error('Account changed. Open the workout in your current account.');
    error.accountChanged = true;
    throw error;
  }
}
export async function ownedResult(owner, promise) {
  try { return await promise; }
  finally { assertAthleteOperationCurrent(owner); }
}
// All actions for one assignment share a flight, including Clear and Skip.
export function runAthleteMutation(key, task) {
  const owner = captureAthleteOperation();
  return runSingleFlight(`${owner.userId}:${owner.generation}:assignment:${key}`, async () => {
    if (!isAthleteOperationCurrent(owner)) return;
    try { return await task(owner); }
    catch (error) {
      if (!isAthleteOperationCurrent(owner)) return;
      throw error;
    }
  });
}
