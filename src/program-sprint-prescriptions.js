/** Server-canonical sprint prescriptions — must match scripts/migrations/010_sprint_ble_verification.sql */

export const PROGRAM_SPRINT_PRESCRIPTIONS = [
  { weekIndex: 0, workoutIndex: 0, reps: 5, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
  { weekIndex: 1, workoutIndex: 0, reps: 6, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
  { weekIndex: 2, workoutIndex: 0, reps: 8, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
  { weekIndex: 3, workoutIndex: 0, reps: 5, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
  { weekIndex: 4, workoutIndex: 0, reps: 10, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
  { weekIndex: 5, workoutIndex: 0, reps: 5, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
];

export function getCanonicalSprintPrescription(weekIndex, workoutIndex) {
  const week = Number(weekIndex);
  const workout = Number(workoutIndex);
  if (!Number.isFinite(week) || !Number.isFinite(workout)) return null;
  return PROGRAM_SPRINT_PRESCRIPTIONS.find(
    (row) => row.weekIndex === week && row.workoutIndex === workout,
  ) || null;
}
