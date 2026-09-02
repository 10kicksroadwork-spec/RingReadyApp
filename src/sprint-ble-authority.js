/**
 * Separates local BLE eligibility from server-confirmed verification.
 * For authenticated Supabase sessions, bleVerified=true only after the DB confirms it.
 */

export function requiresServerBleConfirmation(isSupabaseConfigured, hasUser) {
  return !!isSupabaseConfigured && !!hasUser;
}

export function buildPostLocalVerificationRecord(record, verification, requiresServer) {
  const localBleEligible = !!verification?.bleVerified;
  return {
    ...record,
    localBleEligible,
    bleVerified: requiresServer ? false : localBleEligible,
    bleVerificationPending: false,
    bleVerificationReason: verification?.reason || '',
  };
}

export function applyServerBleConfirmation(record, saved) {
  if (!saved) return record;
  return {
    ...saved,
    localBleEligible: record.localBleEligible ?? saved.localBleEligible,
    bleVerificationPending: false,
  };
}

export function markBleVerificationPending(record) {
  if (!record?.localBleEligible) return record;
  return {
    ...record,
    bleVerified: false,
    bleVerificationPending: true,
    bleVerificationReason: 'cloud_save_failed',
  };
}

export function resolveBleWaiverNeeds(record) {
  if (record?.bleVerificationPending) {
    return {
      bleVerified: false,
      needsScreenshotProof: false,
      pending: true,
    };
  }
  const bleVerified = !!record?.bleVerified;
  return {
    bleVerified,
    needsScreenshotProof: !bleVerified,
    pending: false,
  };
}

export function buildBleCompletionChecklistItems(record, { hasWorkoutProof }) {
  const waiver = resolveBleWaiverNeeds(record);
  if (waiver.pending) {
    return [{ label: 'BLE verification (reconnect and retry)', done: false }];
  }
  if (waiver.bleVerified) return [];
  return [{ label: 'Workout screenshot', done: !!hasWorkoutProof }];
}
