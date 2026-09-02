import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PROFILE_STORAGE_KEY, STORAGE_KEY } from '../src/constants.js';
import { HR_INFO_STORAGE_KEY } from '../src/app-content.js';
import {
  resetVolatileStorageForTest,
  resetStorageAvailabilityCache,
  writeJSON,
  isStorageKeyTombstoned,
  readJSONValue,
} from '../src/safe-storage.js';
import {
  clearSharedLocalState,
  hasSharedAthleteCacheData,
  shouldClearSharedStateOnSwitch,
  shouldFailClosedClearSharedCache,
} from '../src/account-switch.js';
import { cloudHydrationTestHooks } from '../src/shell.js';

const mockUser = { id: 'user-a' };

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  saveCloudWorkoutCompletion: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  saveCloudMileTest: vi.fn(),
  saveCloudProfile: vi.fn(),
  saveCloudHRInfo: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  archiveAndResetCamp: vi.fn(),
  clearAuthRedirectParams: vi.fn(),
  isPasswordRecoveryRedirect: vi.fn(() => false),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock('../src/coach-preview.js', () => ({
  canAccessCoachScreens: vi.fn(() => false),
  initCoachPreview: vi.fn(),
  isCoachScreen: vi.fn(() => false),
  openCoachPreviewIfRequested: vi.fn(),
  refreshCoachPreview: vi.fn(),
  renderCoachPage: vi.fn(),
  setSelectedCoachAthlete: vi.fn(),
  syncCoachPreviewChrome: vi.fn(),
}));

describe('Charlie cache ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    cloudHydrationTestHooks.invalidateCloudHydration();
  });

  it('clears shared cache when the last cache owner differs from the signed-in user', () => {
    expect(shouldClearSharedStateOnSwitch('user-a', 'user-b')).toBe(true);
    expect(shouldClearSharedStateOnSwitch('', 'user-b')).toBe(false);
  });

  it('fails closed when shared athlete cache exists without a cache owner marker', () => {
    writeJSON(PROFILE_STORAGE_KEY, { athleteName: 'Athlete A' });
    expect(hasSharedAthleteCacheData()).toBe(true);
    expect(shouldFailClosedClearSharedCache('', 'user-b')).toBe(true);
    expect(shouldFailClosedClearSharedCache('user-b', 'user-b')).toBe(false);
  });

  it('clears stale user-a profile before user-b hydration when owner marker survives logout', () => {
    writeJSON(PROFILE_STORAGE_KEY, { athleteName: 'Athlete A', updatedAt: '2026-01-01T00:00:00.000Z' });
    writeJSON(HR_INFO_STORAGE_KEY, { maxHr: 190, updatedAt: '2026-01-01T00:00:00.000Z' });
    localStorage.setItem('ringReadyAuthUserId', 'user-a');

    mockUser.id = 'user-b';
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(hasSharedAthleteCacheData()).toBe(false);
    expect(localStorage.getItem('ringReadyAuthUserId')).toBe('user-b');
  });

  it('clears shared cache when owner marker is missing but athlete data exists', () => {
    writeJSON(STORAGE_KEY, [{ id: 'session-a', date: '2026-01-01T00:00:00.000Z' }]);
    expect(localStorage.getItem('ringReadyAuthUserId')).toBeNull();

    mockUser.id = 'user-b';
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(hasSharedAthleteCacheData()).toBe(false);
    expect(localStorage.getItem('ringReadyAuthUserId')).toBe('user-b');
  });

  it('keeps shared cache hidden after a volatile profile removal during logout and reload', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ athleteName: 'Athlete A' }));
    localStorage.setItem('ringReadyAuthUserId', 'user-a');

    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function blockingRemoveItem(key) {
      if (String(key) === PROFILE_STORAGE_KEY) {
        throw new DOMException('Access to storage is not allowed', 'SecurityError');
      }
      return originalRemove.call(this, key);
    };

    try {
      clearSharedLocalState();
      expect(hasSharedAthleteCacheData()).toBe(false);
    } finally {
      Storage.prototype.removeItem = originalRemove;
    }

    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)).athleteName).toBe('Athlete A');
    expect(localStorage.getItem('ringReadyAuthUserId')).toBe('user-a');

    mockUser.id = 'user-b';
    cloudHydrationTestHooks.prepareAccountSwitchSafety();
    expect(hasSharedAthleteCacheData()).toBe(false);
  });

  it('fails closed when localStorage is unreadable during sign-in and keeps A hidden after recovery', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ athleteName: 'Athlete A' }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'session-a', date: '2026-01-01T00:00:00.000Z' }]));

    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access to storage is not allowed', 'SecurityError');
      },
    });

    try {
      mockUser.id = 'user-b';
      cloudHydrationTestHooks.prepareAccountSwitchSafety();
      expect(isStorageKeyTombstoned(PROFILE_STORAGE_KEY)).toBe(true);
      expect(isStorageKeyTombstoned(STORAGE_KEY)).toBe(true);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }

    resetStorageAvailabilityCache();
    expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)).athleteName).toBe('Athlete A');
    expect(readJSONValue(PROFILE_STORAGE_KEY, null)).toBeNull();
    expect(hasSharedAthleteCacheData()).toBe(false);
  });
});
