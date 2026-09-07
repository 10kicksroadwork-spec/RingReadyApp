import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => ({ id: 'athlete-a' })),
}));

import { getCurrentUser } from '../src/auth.js';
import {
  AthleteMutationBusyError,
  clearAthleteMutationLocksForTest,
  invalidateAthleteOperations,
  isAssignmentBusy,
  runAthleteMutation,
} from '../src/athlete-operation.js';
import { clearAthleteDrafts, saveWorkoutDraft, readWorkoutDraft } from '../src/workout-draft.js';
import { writeJSON } from '../src/safe-storage.js';

describe('athlete mutation coordinator', () => {
  beforeEach(() => {
    clearAthleteMutationLocksForTest();
    getCurrentUser.mockReturnValue({ id: 'athlete-a' });
  });

  afterEach(() => {
    clearAthleteMutationLocksForTest();
    invalidateAthleteOperations();
  });

  it('coalesces repeated Complete operations onto one flight', async () => {
    let runs = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const first = runAthleteMutation('0:1', 'complete', async () => {
      runs += 1;
      await gate;
      return 'saved';
    });
    const second = runAthleteMutation('0:1', 'complete', async () => {
      runs += 1;
      return 'second';
    });

    expect(second).toBe(first);
    expect(isAssignmentBusy('0:1')).toBe(true);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(['saved', 'saved']);
    expect(runs).toBe(1);
    expect(isAssignmentBusy('0:1')).toBe(false);
  });

  it('rejects Clear while Complete is in flight instead of inheriting the save Promise', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const complete = runAthleteMutation('0:1', 'complete', async () => {
      await gate;
      return 'saved';
    });

    await expect(runAthleteMutation('0:1', 'clear', async () => 'cleared'))
      .rejects.toBeInstanceOf(AthleteMutationBusyError);

    let clearRan = false;
    try {
      await runAthleteMutation('0:1', 'clear', async () => {
        clearRan = true;
        return 'cleared';
      });
    } catch (error) {
      expect(error.busy).toBe(true);
      expect(error.message).toMatch(/SAVE IN PROGRESS/i);
    }
    expect(clearRan).toBe(false);

    release();
    await expect(complete).resolves.toBe('saved');
  });

  it('rejects Complete while Clear is in flight', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const clear = runAthleteMutation('0:1', 'clear', async () => {
      await gate;
      return 'cleared';
    });

    await expect(runAthleteMutation('0:1', 'complete', async () => 'saved'))
      .rejects.toMatchObject({ busy: true });

    release();
    await expect(clear).resolves.toBe('cleared');
  });

  it('rejects Skip while Complete is in flight', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const complete = runAthleteMutation('0:1', 'complete', async () => {
      await gate;
      return 'saved';
    });

    await expect(runAthleteMutation('0:1', 'skip', async () => 'skipped'))
      .rejects.toMatchObject({ busy: true, activeOperation: 'complete', requestedOperation: 'skip' });

    release();
    await expect(complete).resolves.toBe('saved');
  });
});

describe('outgoing athlete draft cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
    getCurrentUser.mockReturnValue({ id: 'athlete-a' });
  });

  it('removes the outgoing athlete proof and workout drafts by explicit owner id', () => {
    saveWorkoutDraft('detail:0:1', { totalMinutes: 20 });
    writeJSON('ringReadyProofDraft:athlete-a:program:7:0:1', { dataUrl: 'data:image/png;base64,aaa' });
    writeJSON('ringReadyDraft:athlete-b:detail:0:1', { totalMinutes: 99 });
    writeJSON('ringReadyProofDraft:athlete-b:program:7:0:1', { dataUrl: 'data:image/png;base64,bbb' });

    getCurrentUser.mockReturnValue({ id: 'athlete-b' });
    clearAthleteDrafts('athlete-a');

    expect(localStorage.getItem('ringReadyDraft:athlete-a:detail:0:1')).toBeNull();
    expect(localStorage.getItem('ringReadyProofDraft:athlete-a:program:7:0:1')).toBeNull();
    expect(localStorage.getItem('ringReadyDraft:athlete-b:detail:0:1')).toBeTruthy();
    expect(localStorage.getItem('ringReadyProofDraft:athlete-b:program:7:0:1')).toBeTruthy();
    expect(readWorkoutDraft('detail:0:1')).toEqual(expect.objectContaining({ totalMinutes: 99 }));
  });
});
