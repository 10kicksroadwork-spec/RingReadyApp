import { describe, expect, it } from 'vitest';
import {
  findSprintProofAttachment,
  isCurrentProofAttachment,
  proofTransferLabel,
  sessionHasProof,
} from '../src/coach-proof.js';

const USER = 'user-a';
const SESSION = 'sprint-session-1';

function sprintRow(overrides = {}) {
  return {
    user_id: USER,
    session_id: SESSION,
    week_index: 1,
    workout_index: 0,
    attachment_id: null,
    ...overrides,
  };
}

function attachment(overrides = {}) {
  return {
    user_id: USER,
    linked_record_id: SESSION,
    is_current: true,
    completion_cleared: false,
    transfer_status: 'complete',
    drive_url: '',
    ...overrides,
  };
}

describe('coach sprint proof resolution', () => {
  it('A: sprint attachment_id populated => proof exists', () => {
    expect(sessionHasProof({
      row: { attachment_id: 'proof-1' },
      sprintRow: sprintRow(),
      isSprint: true,
    })).toBe(true);
  });

  it('B: sprint attachment_id NULL + matching current proof => no proof gap', () => {
    const attachments = [attachment({ id: 'proof-1', drive_url: 'https://drive.google.com/file/1' })];
    expect(sessionHasProof({
      row: { attachment_id: null },
      sprintRow: sprintRow(),
      attachments,
      isSprint: true,
      weekIndex: 1,
      workoutIndex: 0,
    })).toBe(true);
  });

  it('C: matching proof with transfer_status=processing => proof exists', () => {
    const attachments = [attachment({ id: 'proof-1', transfer_status: 'processing', drive_url: '' })];
    expect(sessionHasProof({
      row: { attachment_id: null },
      sprintRow: sprintRow(),
      attachments,
      isSprint: true,
      weekIndex: 1,
      workoutIndex: 0,
    })).toBe(true);
    expect(proofTransferLabel(attachments[0])).toBe('processing');
  });

  it('D: no proof record => proof gap', () => {
    expect(sessionHasProof({
      row: { attachment_id: null },
      sprintRow: sprintRow(),
      attachments: [],
      isSprint: true,
      weekIndex: 1,
      workoutIndex: 0,
    })).toBe(false);
  });

  it('E: proof from another athlete => proof gap', () => {
    const attachments = [attachment({ user_id: 'user-b' })];
    expect(findSprintProofAttachment(attachments, sprintRow(), 1, 0)).toBeNull();
    expect(sessionHasProof({
      row: { attachment_id: null },
      sprintRow: sprintRow(),
      attachments,
      isSprint: true,
      weekIndex: 1,
      workoutIndex: 0,
    })).toBe(false);
  });

  it('F: non-current or cleared attachment => proof gap', () => {
    expect(isCurrentProofAttachment(attachment({ is_current: false }))).toBe(false);
    expect(isCurrentProofAttachment(attachment({ completion_cleared: true }))).toBe(false);
    expect(sessionHasProof({
      row: { attachment_id: null },
      sprintRow: sprintRow(),
      attachments: [attachment({ is_current: false })],
      isSprint: true,
      weekIndex: 1,
      workoutIndex: 0,
    })).toBe(false);
  });

  it('matches sprint proof by session_id even when week/workout differ in attachment', () => {
    const attachments = [attachment({ week_index: 99, workout_index: 99 })];
    expect(findSprintProofAttachment(attachments, sprintRow(), 1, 0)?.linked_record_id).toBe(SESSION);
  });

  it('does not treat daily rows as sprint attachment matches', () => {
    expect(sessionHasProof({
      row: { attachment_id: null },
      sprintRow: null,
      attachments: [attachment()],
      isSprint: false,
    })).toBe(false);
  });
});
