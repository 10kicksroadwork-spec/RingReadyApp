import './proof.css';
import { getCurrentUser } from './auth.js';
import { isSupabaseConfigured, supabase } from './supabase-client.js';
import { assertProofContractCurrent, getContractHealthDiagnosticDetail } from './contract-health.js';
import {
  AMBIGUOUS_PROOF_MESSAGE,
  createProofUploadError,
  isProofErrorAmbiguous,
  isProofErrorDeterministic,
  PROOF_UPLOAD_PHASE,
} from './proof-diagnostics.js';
import { OPERATION_TIMEOUT_MS, withOperationTimeout } from './operation-timeout.js';
import { captureRuntimeDiagnostic, sanitizeDiagnosticValue } from './runtime-diagnostics.js';
import { runProofTransportOperation } from './proof-transport.js';
import { runSingleFlight } from './single-flight.js';

export const PROOF_POLICY_VERSION = 1;
export const PROOF_BUCKET = 'workout-proof-staging';

const SOURCE_LIMIT_BYTES = 10 * 1024 * 1024;
const PROCESSED_LIMIT_BYTES = Math.round(2.5 * 1024 * 1024);
const MAX_EDGE = 1600;
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif']);
const EXTENSION_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|webp|heic|heif)$/i;
const states = new Map();
let listenersBound = false;
let cachedCanvasOutputMimeType = '';

function resolveImageMimeType(file) {
  const type = String(file?.type || '').toLowerCase();
  if (ACCEPTED_TYPES.has(type)) return type === 'image/jpg' ? 'image/jpeg' : type;
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  return EXTENSION_TYPES[extension] || '';
}

function isAcceptedImageFile(file) {
  if (!file) return false;
  if (resolveImageMimeType(file)) return true;
  return !file.type && IMAGE_EXTENSION_PATTERN.test(String(file.name || ''));
}

function getCanvasOutputMimeType() {
  if (cachedCanvasOutputMimeType) return cachedCanvasOutputMimeType;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  cachedCanvasOutputMimeType = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  return cachedCanvasOutputMimeType;
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function makeId() {
  return window.crypto?.randomUUID?.() || `proof-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safePathPart(value) {
  return String(value || 'workout').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'workout';
}

function buildStableStoragePath(userId, proofKey, uploadId, mimeType) {
  const extension = extensionForMimeType(mimeType);
  return `${userId}/${safePathPart(proofKey)}/${uploadId}.${extension}`;
}

function attachmentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    proofKey: row.proof_key,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    transferStatus: row.transfer_status,
    driveFileId: row.drive_file_id || '',
    driveUrl: row.drive_url || '',
    uploadedAt: row.uploaded_at,
    proofPolicyVersion: PROOF_POLICY_VERSION,
  };
}

function emitState(surface) {
  window.dispatchEvent(new CustomEvent('ringready:proof-state-changed', {
    detail: { surface, ready: hasWorkoutProof(surface), state: states.get(surface) },
  }));
}

function revokePreview(state) {
  if (state?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.previewUrl);
}

function clearStagedUploadIdentity(state) {
  if (!state) return;
  state.uploadId = null;
  state.storagePath = null;
}

function assignStagedUploadIdentity(state, mimeType) {
  const user = getCurrentUser();
  if (!user?.id) return;
  state.uploadId = makeId();
  state.storagePath = buildStableStoragePath(user.id, state.proofKey, state.uploadId, mimeType);
}

function isProofReplacementBlocked(state) {
  if (!state) return false;
  return !!(state.uploading || state.ambiguousRpcPending);
}

function snapshotProcessed(processed) {
  if (!processed) return null;
  return {
    blob: processed.blob,
    width: processed.width,
    height: processed.height,
    mimeType: processed.mimeType,
  };
}

function createProofAttempt(state, linkedRecordId = '') {
  const uploadMimeType = state.processed.blob.type || state.processed.mimeType || getCanvasOutputMimeType();
  if (!state.uploadId || !state.storagePath) {
    assignStagedUploadIdentity(state, uploadMimeType);
  }
  return Object.freeze({
    uploadId: state.uploadId,
    storagePath: state.storagePath,
    processed: snapshotProcessed(state.processed),
    filename: state.filename,
    proofKey: state.proofKey,
    context: { ...state.context },
    linkedRecordId: String(linkedRecordId || ''),
    uploadMimeType,
    uploadExtension: extensionForMimeType(uploadMimeType),
  });
}

async function removeStagedStorageBestEffort(storagePath) {
  try {
    await withOperationTimeout(
      supabase.storage.from(PROOF_BUCKET).remove([storagePath]),
      {
        timeoutMs: OPERATION_TIMEOUT_MS.STORAGE_UPLOAD,
        operation: 'proof_storage_cleanup',
      },
    );
  } catch (cleanupError) {
    console.warn('Could not remove staged proof object', cleanupError);
  }
}

function reconcileAttemptSuccess(state, attempt) {
  if (state.uploadId !== attempt.uploadId) return false;
  state.ambiguousRpcPending = null;
  state.ambiguousLinkedRecordId = null;
  state.processed = null;
  clearStagedUploadIdentity(state);
  revokePreview(state);
  state.previewUrl = '';
  return true;
}

function createProofRetryIdentityMismatchError() {
  const err = new Error('Proof retry identity mismatch. Refresh and try again.');
  err.proofFailureKind = 'proof_retry_identity_mismatch';
  err.proofFailurePhase = PROOF_UPLOAD_PHASE.RPC;
  err.proofAmbiguous = false;
  err.proofDeterministic = true;
  err.proofRetryable = false;
  err.proofDiagnosticDetail = 'proof_retry_identity_mismatch';
  err.proofPreserveProvisionalIdentity = true;
  return err;
}

async function maybeRemoveStagedStorageAfterProofFailure(attempt, error, hadUnresolvedAmbiguity) {
  const classified = error?.proofFailureKind ? error : createProofUploadError(error);
  if (
    isProofErrorDeterministic(classified)
    && !hadUnresolvedAmbiguity
    && !classified.proofPreserveProvisionalIdentity
    && classified.proofFailurePhase === PROOF_UPLOAD_PHASE.RPC
  ) {
    await removeStagedStorageBestEffort(attempt.storagePath);
  }
}

function finalizeProofFailure(state, attempt, error, hadUnresolvedAmbiguity) {
  if (error?.contractHealthStatus === 'mismatch') {
    if (hadUnresolvedAmbiguity) {
      error.proofPreserveProvisionalIdentity = true;
    }
    throw error;
  }

  const classified = error?.proofFailureKind ? error : createProofUploadError(error);
  if (isProofErrorAmbiguous(classified) || hadUnresolvedAmbiguity) {
    classified.proofPreserveProvisionalIdentity = true;
    state.ambiguousRpcPending = attempt.uploadId;
    state.ambiguousLinkedRecordId = state.ambiguousLinkedRecordId || attempt.linkedRecordId;
  } else if (isProofErrorDeterministic(classified)) {
    state.ambiguousRpcPending = null;
    state.ambiguousLinkedRecordId = null;
  }

  state.error = classified.message || AMBIGUOUS_PROOF_MESSAGE;
  captureRuntimeDiagnostic({
    kind: classified.proofFailureKind || 'proof_upload_failed',
    stage: 'proof_upload',
    detail: classified.proofDiagnosticDetail,
    message: classified.message,
  });
  console.warn('Workout proof upload failed', {
    kind: classified.proofFailureKind,
    phase: classified.proofFailurePhase,
    retryable: classified.proofRetryable,
    ambiguous: classified.proofAmbiguous,
    detail: classified.proofDiagnosticDetail,
    raw: sanitizeDiagnosticValue(classified.proofRawMessage),
  });
  throw classified;
}

function render(surface) {
  const state = states.get(surface);
  const host = document.querySelector(`[data-proof-host="${surface}"]`);
  if (!state || !host) return;

  const existing = state.existingAttachment;
  const selected = state.processed;
  const hasPreview = !!state.previewUrl;
  const legacy = state.legacy && !existing && !selected;
  const replacementBlocked = isProofReplacementBlocked(state);
  const statusClass = state.error ? 'error' : state.uploading ? 'uploading' : (existing || selected) ? 'ready' : '';
  const statusText = state.error
    || (state.ambiguousRpcPending ? 'Save is still confirming. Tap Save again before replacing this screenshot.'
      : state.uploading ? 'Uploading proof securely...'
        : selected ? 'Screenshot ready to upload.'
          : existing ? (existing.transferStatus === 'complete' ? 'Proof saved and copied for your coach.' : 'Proof saved. Coach copy is processing.')
            : legacy ? 'Legacy - no proof'
              : 'Required before this workout can be completed.');

  host.innerHTML = `
    <section class="workout-proof-card ${statusClass}">
      <div class="proof-head">
        <div>
          <div class="field-label">Workout Proof</div>
          <p>Upload a screenshot from Polar, Wahoo, Strava, or your workout app.</p>
        </div>
        <span class="proof-required">${legacy ? 'LEGACY' : 'REQUIRED'}</span>
      </div>
      ${hasPreview ? `<img class="proof-preview" src="${escapeHTML(state.previewUrl)}" alt="Selected workout screenshot preview">` : ''}
      <div class="proof-file-row">
        <div class="proof-file-copy">
          <strong>${escapeHTML(state.filename || existing?.originalFilename || (legacy ? 'Existing completion' : 'No screenshot selected'))}</strong>
          <span>${escapeHTML(statusText)}</span>
        </div>
        <label class="proof-picker-btn ${replacementBlocked ? 'is-disabled' : ''}">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp" data-proof-input="${surface}" ${replacementBlocked ? 'disabled' : ''}>
          ${existing || selected ? 'REPLACE' : 'CHOOSE IMAGE'}
        </label>
      </div>
    </section>`;
}

async function loadImageWithElement(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    image.src = url;
  });
}

async function loadImageWithBitmap(file) {
  return createImageBitmap(file);
}

export async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await loadImageWithBitmap(file);
    } catch (error) {
      captureRuntimeDiagnostic({
        kind: 'image_decode_fallback',
        stage: 'proof_process',
        detail: 'createImageBitmap_rejected',
        message: String(error?.message || error),
      });
      return loadImageWithElement(file);
    }
  }
  return loadImageWithElement(file);
}

async function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    if (mimeType === 'image/png') {
      canvas.toBlob(resolve, mimeType);
      return;
    }
    canvas.toBlob(resolve, mimeType, quality);
  });
}

async function processImage(file) {
  if (!isAcceptedImageFile(file)) throw new Error('Use a PNG, JPEG, or WebP screenshot.');
  if (file.size > SOURCE_LIMIT_BYTES) throw new Error('Screenshot must be 10 MB or smaller.');
  const image = await loadImage(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  image.close?.();
  const outputMimeType = getCanvasOutputMimeType();
  let quality = outputMimeType === 'image/jpeg' ? 0.88 : 0.88;
  let blob = await canvasToBlob(canvas, outputMimeType, quality);
  while (blob && outputMimeType !== 'image/png' && blob.size > PROCESSED_LIMIT_BYTES && quality > 0.5) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, outputMimeType, quality);
  }
  if (!blob) throw new Error('This browser could not process the screenshot.');
  if (blob.size > PROCESSED_LIMIT_BYTES) throw new Error('Processed screenshot is still over 2.5 MB. Try a smaller image.');
  const mimeType = blob.type || outputMimeType;
  return { blob, width, height, mimeType };
}

async function handleFile(surface, file) {
  const state = states.get(surface);
  if (!state || !file) return;
  if (isProofReplacementBlocked(state)) return;
  revokePreview(state);
  clearStagedUploadIdentity(state);
  state.ambiguousRpcPending = null;
  state.ambiguousLinkedRecordId = null;
  Object.assign(state, {
    processed: null,
    filename: file.name,
    previewUrl: '',
    error: '',
    uploading: true,
  });
  render(surface);
  emitState(surface);
  try {
    state.processed = await processImage(file);
    state.previewUrl = URL.createObjectURL(state.processed.blob);
    assignStagedUploadIdentity(state, state.processed.mimeType || getCanvasOutputMimeType());
  } catch (error) {
    state.error = String(error?.message || error);
  } finally {
    state.uploading = false;
    render(surface);
    emitState(surface);
  }
}

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-proof-input]');
    if (!input || input.disabled) return;
    handleFile(input.dataset.proofInput, input.files?.[0]);
    input.value = '';
  });
}

export function buildProgramProofKey(campLength, weekIndex, workoutIndex) {
  return `program:${String(campLength) === '4' ? 4 : 7}:${Number(weekIndex)}:${Number(workoutIndex)}`;
}

export function buildProofFlightKey(surface, proofKey = '', uploadId = '') {
  return `proof:${surface}:${proofKey || 'unknown'}:${uploadId || 'pending'}`;
}

export function canReplaceWorkoutProof(surface) {
  return !isProofReplacementBlocked(states.get(surface));
}

export function initWorkoutProof(surface, options = {}) {
  bindListeners();
  const previous = states.get(surface);
  const sameProofKey = previous?.proofKey === options.proofKey;

  if (sameProofKey && previous) {
    if (options.context) previous.context = options.context;
    if ('existingAttachment' in options) previous.existingAttachment = options.existingAttachment || null;
    if ('legacy' in options) previous.legacy = !!options.legacy;
    render(surface);
    emitState(surface);
    return;
  }

  if (previous?.proofKey !== options.proofKey) revokePreview(previous);
  states.set(surface, {
    proofKey: options.proofKey,
    context: options.context || {},
    existingAttachment: options.existingAttachment || null,
    legacy: !!options.legacy,
    processed: null,
    filename: '',
    previewUrl: '',
    uploadId: null,
    storagePath: null,
    ambiguousRpcPending: null,
    ambiguousLinkedRecordId: null,
    uploading: false,
    error: '',
  });
  render(surface);
  emitState(surface);
}

export function hasWorkoutProof(surface) {
  const state = states.get(surface);
  return !!(state?.processed || state?.existingAttachment || state?.legacy);
}

export function hasPendingWorkoutProof(surface) {
  return !!states.get(surface)?.processed;
}

export function getProofUploadIdentity(surface) {
  const state = states.get(surface);
  if (!state) return null;
  return {
    uploadId: state.uploadId,
    storagePath: state.storagePath,
  };
}

async function executeProofAttempt(attempt) {
  const uploadResult = await runProofTransportOperation(
    withOperationTimeout(
      supabase.storage.from(PROOF_BUCKET).upload(attempt.storagePath, attempt.processed.blob, {
        contentType: attempt.uploadMimeType,
        upsert: true,
        cacheControl: '3600',
      }),
      {
        timeoutMs: OPERATION_TIMEOUT_MS.STORAGE_UPLOAD,
        operation: 'proof_storage_upload',
      },
    ),
    'proof_storage_upload',
  );
  const { error: uploadError } = uploadResult;
  if (uploadError) throw createProofUploadError(uploadError, PROOF_UPLOAD_PHASE.STORAGE);

  const rpcResult = await runProofTransportOperation(
    withOperationTimeout(
      supabase.rpc('create_workout_proof_attachment', {
        p_proof_key: attempt.proofKey,
        p_linked_record_id: attempt.linkedRecordId,
        p_storage_path: attempt.storagePath,
        p_original_filename: attempt.filename || `workout-proof.${attempt.uploadExtension}`,
        p_mime_type: attempt.uploadMimeType,
        p_file_size: attempt.processed.blob.size,
        p_width: attempt.processed.width,
        p_height: attempt.processed.height,
        p_camp_length: Number(attempt.context.campLength) || null,
        p_week_index: Number.isFinite(Number(attempt.context.weekIndex)) ? Number(attempt.context.weekIndex) : null,
        p_workout_index: Number.isFinite(Number(attempt.context.workoutIndex)) ? Number(attempt.context.workoutIndex) : null,
        p_workout_type: String(attempt.context.workoutType || 'Workout'),
        p_day_of_week: String(attempt.context.dayOfWeek || ''),
      }),
      {
        timeoutMs: OPERATION_TIMEOUT_MS.PROOF_RPC,
        operation: 'proof_rpc',
      },
    ),
    'proof_rpc',
  );
  const { data, error: rowError } = rpcResult;

  if (rowError) {
    throw createProofUploadError(rowError, PROOF_UPLOAD_PHASE.RPC);
  }

  return attachmentFromRow(data);
}

async function ensureWorkoutProofUploadedInner(surface, linkedRecordId = '') {
  const state = states.get(surface);
  if (!state) throw new Error('Workout proof is not ready.');
  if (state.existingAttachment && !state.processed) return state.existingAttachment;
  if (state.legacy && !state.processed) return null;
  // Intentional local-athlete mode when Supabase is not configured.
  if (!isSupabaseConfigured || !supabase) {
    if (!state.processed) throw new Error('Choose a workout screenshot first.');
    return null;
  }

  // Configured cloud mode still requires a signed-in user before proof upload.
  if (!getCurrentUser()) {
    throw new Error('Sign in before submitting workout proof.');
  }

  if (!state.processed) throw new Error('Choose a workout screenshot first.');

  const attempt = createProofAttempt(state, linkedRecordId);
  const hadUnresolvedAmbiguity = state.ambiguousRpcPending === attempt.uploadId;
  if (
    state.ambiguousRpcPending === attempt.uploadId
    && state.ambiguousLinkedRecordId
    && state.ambiguousLinkedRecordId !== attempt.linkedRecordId
  ) {
    throw createProofRetryIdentityMismatchError();
  }

  state.uploading = true;
  state.error = '';
  render(surface);
  emitState(surface);

  try {
    try {
      const contractResult = await assertProofContractCurrent();
      if (contractResult.status === 'unavailable') {
        captureRuntimeDiagnostic({
          kind: 'contract_health_unavailable',
          stage: 'proof_precheck',
          detail: getContractHealthDiagnosticDetail(contractResult),
        });
      }
    } catch (error) {
      if (error?.contractHealthStatus === 'mismatch') {
        state.error = error.message;
        captureRuntimeDiagnostic({
          kind: 'contract_mismatch',
          stage: 'proof_precheck',
          detail: error.contractHealth?.reason || 'mismatch',
          message: error.message,
        });
        throw error;
      }
      captureRuntimeDiagnostic({
        kind: 'contract_health_unavailable',
        stage: 'proof_precheck',
        detail: error?.message || 'health_check_failed',
      });
    }

    const attachment = await executeProofAttempt(attempt);
    state.existingAttachment = attachment;
    reconcileAttemptSuccess(state, attempt);
    return attachment;
  } catch (error) {
    await maybeRemoveStagedStorageAfterProofFailure(attempt, error, hadUnresolvedAmbiguity);
    finalizeProofFailure(state, attempt, error, hadUnresolvedAmbiguity);
  } finally {
    state.uploading = false;
    render(surface);
    emitState(surface);
  }
}

export async function ensureWorkoutProofUploaded(surface, linkedRecordId = '') {
  const state = states.get(surface);
  const proofKey = state?.proofKey || surface;
  const uploadId = state?.uploadId || state?.ambiguousRpcPending || 'pending';
  return runSingleFlight(buildProofFlightKey(surface, proofKey, uploadId), () =>
    ensureWorkoutProofUploadedInner(surface, linkedRecordId));
}

export async function markWorkoutProofCleared(attachmentId, isCleared = true) {
  if (!attachmentId || !supabase || !getCurrentUser()) return false;
  const { error } = await supabase.rpc('set_workout_proof_cleared', {
    attachment_id: attachmentId,
    cleared: !!isCleared,
  });
  if (error) throw error;
  return true;
}

export function __resetProofStateForTest() {
  states.clear();
  listenersBound = false;
}

export function __getProofStateForTest(surface) {
  return states.get(surface);
}

export async function __handleProofFileForTest(surface, file) {
  return handleFile(surface, file);
}
