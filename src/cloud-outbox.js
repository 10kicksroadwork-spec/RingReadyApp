import { readJSONValue, writeJSON } from './safe-storage.js';

export const CLOUD_OUTBOX_KEY_PREFIX = 'ringReadyCloudOutbox:';

function outboxStorageKey(userId) {
  return `${CLOUD_OUTBOX_KEY_PREFIX}${String(userId || '').trim()}`;
}

function emptyOutbox() {
  return { sprintSessions: [] };
}

export function readCloudOutbox(userId) {
  const outbox = readJSONValue(outboxStorageKey(userId), emptyOutbox());
  return {
    sprintSessions: Array.isArray(outbox?.sprintSessions) ? outbox.sprintSessions : [],
  };
}

function writeCloudOutbox(userId, outbox) {
  writeJSON(outboxStorageKey(userId), {
    sprintSessions: Array.isArray(outbox?.sprintSessions) ? outbox.sprintSessions : [],
  });
}

export function enqueuePendingSprintSession(record, userId) {
  const normalizedUserId = String(userId || '').trim();
  const sessionId = String(record?.id || '').trim();
  if (!normalizedUserId || !sessionId) return false;

  const outbox = readCloudOutbox(normalizedUserId);
  const nextRecord = { ...record, cloudPending: true };
  outbox.sprintSessions = [
    nextRecord,
    ...outbox.sprintSessions.filter((row) => String(row?.id || '') !== sessionId),
  ].slice(0, 50);
  writeCloudOutbox(normalizedUserId, outbox);
  return true;
}

export function removePendingSprintSession(sessionId, userId) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedUserId || !normalizedSessionId) return false;

  const outbox = readCloudOutbox(normalizedUserId);
  const nextSessions = outbox.sprintSessions.filter((row) => String(row?.id || '') !== normalizedSessionId);
  if (nextSessions.length === outbox.sprintSessions.length) return false;
  writeCloudOutbox(normalizedUserId, { sprintSessions: nextSessions });
  return true;
}

export function getPendingSprintSessions(userId) {
  return readCloudOutbox(userId).sprintSessions.filter((row) => row?.cloudPending);
}

export function clearCloudOutbox(userId) {
  writeCloudOutbox(userId, emptyOutbox());
}
