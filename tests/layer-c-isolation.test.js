import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(new URL('../scripts/test-proof-authorization.mjs', import.meta.url), 'utf8');

describe('Layer C workout identity isolation', () => {
  it('defines a real-program ceiling and run-specific slot allocator', () => {
    expect(SCRIPT).toMatch(/MAX_REAL_PROGRAM_WEEK_INDEX\s*=\s*6/);
    expect(SCRIPT).toMatch(/const testSlotBase = 100000 \+/);
    expect(SCRIPT).toMatch(/function allocTestSlot\(/);
    expect(SCRIPT).toMatch(/function insertWorkoutOrFailClosed\(/);
  });

  it('fails closed on unique collisions without deleting pre-existing rows', () => {
    expect(SCRIPT).toMatch(/FAIL CLOSED/);
    expect(SCRIPT).toMatch(/did not delete the existing row/);
    // Cleanup must target tracked IDs only — never wipe by completion_key/position.
    expect(SCRIPT).not.toMatch(/\.from\(['"]workout_completions['"]\)\s*\.delete\(\)[\s\S]{0,80}\.eq\(['"]completion_key['"]/);
    expect(SCRIPT).not.toMatch(/\.from\(['"]workout_completions['"]\)\s*\.delete\(\)[\s\S]{0,80}\.eq\(['"]week_index['"]/);
  });

  it('does not hardcode the real athlete slot 1:2 as a Layer C seed identity', () => {
    // Only the isolation canary may reference completion_key 1:2.
    const seedLiterals = [...SCRIPT.matchAll(/completion_key:\s*['"]1:2['"]/g)];
    expect(seedLiterals).toHaveLength(0);
    expect(SCRIPT).toMatch(/REAL_CANARY_KEY = '1:2'/);
    expect(SCRIPT).toMatch(/completion_key:\s*REAL_CANARY_KEY/);
    expect(SCRIPT).toMatch(/allocTestSlot\(/);
    expect(SCRIPT).toMatch(/ownedSlot\.completionKey/);
  });

  it('asserts generated weeks stay outside the real program domain', () => {
    expect(SCRIPT).toMatch(/must be outside real program domain/);
    expect(SCRIPT).toMatch(/testSlotBase > MAX_REAL_PROGRAM_WEEK_INDEX/);
    expect(SCRIPT).toMatch(/Real 1:2 canary row ID must remain unchanged/);
  });

  it('cleans up only IDs created by the current run', () => {
    expect(SCRIPT).toMatch(/createdWorkoutIds\.push/);
    expect(SCRIPT).toMatch(/safeWorkoutCleanupIds/);
    expect(SCRIPT).toMatch(/canaryCleanupIds/);
    expect(SCRIPT).toMatch(/Isolation canary must never enter createdWorkoutIds cleanup list/);
  });
});
