import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const migration014 = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/migrations/014_workout_modality_output.sql'),
  'utf8',
);

describe('migration 014 sql safety', () => {
  it('preserves existing SQL distance as a running fallback', () => {
    expect(migration014).toMatch(/when output_type = 'distance'\s+and distance is not null\s+then distance/s);
  });

  it('only nulls distance for machine output rows', () => {
    expect(migration014).toMatch(/where output_type = 'watts'\s+and distance is not null/s);
    expect(migration014).not.toMatch(/set distance = case\s+when output_type = 'distance' then output_value\s+else null/s);
  });

  it('uses null-only guards so reruns stay idempotent', () => {
    expect(migration014).toMatch(/where modality is null/);
    expect(migration014).toMatch(/where output_type is null/);
    expect(migration014).toMatch(/where avg_watts is null/);
    expect(migration014).toMatch(/where output_value is null/);
  });
});
