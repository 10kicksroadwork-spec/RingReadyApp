import { describe, expect, it, afterEach } from 'vitest';
import {
  doesActiveSprintOwnNavigation,
  screenIdForSprintNavigation,
  setActiveSprintOwnsNavigation,
} from '../src/sprint-navigation.js';

describe('sprint navigation ownership', () => {
  afterEach(() => {
    setActiveSprintOwnsNavigation(false);
  });

  it('leaves requested screens unchanged when a Sprint does not own navigation', () => {
    expect(screenIdForSprintNavigation('home')).toBe('home');
    expect(screenIdForSprintNavigation('setup')).toBe('setup');
    expect(screenIdForSprintNavigation('workout-detail')).toBe('workout-detail');
  });

  it('keeps session/results/auth reachable while a Sprint owns navigation', () => {
    setActiveSprintOwnsNavigation(true);
    expect(doesActiveSprintOwnNavigation()).toBe(true);
    expect(screenIdForSprintNavigation('session')).toBe('session');
    expect(screenIdForSprintNavigation('results')).toBe('results');
    expect(screenIdForSprintNavigation('auth')).toBe('auth');
  });

  it('reroutes Home/Setup/Workout Detail to session while a Sprint owns navigation', () => {
    setActiveSprintOwnsNavigation(true);
    expect(screenIdForSprintNavigation('home')).toBe('session');
    expect(screenIdForSprintNavigation('setup')).toBe('session');
    expect(screenIdForSprintNavigation('workout-detail')).toBe('session');
    expect(screenIdForSprintNavigation('onboarding-gate')).toBe('session');
    expect(screenIdForSprintNavigation('boot')).toBe('session');
  });
});
