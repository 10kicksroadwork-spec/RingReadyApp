import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('architecture-check', () => {
  it('passes against the current src tree', () => {
    const output = execFileSync('node', ['scripts/architecture-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('architecture-check OK');
  });
});
