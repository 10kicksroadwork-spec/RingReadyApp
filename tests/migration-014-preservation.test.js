import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const migration014 = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/migrations/014_workout_modality_output.sql'),
  'utf8',
);

describe('migration 014 sql safety', () => {
  it('wraps changes in a transaction', () => {
    expect(migration014).toMatch(/\bbegin;/i);
    expect(migration014).toMatch(/commit;/i);
  });

  it('repairs legacy machine distance=0 artifacts before constraints', () => {
    expect(migration014).toMatch(/where modality in \('assault_bike', 'rower', 'stationary_bike'\)\s+and distance = 0/s);
  });

  it('raises when machine rows have positive distance', () => {
    expect(migration014).toMatch(/raise exception/i);
    expect(migration014).toMatch(/machine workout rows contain positive distance values/i);
  });

  it('adds cross-field modality/output consistency check', () => {
    expect(migration014).toMatch(/workout_completions_modality_output_check/);
  });

  it('backfills modality before setting not null', () => {
    const notNullIndex = migration014.indexOf('alter column modality set not null');
    const backfillIndex = migration014.indexOf('Backfill modality');
    expect(backfillIndex).toBeGreaterThan(-1);
    expect(notNullIndex).toBeGreaterThan(backfillIndex);
  });
});
