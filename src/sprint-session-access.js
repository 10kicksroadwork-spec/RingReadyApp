/**
 * Canonical access helpers for finished Sprint session records.
 *
 * A finished Sprint session may exist before the corresponding program
 * workout is finalized with proof. These helpers let the athlete shell
 * recover that saved result by its assigned week/workout position.
 */

function getWorkoutContext(record) {
  const nested = record?.cfg?.workoutContext || record?.workoutContext || null;
  if (nested) return nested;

  const weekIndex = record?.weekIndex ?? record?.week_index;
  const workoutIndex = record?.workoutIndex ?? record?.workout_index;
  if (weekIndex == null && workoutIndex == null) return null;
  return { weekIndex, workoutIndex };
}

function parseRecordTime(record) {
  const value =
    record?.completedAt
    || record?.date
    || record?.sessionAt
    || record?.session_at
    || '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function hasSavedSprintResults(record) {
  return (
    !!record
    && Array.isArray(record.data)
    && record.data.length > 0
  );
}

export function sprintSessionMatchesWorkout(
  record,
  weekIndex,
  workoutIndex,
) {
  if (!hasSavedSprintResults(record)) return false;
  const context = getWorkoutContext(record);
  if (!context) return false;
  const recordWeek = Number(context.weekIndex);
  const recordWorkout = Number(context.workoutIndex);
  const targetWeek = Number(weekIndex);
  const targetWorkout = Number(workoutIndex);
  if (
    !Number.isFinite(recordWeek)
    || !Number.isFinite(recordWorkout)
    || !Number.isFinite(targetWeek)
    || !Number.isFinite(targetWorkout)
  ) {
    return false;
  }
  return (
    recordWeek === targetWeek
    && recordWorkout === targetWorkout
  );
}

export function getSprintSessionsForWorkout(
  sessions,
  weekIndex,
  workoutIndex,
) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((record) =>
      sprintSessionMatchesWorkout(
        record,
        weekIndex,
        workoutIndex,
      ))
    .sort((a, b) => parseRecordTime(b) - parseRecordTime(a));
}

export function getLatestSprintSessionForWorkout(
  sessions,
  weekIndex,
  workoutIndex,
) {
  return getSprintSessionsForWorkout(
    sessions,
    weekIndex,
    workoutIndex,
  )[0] || null;
}

/**
 * Prefer a finalized workout completion when it already carries interval
 * results; otherwise recover the saved Sprint session for this assignment.
 */
export function pickAssignedSprintResultRecord(completion, sprintSession) {
  if (hasSavedSprintResults(completion)) return completion;
  if (hasSavedSprintResults(sprintSession)) return sprintSession;
  return null;
}

export function hasSavedSprintAttachment(record) {
  const attachment = record?.attachment;
  if (attachment && typeof attachment === 'object') {
    return !!(attachment.id || attachment.storagePath || attachment.storage_path);
  }
  return !!(record?.attachmentId || record?.attachment_id);
}

export function getSprintRecoveryBannerCopy(record) {
  if (!record || record.completedAt) return null;
  if (hasSavedSprintAttachment(record)) {
    return {
      kicker: 'SPRINT SAVED',
      message: 'Finish saving this workout to your account.',
    };
  }
  return {
    kicker: 'SPRINT SAVED',
    message: 'Proof required to complete this workout.',
  };
}

function withActionCopy(state) {
  return { ...state, actionCopy: state.action };
}

/**
 * Home / detail presentation for an assigned Sprint workout.
 * Final completion is independent from a saved pre-proof Sprint session.
 */
export function resolveSprintProgramCardState({
  completion = null,
  sprintSession = null,
  skipped = false,
} = {}) {
  if (skipped) {
    return withActionCopy({
      tag: 'Skipped',
      action: 'SKIPPED',
      actionType: 'complete-workout',
      cardState: 'skipped',
      resultRecord: completion,
      isFinalized: false,
    });
  }

  if (completion) {
    const resultRecord = pickAssignedSprintResultRecord(completion, sprintSession) || completion;
    const canViewResults = hasSavedSprintResults(resultRecord);
    return withActionCopy({
      tag: 'Done',
      action: canViewResults ? 'RESULTS' : 'EDIT',
      actionType: canViewResults ? 'view-results' : 'sprint',
      cardState: 'completed',
      resultRecord,
      isFinalized: true,
    });
  }

  if (hasSavedSprintResults(sprintSession)) {
    const proofSaved = hasSavedSprintAttachment(sprintSession);
    return withActionCopy({
      tag: proofSaved ? 'Finish Save' : 'Proof Needed',
      action: 'RESULTS',
      actionType: 'view-results',
      cardState: proofSaved ? 'finish-save' : 'proof-needed',
      resultRecord: sprintSession,
      isFinalized: false,
    });
  }

  return withActionCopy({
    tag: 'Timer Ready',
    action: 'OPEN TIMER',
    actionType: 'sprint',
    cardState: '',
    resultRecord: null,
    isFinalized: false,
  });
}
