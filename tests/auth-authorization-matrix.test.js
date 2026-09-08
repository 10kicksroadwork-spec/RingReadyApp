import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COACH_EMAILS, isCoachEmail } from '../src/coach-access.js';

const AUTH_SRC = readFileSync('src/auth.js', 'utf8');
const PROOF_SRC = readFileSync('src/proof.js', 'utf8');

function functionBody(source, name) {
  const match = source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n(?=export |$)`));
  expect(match, name).toBeTruthy();
  return match[0];
}

describe('athlete/coach authorization matrix', () => {
  it('keeps coach mutation helpers gated on isCoachUser()', () => {
    for (const name of ['saveCoachNote', 'saveCoachCampStartDate', 'archiveAndResetCamp', 'loadCoachRosterPayload']) {
      const body = functionBody(AUTH_SRC, name);
      expect(body).toMatch(/isCoachUser\(/);
    }
  });

  it('keeps athlete cloud writers scoped to getCurrentUser().id', () => {
    for (const name of [
      'saveCloudProfile',
      'saveCloudHRInfo',
      'saveCloudWorkoutCompletion',
      'saveCloudSprintSession',
      'saveCloudMileTest',
      'saveCloudAssignedMileResult',
      'skipCloudAssignedMile',
      'clearCloudAssignedMileWithProof',
    ]) {
      expect(AUTH_SRC.includes(`export async function ${name}`) || AUTH_SRC.includes(`export function ${name}`), name).toBe(true);
      const start = AUTH_SRC.search(new RegExp(`export (?:async )?function ${name}\\(`));
      expect(start).toBeGreaterThanOrEqual(0);
      const body = AUTH_SRC.slice(start, start + 3500);
      expect(body).toMatch(/getCurrentUser\(/);
      expect(body).toMatch(/user\.id|user_id:\s*user\.id|auth\.uid|\.rpc\(/);
    }
  });

  it('routes assigned Mile Clear through the server RPC (not client two-step deletes)', () => {
    const body = functionBody(AUTH_SRC, 'clearCloudAssignedMileWithProof');
    expect(body).toMatch(/clear_assigned_mile_with_proof/);
    expect(body).not.toMatch(/\.from\('mile_tests'\)\.delete\(/);
  });

  it('routes assigned Mile Save/Skip through canonical server RPCs', () => {
    expect(functionBody(AUTH_SRC, 'saveCloudAssignedMileResult')).toMatch(/save_assigned_mile_result/);
    expect(functionBody(AUTH_SRC, 'skipCloudAssignedMile')).toMatch(/skip_assigned_mile/);
  });

  it('reconciles ambiguous assigned Mile Save before reporting failure', () => {
    const body = functionBody(AUTH_SRC, 'saveCloudAssignedMileResult');
    expect(body).toMatch(/reconcileAssignedMileSaveOutcome/);
    expect(body).toMatch(/if \(reconciled\) return reconciled/);
  });
  it('does not grant athletes coach identity via email helper', () => {
    expect(isCoachEmail('athlete@example.com')).toBe(false);
    expect(isCoachEmail(COACH_EMAILS[0])).toBe(true);
  });

  it('keeps proof attachment creation on the RPC path (no direct table insert)', () => {
    expect(PROOF_SRC).toMatch(/create_workout_proof_attachment/);
    expect(PROOF_SRC).not.toMatch(/\.from\(\s*['"]workout_attachments['"]\s*\)\s*\.insert\(/);
    expect(AUTH_SRC).not.toMatch(/\.from\(\s*['"]workout_attachments['"]\s*\)\s*\.(insert|upsert)\(/);
  });

  it('blocks foreign athleteUserId archive without coach gate', () => {
    const body = functionBody(AUTH_SRC, 'archiveAndResetCamp');
    expect(body).toMatch(/athleteUserId/);
    expect(body).toMatch(/isCoachUser\(/);
    expect(body).toMatch(/Only coaches can reset another athlete/);
  });
});
