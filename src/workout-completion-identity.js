/** Workout completion identity helpers shared by cloud saves and athlete UX. */

export function isDuplicateWorkoutIdentityError(error) {
  const code = String(error?.code || error?.error_code || '').toUpperCase();
  if (code === '23505') return true;
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('duplicate key')
    || message.includes('unique constraint')
    || message.includes('workout_completions_user_id_week_index_workout_index_key')
    || message.includes('workout_completions_user_completion_key_idx')
    || message.includes('workout_completions_user_client_record_id_idx');
}

export function athleteFacingWorkoutSaveError(error) {
  if (isDuplicateWorkoutIdentityError(error)) {
    return 'WORKOUT ALREADY EXISTS — REFRESHING SAVED RESULT';
  }
  return String(error?.message || error || 'Could not save workout');
}
