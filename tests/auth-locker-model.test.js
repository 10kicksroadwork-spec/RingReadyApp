import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COACH_EMAILS,
  ROSTER_EXCLUDED_EMAILS,
  ROSTER_EXCLUDED_USER_IDS,
} from '../src/coach-access.js';

const IS_COACH_SQL = readFileSync('scripts/migrations/002_coach_access.sql', 'utf8');
const EXCLUSION_SEED = readFileSync('scripts/seeds/production-coach-roster-exclusions.sql', 'utf8');
const LOCKER_DOC = readFileSync('docs/AUTH_LOCKER_MODEL.md', 'utf8');

function emailsInIsCoachSql(sql) {
  const fn = sql.match(/create or replace function public\.is_coach\(\)[\s\S]*?\$\$;/i);
  expect(fn).toBeTruthy();
  return [...fn[0].matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1].toLowerCase()).sort();
}

describe('auth locker model sync contract', () => {
  it('documents the locker model and proof RPC exception', () => {
    expect(LOCKER_DOC).toMatch(/per-athlete locker/i);
    expect(LOCKER_DOC).toMatch(/create_workout_proof_attachment/);
    expect(LOCKER_DOC).toMatch(/is_coach/);
    expect(LOCKER_DOC).toMatch(/COACH_EMAILS/);
  });

  it('keeps client COACH_EMAILS identical to SQL is_coach() allowlist', () => {
    const sqlEmails = emailsInIsCoachSql(IS_COACH_SQL);
    const jsEmails = [...COACH_EMAILS].map((e) => e.toLowerCase()).sort();
    expect(jsEmails).toEqual(sqlEmails);
  });

  it('keeps roster exclusion constants as exact (user_id, email) pairs with the production seed', () => {
    const seedPairs = [...EXCLUSION_SEED.matchAll(
      /\('([0-9a-f-]{36})'::uuid,\s*'([^']+@[^']+)'/gi,
    )].map((m) => `${m[1].toLowerCase()}|${m[2].toLowerCase()}`).sort();

    expect(ROSTER_EXCLUDED_USER_IDS).toHaveLength(ROSTER_EXCLUDED_EMAILS.length);
    const jsPairs = ROSTER_EXCLUDED_USER_IDS
      .map((id, index) => `${String(id).toLowerCase()}|${String(ROSTER_EXCLUDED_EMAILS[index]).toLowerCase()}`)
      .sort();

    expect(jsPairs).toEqual(seedPairs);
    expect(seedPairs).toEqual(jsPairs);
  });
});
