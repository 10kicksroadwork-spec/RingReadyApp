/**
 * Ring Ready workout-proof add-on for the coach/master spreadsheet.
 * Add this file to the existing Apps Script project. It does not replace the
 * legacy extractor or the current Ring Ready receiver.
 */

var RR_PROOF_AUDIT_SHEET = 'Ring Ready Workout Proofs';
var RR_PROOF_BUCKET = 'workout-proof-staging';
var RR_PROOF_HEADERS = [
  'Received At', 'Attachment ID', 'Athlete', 'Proof Key', 'Week', 'Workout',
  'Uploaded At', 'Proof Status', 'Workout Proof', 'Drive File ID',
  'Supabase Path', 'Error'
];

/** Call once after adding the script and setting Script Properties. */
function rrSetupWorkoutProofs() {
  rrEnsureProofAuditSheet_();
  rrEnsureProofColumnsOnCoachTabs_();
  rrInstallWorkoutProofRetryTrigger();
}

/**
 * Add this branch to the existing doPost event dispatcher:
 *
 * if (payload.eventType === 'workout_proof') {
 *   rrHandleWorkoutProofEvent(payload);
 * }
 */
function rrHandleWorkoutProofEvent(payload) {
  if (!payload || payload.eventType !== 'workout_proof') {
    throw new Error('Invalid workout_proof event.');
  }
  var attachmentId = String(payload.attachmentId || (payload.attachment && payload.attachment.id) || '');
  if (!attachmentId) throw new Error('Workout proof is missing its attachment ID.');
  return rrTransferWorkoutProof_(attachmentId, payload.linkedRecordId || '');
}

function rrFetchAttachmentRow_(attachmentId) {
  var response = rrSupabaseFetch_(
    '/rest/v1/workout_attachments?select=*&id=eq.' + encodeURIComponent(attachmentId) + '&limit=1',
    { method: 'get' }
  );
  var rows = JSON.parse(response.getContentText() || '[]');
  if (!rows.length) throw new Error('Workout proof attachment not found: ' + attachmentId);
  return rows[0];
}

function rrBuildProofPayloadFromRow_(row, linkedRecordId) {
  var profileName = rrLookupAthleteName_(row.user_id);
  return {
    eventType: 'workout_proof',
    athleteName: profileName || 'Unknown Athlete',
    userId: row.user_id,
    proofKey: row.proof_key,
    linkedRecordId: String(linkedRecordId || row.linked_record_id || ''),
    workoutContext: {
      campLength: row.camp_length,
      weekIndex: row.week_index,
      workoutIndex: row.workout_index,
      workoutType: row.workout_type,
      dayOfWeek: row.day_of_week
    },
    attachment: {
      id: row.id,
      storageBucket: row.storage_bucket,
      storagePath: row.storage_path,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      width: row.width,
      height: row.height,
      uploadedAt: row.uploaded_at
    }
  };
}

function rrTransferWorkoutProof_(attachmentId, linkedRecordId) {
  var row = rrFetchAttachmentRow_(attachmentId);
  var payload = rrBuildProofPayloadFromRow_(row, linkedRecordId);
  var attachment = payload.attachment || {};
  var storagePath = String(attachment.storagePath || '');
  if (!storagePath) throw new Error('Workout proof is missing its storage path.');

  try {
    rrPatchAttachment_(attachmentId, {
      transfer_status: 'processing',
      transfer_error: '',
      updated_at: new Date().toISOString()
    });

    var imageResponse = rrSupabaseFetch_(
      '/storage/v1/object/authenticated/' + encodeURIComponent(RR_PROOF_BUCKET) + '/' + rrEncodeStoragePath_(storagePath),
      { method: 'get' }
    );
    var root = DriveApp.getFolderById(rrRequiredProperty_('RING_READY_DRIVE_ROOT_FOLDER_ID'));
    var athleteName = String(payload.athleteName || rrLookupAthleteName_(payload.userId || '') || 'Unknown Athlete');
    var context = payload.workoutContext || {};
    var athleteFolder = rrGetOrCreateFolder_(root, rrSafeDriveName_(athleteName));
    var weekName = context.weekIndex === null || context.weekIndex === undefined || context.weekIndex === ''
      ? 'Mile Tests'
      : 'Week ' + (Number(context.weekIndex) + 1);
    var weekFolder = rrGetOrCreateFolder_(athleteFolder, weekName);
    var uploadedAt = attachment.uploadedAt ? new Date(attachment.uploadedAt) : new Date();
    var datePart = Utilities.formatDate(uploadedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var workoutPart = rrSafeDriveName_(context.workoutType || 'Workout');
    var filename = datePart + '_' + workoutPart + '_' + attachmentId.slice(0, 8) + '.webp';
    var blob = imageResponse.getBlob().setName(filename);
    var file = weekFolder.createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    var driveUrl = file.getUrl();
    var transferredAt = new Date().toISOString();

    rrPatchAttachment_(attachmentId, {
      transfer_status: 'complete',
      transfer_error: '',
      drive_file_id: file.getId(),
      drive_url: driveUrl,
      transferred_at: transferredAt,
      updated_at: transferredAt
    });
    rrDeleteStagedProof_(storagePath);
    rrWriteProofAudit_(payload, 'Complete', driveUrl, file.getId(), '');
    rrApplyProofToCoachRows_(payload, 'Complete', driveUrl, transferredAt);
    return { ok: true, attachmentId: attachmentId, driveUrl: driveUrl };
  } catch (error) {
    var message = String(error && error.message ? error.message : error);
    try {
      rrPatchAttachment_(attachmentId, {
        transfer_status: 'failed',
        transfer_error: message.slice(0, 1000),
        updated_at: new Date().toISOString()
      }, true);
    } catch (patchError) {
      console.error('Could not record proof transfer failure', patchError);
    }
    rrWriteProofAudit_(payload, 'Transfer Pending', '', '', message);
    rrApplyProofToCoachRows_(payload, 'Transfer Pending', '', new Date().toISOString());
    throw error;
  }
}

/** Retries missed or failed Drive transfers. Safe to run manually. */
function rrSyncPendingWorkoutProofs() {
  var response = rrSupabaseFetch_(
    '/rest/v1/workout_attachments?select=*&transfer_status=in.(pending,failed)&is_current=eq.true&order=uploaded_at.asc&limit=50',
    { method: 'get', headers: { Prefer: 'count=none' } }
  );
  var rows = JSON.parse(response.getContentText() || '[]');
  rows.forEach(function(row) {
    var profileName = rrLookupAthleteName_(row.user_id);
    var payload = {
      eventType: 'workout_proof',
      athleteName: profileName || 'Unknown Athlete',
      proofKey: row.proof_key,
      linkedRecordId: row.linked_record_id,
      workoutContext: {
        campLength: row.camp_length,
        weekIndex: row.week_index,
        workoutIndex: row.workout_index,
        workoutType: row.workout_type,
        dayOfWeek: row.day_of_week
      },
      attachment: {
        id: row.id,
        storageBucket: row.storage_bucket,
        storagePath: row.storage_path,
        originalFilename: row.original_filename,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        width: row.width,
        height: row.height,
        uploadedAt: row.uploaded_at
      }
    };
    try { rrTransferWorkoutProof_(row.id, row.linked_record_id); }
    catch (error) { console.error('Workout proof retry failed for ' + row.id, error); }
  });
}

function rrInstallWorkoutProofRetryTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'rrSyncPendingWorkoutProofs') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('rrSyncPendingWorkoutProofs').timeBased().everyMinutes(15).create();
}

function rrSupabaseFetch_(path, options) {
  var url = rrRequiredProperty_('RING_READY_SUPABASE_URL').replace(/\/$/, '') + path;
  var key = rrRequiredProperty_('RING_READY_SUPABASE_SERVICE_ROLE_KEY');
  var request = options || {};
  request.muteHttpExceptions = true;
  request.headers = Object.assign({}, request.headers || {}, {
    Authorization: 'Bearer ' + key,
    apikey: key
  });
  var response = UrlFetchApp.fetch(url, request);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Supabase request failed (' + status + '): ' + response.getContentText().slice(0, 500));
  }
  return response;
}

function rrPatchAttachment_(attachmentId, fields, ignoreMissing) {
  var response = rrSupabaseFetch_(
    '/rest/v1/workout_attachments?id=eq.' + encodeURIComponent(attachmentId),
    {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify(fields),
      headers: { Prefer: ignoreMissing ? 'return=minimal' : 'return=representation' }
    }
  );
  return response;
}

function rrDeleteStagedProof_(storagePath) {
  rrSupabaseFetch_(
    '/storage/v1/object/' + encodeURIComponent(RR_PROOF_BUCKET) + '/' + rrEncodeStoragePath_(storagePath),
    { method: 'delete' }
  );
}

function rrLookupAthleteName_(userId) {
  if (!userId) return '';
  var response = rrSupabaseFetch_(
    '/rest/v1/athlete_profiles?select=athlete_name&user_id=eq.' + encodeURIComponent(userId) + '&limit=1',
    { method: 'get' }
  );
  var rows = JSON.parse(response.getContentText() || '[]');
  return rows[0] && rows[0].athlete_name ? rows[0].athlete_name : '';
}

function rrRequiredProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing Apps Script Property: ' + name);
  return value;
}

function rrEncodeStoragePath_(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function rrSafeDriveName_(value) {
  return String(value || 'Workout').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100) || 'Workout';
}

function rrGetOrCreateFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function rrEnsureProofAuditSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(RR_PROOF_AUDIT_SHEET) || spreadsheet.insertSheet(RR_PROOF_AUDIT_SHEET);
  if (sheet.getLastRow() === 0) sheet.appendRow(RR_PROOF_HEADERS);
  var headers = sheet.getRange(1, 1, 1, RR_PROOF_HEADERS.length);
  headers.setValues([RR_PROOF_HEADERS]).setFontWeight('bold').setBackground('#111111').setFontColor('#f5c842');
  sheet.setFrozenRows(1);
  return sheet;
}

function rrWriteProofAudit_(payload, status, driveUrl, driveFileId, errorMessage) {
  var sheet = rrEnsureProofAuditSheet_();
  var attachment = payload.attachment || {};
  var context = payload.workoutContext || {};
  var week = context.weekIndex === null || context.weekIndex === undefined || context.weekIndex === '' ? 'Mile Test' : Number(context.weekIndex) + 1;
  var linkFormula = driveUrl ? '=HYPERLINK("' + String(driveUrl).replace(/"/g, '""') + '","VIEW PROOF")' : '';
  sheet.appendRow([
    new Date(), attachment.id || '', payload.athleteName || '', payload.proofKey || '', week,
    context.workoutType || '', attachment.uploadedAt || '', status, linkFormula,
    driveFileId || '', attachment.storagePath || '', errorMessage || ''
  ]);
}

function rrEnsureProofColumnsOnCoachTabs_() {
  ['Coaches Dashboard', 'Athlete Raw Data', 'Ring Ready Sprint Sessions', 'Ring Ready Mile Tests'].forEach(function(name) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (sheet) rrEnsureColumns_(sheet, ['Proof Status', 'Workout Proof', 'Proof Uploaded At']);
  });
}

function rrEnsureColumns_(sheet, names) {
  if (sheet.getLastColumn() < 1) return {};
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var indexes = {};
  names.forEach(function(name) {
    var index = headers.indexOf(name);
    if (index < 0) {
      index = headers.length;
      sheet.getRange(1, index + 1).setValue(name);
      headers.push(name);
    }
    indexes[name] = index + 1;
  });
  return indexes;
}

function rrApplyProofToCoachRows_(payload, status, driveUrl, uploadedAt) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var athlete = String(payload.athleteName || '').toLowerCase();
  var workout = String((payload.workoutContext || {}).workoutType || '').toLowerCase();
  ['Coaches Dashboard', 'Athlete Raw Data', 'Ring Ready Sprint Sessions', 'Ring Ready Mile Tests'].forEach(function(name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    var indexes = rrEnsureColumns_(sheet, ['Proof Status', 'Workout Proof', 'Proof Uploaded At']);
    var values = sheet.getDataRange().getDisplayValues();
    var header = values[0].map(function(value) { return String(value).toLowerCase(); });
    var athleteColumn = header.findIndex(function(value) { return value === 'athlete' || value === 'athlete name'; });
    var workoutColumn = header.findIndex(function(value) { return value === 'workout type' || value === 'workout'; });
    var targetRow = -1;
    for (var row = values.length - 1; row >= 1; row--) {
      var athleteMatches = athleteColumn < 0 || String(values[row][athleteColumn]).toLowerCase() === athlete;
      var workoutMatches = !workout || workoutColumn < 0 || String(values[row][workoutColumn]).toLowerCase() === workout;
      if (athleteMatches && workoutMatches) { targetRow = row + 1; break; }
    }
    if (targetRow < 2) return;
    sheet.getRange(targetRow, indexes['Proof Status']).setValue(status);
    sheet.getRange(targetRow, indexes['Proof Uploaded At']).setValue(uploadedAt || new Date());
    if (driveUrl) sheet.getRange(targetRow, indexes['Workout Proof']).setFormula('=HYPERLINK("' + String(driveUrl).replace(/"/g, '""') + '","VIEW PROOF")');
  });
}
