import './proof.css';
import { getCurrentUser } from './auth.js';
import { isSupabaseConfigured, supabase } from './supabase-client.js';

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

function render(surface) {
  const state = states.get(surface);
  const host = document.querySelector(`[data-proof-host="${surface}"]`);
  if (!state || !host) return;

  const existing = state.existingAttachment;
  const selected = state.processed;
  const hasPreview = !!state.previewUrl;
  const legacy = state.legacy && !existing && !selected;
  const statusClass = state.error ? 'error' : state.uploading ? 'uploading' : (existing || selected) ? 'ready' : '';
  const statusText = state.error
    || (state.uploading ? 'Uploading proof securely...'
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
        <label class="proof-picker-btn">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp" data-proof-input="${surface}">
          ${existing || selected ? 'REPLACE' : 'CHOOSE IMAGE'}
        </label>
      </div>
    </section>`;
}

async function loadImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    image.src = url;
  });
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
  revokePreview(state);
  Object.assign(state, { processed: null, filename: file.name, previewUrl: '', error: '', uploading: true });
  render(surface);
  emitState(surface);
  try {
    state.processed = await processImage(file);
    state.previewUrl = URL.createObjectURL(state.processed.blob);
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
    if (!input) return;
    handleFile(input.dataset.proofInput, input.files?.[0]);
    input.value = '';
  });
}

export function buildProgramProofKey(campLength, weekIndex, workoutIndex) {
  return `program:${String(campLength) === '4' ? 4 : 7}:${Number(weekIndex)}:${Number(workoutIndex)}`;
}

export function initWorkoutProof(surface, options = {}) {
  bindListeners();
  const previous = states.get(surface);
  if (previous?.proofKey !== options.proofKey) revokePreview(previous);
  states.set(surface, {
    proofKey: options.proofKey,
    context: options.context || {},
    existingAttachment: options.existingAttachment || null,
    legacy: !!options.legacy,
    processed: previous?.proofKey === options.proofKey ? previous.processed : null,
    filename: previous?.proofKey === options.proofKey ? previous.filename : '',
    previewUrl: previous?.proofKey === options.proofKey ? previous.previewUrl : '',
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

export async function ensureWorkoutProofUploaded(surface, linkedRecordId = '') {
  const state = states.get(surface);
  if (!state) throw new Error('Workout proof is not ready.');
  if (state.existingAttachment && !state.processed) return state.existingAttachment;
  if (state.legacy && !state.processed) return null;
  if (!navigator.onLine) throw new Error('Internet connection required to submit workout proof.');
  if (!isSupabaseConfigured || !supabase || !getCurrentUser()) throw new Error('Sign in before submitting workout proof.');
  if (!state.processed) throw new Error('Choose a workout screenshot first.');
  state.uploading = true;
  state.error = '';
  render(surface);
  emitState(surface);
  const user = getCurrentUser();
  const attachmentId = makeId();
  const uploadMimeType = state.processed.blob.type || state.processed.mimeType || getCanvasOutputMimeType();
  const uploadExtension = extensionForMimeType(uploadMimeType);
  const storagePath = `${user.id}/${safePathPart(state.proofKey)}/${Date.now()}-${attachmentId}.${uploadExtension}`;
  try {
    const { error: uploadError } = await supabase.storage.from(PROOF_BUCKET).upload(storagePath, state.processed.blob, { contentType: uploadMimeType, upsert: false, cacheControl: '3600' });
    if (uploadError) throw uploadError;
    const { error: currentError } = await supabase.from('workout_attachments').update({ is_current: false, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('proof_key', state.proofKey).eq('is_current', true);
    if (currentError) throw currentError;
    const row = {
      id: attachmentId, user_id: user.id, proof_key: state.proofKey, linked_record_id: String(linkedRecordId || ''),
      camp_length: Number(state.context.campLength) || null,
      week_index: Number.isFinite(Number(state.context.weekIndex)) ? Number(state.context.weekIndex) : null,
      workout_index: Number.isFinite(Number(state.context.workoutIndex)) ? Number(state.context.workoutIndex) : null,
      workout_type: String(state.context.workoutType || 'Workout'), day_of_week: String(state.context.dayOfWeek || ''),
      storage_bucket: PROOF_BUCKET, storage_path: storagePath, original_filename: state.filename || `workout-proof.${uploadExtension}`,
      mime_type: uploadMimeType, file_size: state.processed.blob.size, width: state.processed.width, height: state.processed.height,
      transfer_status: 'pending', is_current: true, completion_cleared: false,
      uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { data, error: rowError } = await supabase.from('workout_attachments').insert(row).select('*').single();
    if (rowError) {
      await supabase.storage.from(PROOF_BUCKET).remove([storagePath]);
      throw rowError;
    }
    const attachment = attachmentFromRow(data);
    state.existingAttachment = attachment;
    state.processed = null;
    return attachment;
  } catch (error) {
    state.error = String(error?.message || error);
    throw error;
  } finally {
    state.uploading = false;
    render(surface);
    emitState(surface);
  }
}

export async function markWorkoutProofCleared(attachmentId, isCleared = true) {
  if (!attachmentId || !supabase || !getCurrentUser()) return false;
  const { error } = await supabase.from('workout_attachments').update({ completion_cleared: !!isCleared, updated_at: new Date().toISOString() }).eq('id', attachmentId).eq('user_id', getCurrentUser().id);
  if (error) throw error;
  return true;
}
