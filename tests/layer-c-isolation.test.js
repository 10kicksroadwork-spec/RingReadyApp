import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync('scripts/test-proof-authorization.mjs', 'utf8');

function workoutInsertBlocks(source) {
  const blocks = [];
  const re = /\.from\(\s*['"]workout_completions['"]\s*\)\s*\.insert\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const start = match.index;
    const openParen = source.indexOf('(', match.index + match[0].lastIndexOf('('));
    let depth = 0;
    let end = openParen;
    for (let i = openParen; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    blocks.push(source.slice(start, end));
  }
  return blocks;
}

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

  it('keeps the real-slot 1:2 canary strictly read-only', () => {
    expect(SCRIPT).toMatch(/REAL_CANARY_KEY = '1:2'/);
    expect(SCRIPT).toMatch(/READ-ONLY/);
    expect(SCRIPT).toMatch(/must never write real program slots/i);
    expect(SCRIPT).not.toMatch(/canaryCreatedByThisRun/);
    expect(SCRIPT).not.toMatch(/canaryCleanupIds/);
    expect(SCRIPT).toMatch(/Real 1:2 must remain absent when it was absent before Layer C/);
    expect(SCRIPT).toMatch(/Real 1:2 proof_pending must remain unchanged/);
  });

  it('must never INSERT a workout_completions row for real athlete slot 1:2', () => {
    const seedLiterals = [...SCRIPT.matchAll(/completion_key:\s*['"]1:2['"]/g)];
    expect(seedLiterals).toHaveLength(0);

    const inserts = workoutInsertBlocks(SCRIPT);
    expect(inserts.length).toBeGreaterThan(0);
    for (const block of inserts) {
      expect(block).not.toMatch(/completion_key:\s*REAL_CANARY_KEY/);
      expect(block).not.toMatch(/completion_key:\s*['"]1:2['"]/);
      expect(block).not.toMatch(/week_index:\s*REAL_CANARY_WEEK/);
      expect(block).not.toMatch(/workout_index:\s*REAL_CANARY_WORKOUT/);
      expect(block).not.toMatch(/week_index:\s*1\b/);
      expect(block).not.toMatch(/workout_index:\s*2\b[\s\S]{0,40}week_index:\s*1\b/);
    }
  });

  it('does not hardcode the real athlete slot 1:2 as a Layer C seed identity', () => {
    expect(SCRIPT).toMatch(/allocTestSlot\(/);
    expect(SCRIPT).toMatch(/ownedSlot\.completionKey/);
    expect(SCRIPT).not.toMatch(/completion_key:\s*['"]1:2['"]/);
  });

  it('asserts generated weeks stay outside the real program domain', () => {
    expect(SCRIPT).toMatch(/must be outside real program domain/);
    expect(SCRIPT).toMatch(/testSlotBase > MAX_REAL_PROGRAM_WEEK_INDEX/);
    expect(SCRIPT).toMatch(/assertOutsideRealProgram\(/);
  });

  it('cleans up only IDs created by the current run', () => {
    expect(SCRIPT).toMatch(/createdWorkoutIds\.push/);
    expect(SCRIPT).toMatch(/workoutIds:\s*createdWorkoutIds/);
    expect(SCRIPT).toMatch(/Read-only 1:2 canary must never enter createdWorkoutIds/);
  });
});
