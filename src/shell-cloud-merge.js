/** Cloud merge helpers shared by athlete hydration. */

export function getCloudTimestamp(record) {
  const value = record?.completedAt || record?.savedAt || record?.date || record?.workoutLog?.completedAt || '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function getRecordUpdatedAt(record) {
  const value = record?.updatedAt || record?.updated_at || '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function mergeProfileByTimestamp(localProfile = {}, cloudProfile = {}) {
  const localTs = getRecordUpdatedAt(localProfile);
  const cloudTs = getRecordUpdatedAt(cloudProfile);
  if (!localTs && cloudTs) return { ...localProfile, ...cloudProfile };
  if (localTs && !cloudTs) return localProfile;
  if (cloudTs >= localTs) return { ...localProfile, ...cloudProfile };
  return localProfile;
}

export function mergeHRByTimestamp(localHR = {}, cloudHR = {}, defaults = {}) {
  const localTs = getRecordUpdatedAt(localHR);
  const cloudTs = getRecordUpdatedAt(cloudHR);
  if (!localTs && cloudTs) return { ...defaults, ...localHR, ...cloudHR };
  if (localTs && !cloudTs) return { ...defaults, ...localHR };
  if (cloudTs >= localTs) return { ...defaults, ...localHR, ...cloudHR };
  return { ...defaults, ...localHR };
}

export function mergeWorkoutCompletions(localCompletions = {}, cloudCompletions = {}, isClearedFn) {
  const merged = { ...localCompletions };
  Object.entries(cloudCompletions || {}).forEach(([key, cloudRecord]) => {
    const cloudStamp = cloudRecord?.updatedAt || cloudRecord?.completedAt || cloudRecord?.updated_at || cloudRecord?.date || '';
    if (isClearedFn?.(key, null, cloudStamp)) {
      delete merged[key];
      return;
    }
    const localRecord = merged[key];
    if (!localRecord || getCloudTimestamp(cloudRecord) >= getCloudTimestamp(localRecord)) merged[key] = cloudRecord;
  });
  Object.keys(merged).forEach((key) => {
    if (isClearedFn?.(key)) delete merged[key];
  });
  return merged;
}

export function mergeSprintSessions(localSessions = [], cloudSessions = []) {
  const byId = new Map();
  [...cloudSessions, ...localSessions].forEach((record) => {
    if (!record) return;
    const id = String(record.id || record.sessionId || record.date || Math.random());
    const existing = byId.get(id);
    if (!existing || getCloudTimestamp(record) >= getCloudTimestamp(existing)) byId.set(id, record);
  });
  return Array.from(byId.values()).sort((a, b) => getCloudTimestamp(b) - getCloudTimestamp(a)).slice(0, 50);
}

export function chooseLatestMileResult(localResult, cloudResult) {
  if (!localResult) return cloudResult || null;
  if (!cloudResult) return localResult;
  return getCloudTimestamp(cloudResult) >= getCloudTimestamp(localResult) ? cloudResult : localResult;
}
