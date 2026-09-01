/**
 * Sign-out orchestration shared by shell logout handling.
 */

export async function performSignOutCleanup({
  getCurrentUser,
  signOut,
  clearAccountLocalData,
}) {
  const userId = getCurrentUser()?.id;
  await signOut();
  clearAccountLocalData(userId);
  return userId || '';
}
