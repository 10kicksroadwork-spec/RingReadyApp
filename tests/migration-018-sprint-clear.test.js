import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('migration 018 sprint cleanup scope', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'scripts/migrations/018_clear_retry_and_sprint_proof.sql'),
    'utf8',
  );

  it('clears Sprint recovery by client_record_id when available', () => {
    expect(sql).toMatch(/session_id\s*=\s*v_client_record_id/);
  });

  it('adds a tightly scoped attachment + week/workout fallback for legacy rows', () => {
    expect(sql).toMatch(/attachment_id\s*=\s*v_attachment_id/);
    expect(sql).toMatch(/week_index\s*=\s*p_week_index/);
    expect(sql).toMatch(/workout_index\s*=\s*p_workout_index/);
  });

  it('does not clear every Sprint for the assignment without attachment identity', () => {
    expect(sql).not.toMatch(/where user_id = v_user_id\s+and week_index = p_week_index\s+and workout_index = p_workout_index\s*;/);
  });
});
