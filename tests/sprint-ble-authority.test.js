import { describe, expect, it } from 'vitest';
import {
  applyServerBleConfirmation,
  buildBleCompletionChecklistItems,
  buildPostLocalVerificationRecord,
  markBleVerificationPending,
  requiresServerBleConfirmation,
  resolveBleWaiverNeeds,
} from '../src/sprint-ble-authority.js';

const baseRecord = { id: 'session-1', data: [{ sprintHR: 170, restHR: 140 }] };

describe('sprint BLE authority', () => {
  it('requires server confirmation only for authenticated Supabase sessions', () => {
    expect(requiresServerBleConfirmation(true, true)).toBe(true);
    expect(requiresServerBleConfirmation(true, false)).toBe(false);
    expect(requiresServerBleConfirmation(false, true)).toBe(false);
  });

  it('keeps local bleVerified for offline sessions without Supabase', () => {
    const record = buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      false,
    );
    expect(record.localBleEligible).toBe(true);
    expect(record.bleVerified).toBe(true);
    expect(record.bleVerificationPending).toBe(false);
  });

  it('does not mark verified until server confirms for Supabase sessions', () => {
    const record = buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      true,
    );
    expect(record.localBleEligible).toBe(true);
    expect(record.bleVerified).toBe(false);
    expect(record.bleVerificationPending).toBe(false);
  });

  it('marks verification pending when local passes but cloud save fails', () => {
    const local = buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      true,
    );
    const pending = markBleVerificationPending(local);
    expect(pending.bleVerified).toBe(false);
    expect(pending.bleVerificationPending).toBe(true);
    expect(resolveBleWaiverNeeds(pending)).toEqual({
      bleVerified: false,
      needsScreenshotProof: false,
      pending: true,
    });
  });

  it('waives screenshot when server returns ble_verified=true', () => {
    const local = buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      true,
    );
    const confirmed = applyServerBleConfirmation(local, {
      ...local,
      bleVerified: true,
      bleVerificationPending: false,
    });
    expect(resolveBleWaiverNeeds(confirmed)).toEqual({
      bleVerified: true,
      needsScreenshotProof: false,
      pending: false,
    });
    expect(buildBleCompletionChecklistItems(confirmed, { hasWorkoutProof: false })).toEqual([]);
  });

  it('requires screenshot when server returns ble_verified=false', () => {
    const local = buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      true,
    );
    const rejected = applyServerBleConfirmation(local, {
      ...local,
      bleVerified: false,
      bleVerificationPending: false,
    });
    expect(resolveBleWaiverNeeds(rejected)).toEqual({
      bleVerified: false,
      needsScreenshotProof: true,
      pending: false,
    });
    expect(buildBleCompletionChecklistItems(rejected, { hasWorkoutProof: false })).toEqual([
      { label: 'Workout screenshot', done: false },
    ]);
  });

  it('clears pending after successful retry with DB true', () => {
    const pending = markBleVerificationPending(buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      true,
    ));
    const confirmed = applyServerBleConfirmation(pending, {
      ...pending,
      bleVerified: true,
      bleVerificationPending: false,
    });
    expect(confirmed.bleVerificationPending).toBe(false);
    expect(confirmed.bleVerified).toBe(true);
  });

  it('requires screenshot after pending retry returns DB false', () => {
    const pending = markBleVerificationPending(buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: true, reason: 'ble_verified' },
      true,
    ));
    const rejected = applyServerBleConfirmation(pending, {
      ...pending,
      bleVerified: false,
      bleVerificationPending: false,
    });
    expect(resolveBleWaiverNeeds(rejected).needsScreenshotProof).toBe(true);
  });

  it('does not mark pending when local BLE eligibility failed', () => {
    const local = buildPostLocalVerificationRecord(
      baseRecord,
      { bleVerified: false, reason: 'manual_capture' },
      true,
    );
    const pending = markBleVerificationPending(local);
    expect(pending.bleVerificationPending).toBeFalsy();
  });
});
