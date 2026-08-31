import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
}));

import { getAthleteProfile, saveAthleteProfile } from '../src/sync.js';

const mockUser = { id: 'user-a' };

describe('profile timestamp persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stamps updatedAt on user edit', () => {
    saveAthleteProfile({ athleteName: 'Marcus', updatedAt: '2020-01-01T00:00:00.000Z' });
    const saved = getAthleteProfile();
    expect(saved.athleteName).toBe('Marcus');
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00.000Z').getTime());
  });

  it('preserves cloud updatedAt during hydration', () => {
    saveAthleteProfile({
      athleteName: 'Cloud',
      updatedAt: '2026-08-02T00:00:00.000Z',
    }, { preserveUpdatedAt: true });
    expect(getAthleteProfile().updatedAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('advances timestamp when editing a profile hydrated with an old cloud timestamp', () => {
    saveAthleteProfile({ athleteName: 'Cloud', updatedAt: '2020-01-01T00:00:00.000Z' }, { preserveUpdatedAt: true });
    saveAthleteProfile({ athleteName: 'Edited Locally' });
    const profile = getAthleteProfile();
    expect(profile.athleteName).toBe('Edited Locally');
    expect(new Date(profile.updatedAt).getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00.000Z').getTime());
  });
});
