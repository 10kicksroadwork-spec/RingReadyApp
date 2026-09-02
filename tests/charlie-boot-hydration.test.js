import { describe, expect, it, beforeEach, vi } from 'vitest';

const mockUser = { id: 'user-a' };

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
}));

import { cloudHydrationTestHooks } from '../src/shell.js';

describe('Charlie background hydration guard', () => {
  beforeEach(() => {
    mockUser.id = 'user-a';
    cloudHydrationTestHooks.invalidateCloudHydration();
  });

  it('allows hydration results for the current user and generation', () => {
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    expect(cloudHydrationTestHooks.shouldApplyCloudHydration('user-a', generation)).toBe(true);
  });

  it('discards stale hydration after logout invalidates generation', () => {
    const staleGeneration = cloudHydrationTestHooks.getHydrationGeneration();
    cloudHydrationTestHooks.invalidateCloudHydration();
    expect(cloudHydrationTestHooks.shouldApplyCloudHydration('user-a', staleGeneration)).toBe(false);
  });

  it('discards hydration when account switches before results apply', () => {
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    mockUser.id = 'user-b';
    expect(cloudHydrationTestHooks.shouldApplyCloudHydration('user-a', generation)).toBe(false);
  });
});
