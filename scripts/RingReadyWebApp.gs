/**
 * Ring Ready PWA receiver for the coach/master Google Sheet.
 * Deploy as a web app (/exec). Production traffic must arrive through the
 * authenticated Vercel relay using RING_READY_SYNC_RELAY_SECRET.
 *
 * Companion file: scripts/RingReadyWorkoutProof.gs (workout_proof events).
 */

var RR_RAW_EVENTS_SHEET = 'Ring Ready Raw Events';
var RR_SPRINT_SHEET = 'Ring Ready Sprint Sessions';
var RR_SPRINT_REPS_SHEET = 'Ring Ready Sprint Reps';
var RR_MILE_SHEET = 'Ring Ready Mile Tests';
var RR_PROFILES_SHEET = 'Ring Ready Profiles';
var RR_HR_SHEET = 'Ring Ready HR Info';
var RR_ATHLETE_RAW_SHEET = 'Athlete Raw Data';

var RR_PROOF_META_HEADERS = ['User ID', 'Linked Record ID', 'Proof Key', 'Week Index', 'Workout Index'];

function rrSanitizeSheetText_(value) {
  var text = String(value == null ? '' : value);
  if (!text) return '';
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function rrAssertRelayAuthorized_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty('RING_READY_SYNC_RELAY_SECRET');
  if (!expected) {
    throw new Error('Sync relay secret is not configured.');
  }
  var provided = String((payload && payload._relaySecret) || '');
  if (provided !== expected) {
    throw new Error('Unauthorized sync relay request.');
  }
  if (payload) delete payload._relaySecret;
}

function doPost(e) {
  var payload = rrParsePayload_(e);
  if (!payload || !payload.eventType) {
    return rrJsonResponse_({ ok: false, error: 'Missing eventType.' });
  }

  rrAssertRelayAuthorized_(payload);

  if (payload.eventType === 'workout_proof') {
    if (typeof rrHandleWorkoutProofEvent === 'function') {
      rrHandleWorkoutProofEvent(payload);
      return rrJsonResponse_({ ok: true, eventType: payload.eventType });
    }
    throw new Error('workout_proof handler is not installed.');
  }

  switch (payload.eventType) {
    case 'profile_update':
      rrHandleProfileUpdate_(payload);
      break;
    case 'hr_info_update':
      rrHandleHRInfoUpdate_(payload);
      break;
    case 'sprint_session':
      rrHandleSprintSession_(payload);
      break;
    case 'mile_test':
      rrHandleMileTest_(payload);
      break;
    case 'daily_workout':
    case 'daily_workout_skip':
      rrHandleDailyWorkout_(payload);
      break;
    case 'workout_completion_clear':
      rrHandleWorkoutCompletionClear_(payload);
      break;
    default:
      rrAppendRawEvent_(payload, 'Unhandled eventType');
  }

  return rrJsonResponse_({ ok: true, eventType: payload.eventType });
}

function rrSetupBackendSheets() {
  rrEnsureSheetWithHeaders_(RR_RAW_EVENTS_SHEET, [
    'Received At', 'Event Type', 'Event ID', 'Athlete', 'User ID', 'Status', 'Payload'
  ]);
  rrEnsureSheetWithHeaders_(RR_SPRINT_SHEET, [
    'Received At', 'Session ID', 'Athlete', 'User ID', 'Linked Record ID', 'Proof Key',
    'Week Index', 'Workout Index', 'Week Tab', 'Day', 'Workout Type', 'Intervals',
    'Avg Drop', 'Peak HR', 'Target BPM', 'Submitted At'
  ]);
  rrEnsureSheetWithHeaders_(RR_SPRINT_REPS_SHEET, [
    'Received At', 'Session ID', 'Rep', 'Sprint HR', 'Rest HR', 'Drop', 'Suspicious'
  ]);
  rrEnsureSheetWithHeaders_(RR_MILE_SHEET, [
    'Received At', 'Linked Record ID', 'Athlete', 'User ID', 'Proof Key', 'Week Index',
    'Workout Index', 'Distance', 'Total Minutes', 'Avg BPM', 'Max BPM', 'Pace', 'Saved At'
  ]);
  rrEnsureSheetWithHeaders_(RR_PROFILES_SHEET, [
    'Received At', 'Athlete', 'User ID', 'Age', 'Gender', 'Tenure', 'Fight Date', 'Camp Length', 'Modality'
  ]);
  rrEnsureSheetWithHeaders_(RR_HR_SHEET, [
    'Received At', 'Athlete', 'User ID', 'Goal Weight', 'Target Date', 'Max HR', 'Resting HR'
  ]);
  rrEnsureAthleteRawBridgeHeaders_();
  if (typeof rrSetupWorkoutProofs === 'function') rrSetupWorkoutProofs();
}

function rrTestBackendReceiver() {
  var testId = Utilities.getUuid();
  rrHandleDailyWorkout_({
    eventType: 'daily_workout',
    eventId: testId,
    userId: 'test-user',
    athleteName: 'Test Athlete',
    linkedRecordId: testId,
    proofKey: 'program:7:0:2',
    workoutContext: { weekIndex: 0, workoutIndex: 2, workoutType: 'Threshold', dayOfWeek: 'Wed' },
    workoutLog: { distance: 3, totalMinutes: 30, avgBpm: 150, maxBpm: 165, completedAt: new Date().toISOString() }
  });
}

function rrParsePayload_(e) {
  var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid JSON payload.');
  }
}

function rrJsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function rrEnsureSheetWithHeaders_(name, headers) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet(name);
  if (created) {
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]).setFontWeight('bold').setBackground('#111111').setFontColor('#f5c842');
    sheet.setFrozenRows(1);
  } else {
    rrEnsureColumns_(sheet, headers);
  }
  return sheet;
}

function rrEnsureAthleteRawBridgeHeaders_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RR_ATHLETE_RAW_SHEET);
  if (!sheet) return;
  rrEnsureColumns_(sheet, ['Proof Status', 'Workout Proof', 'Proof Uploaded At'].concat(RR_PROOF_META_HEADERS));
}

function rrEnsureColumns_(sheet, names) {
  if (sheet.getLastColumn() < 1) {
    sheet.getRange(1, 1, 1, names.length).setValues([names]);
    sheet.getRange(1, 1, 1, names.length).setFontWeight('bold').setBackground('#111111').setFontColor('#f5c842');
    sheet.setFrozenRows(1);
    var blankIndexes = {};
    names.forEach(function(name, index) {
      blankIndexes[name] = index + 1;
    });
    return blankIndexes;
  }
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

function rrAppendRawEvent_(payload, status) {
  var sheet = rrEnsureSheetWithHeaders_(RR_RAW_EVENTS_SHEET, [
    'Received At', 'Event Type', 'Event ID', 'Athlete', 'User ID', 'Status', 'Payload'
  ]);
  sheet.appendRow([
    new Date(),
    payload.eventType || '',
    payload.eventId || payload.sessionId || '',
    rrSanitizeSheetText_(payload.athleteName || ''),
    payload.userId || '',
    status || 'Received',
    JSON.stringify(payload).slice(0, 45000)
  ]);
}

function rrProofMetaFromPayload_(payload) {
  var context = payload.workoutContext || payload.testContext || {};
  var weekIndex = context.weekIndex;
  if (weekIndex === undefined || weekIndex === null) weekIndex = payload.weekIndex;
  var workoutIndex = context.workoutIndex;
  if (workoutIndex === undefined || workoutIndex === null) workoutIndex = payload.workoutIndex;
  var proofKey = String(payload.proofKey || context.testKey || context.proofKey || '');
  if (!proofKey && payload.test && payload.test.testKey) proofKey = String(payload.test.testKey);
  return {
    userId: String(payload.userId || ''),
    linkedRecordId: String(payload.linkedRecordId || payload.sessionId || payload.eventId || ''),
    proofKey: proofKey,
    weekIndex: weekIndex === undefined || weekIndex === null || weekIndex === '' ? '' : Number(weekIndex),
    workoutIndex: workoutIndex === undefined || workoutIndex === null || workoutIndex === '' ? '' : Number(workoutIndex)
  };
}

function rrWriteProofMetaColumns_(sheet, rowNumber, meta) {
  var indexes = rrEnsureColumns_(sheet, RR_PROOF_META_HEADERS);
  sheet.getRange(rowNumber, indexes['User ID']).setValue(meta.userId || '');
  sheet.getRange(rowNumber, indexes['Linked Record ID']).setValue(meta.linkedRecordId || '');
  sheet.getRange(rowNumber, indexes['Proof Key']).setValue(meta.proofKey || '');
  sheet.getRange(rowNumber, indexes['Week Index']).setValue(meta.weekIndex === '' ? '' : meta.weekIndex);
  sheet.getRange(rowNumber, indexes['Workout Index']).setValue(meta.workoutIndex === '' ? '' : meta.workoutIndex);
}

function rrRowMatchesClearMeta_(rowMeta, clearMeta) {
  if (!clearMeta || !clearMeta.userId) return false;
  if (String(rowMeta.userId || '') !== String(clearMeta.userId || '')) return false;

  var linkedRecordId = String(clearMeta.linkedRecordId || '');
  if (linkedRecordId && String(rowMeta.linkedRecordId || '') === linkedRecordId) {
    return true;
  }

  var proofKey = String(clearMeta.proofKey || '');
  if (proofKey && String(rowMeta.proofKey || '') === proofKey) {
    return true;
  }

  if (clearMeta.weekIndex === '' || clearMeta.workoutIndex === '') return false;
  return Number(rowMeta.weekIndex) === Number(clearMeta.weekIndex)
    && Number(rowMeta.workoutIndex) === Number(clearMeta.workoutIndex);
}

function rrReadProofMetaRow_(sheet, rowNumber, indexes) {
  return {
    userId: String(sheet.getRange(rowNumber, indexes['User ID']).getDisplayValue() || ''),
    linkedRecordId: String(sheet.getRange(rowNumber, indexes['Linked Record ID']).getDisplayValue() || ''),
    proofKey: String(sheet.getRange(rowNumber, indexes['Proof Key']).getDisplayValue() || ''),
    weekIndex: sheet.getRange(rowNumber, indexes['Week Index']).getValue(),
    workoutIndex: sheet.getRange(rowNumber, indexes['Workout Index']).getValue()
  };
}

function rrDeleteAthleteRawRowsByClearMeta_(clearMeta) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RR_ATHLETE_RAW_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var indexes = rrEnsureColumns_(sheet, RR_PROOF_META_HEADERS);
  var rowsToDelete = [];
  for (var row = sheet.getLastRow(); row >= 2; row--) {
    var rowMeta = rrReadProofMetaRow_(sheet, row, indexes);
    if (rrRowMatchesClearMeta_(rowMeta, clearMeta)) rowsToDelete.push(row);
  }

  rowsToDelete.forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });
  return rowsToDelete.length;
}

function rrDeleteRowsByColumnValue_(sheetName, columnName, matchValue) {
  var needle = String(matchValue || '');
  if (!needle) return 0;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var indexes = rrEnsureColumns_(sheet, [columnName]);
  var columnIndex = indexes[columnName];
  var rowsToDelete = [];
  for (var row = sheet.getLastRow(); row >= 2; row--) {
    if (String(sheet.getRange(row, columnIndex).getDisplayValue() || '') === needle) {
      rowsToDelete.push(row);
    }
  }

  rowsToDelete.forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });
  return rowsToDelete.length;
}

function rrHandleWorkoutCompletionClear_(payload) {
  var clearMeta = rrProofMetaFromPayload_(payload);
  if (!clearMeta.userId) {
    throw new Error('Workout clear is missing authenticated user ID.');
  }

  var removedRawRows = rrDeleteAthleteRawRowsByClearMeta_(clearMeta);
  var linkedRecordId = String(clearMeta.linkedRecordId || '');
  var removedSprintRows = 0;
  var removedRepRows = 0;
  var removedMileRows = 0;

  if (linkedRecordId) {
    removedSprintRows = rrDeleteRowsByColumnValue_(RR_SPRINT_SHEET, 'Session ID', linkedRecordId);
    removedRepRows = rrDeleteRowsByColumnValue_(RR_SPRINT_REPS_SHEET, 'Session ID', linkedRecordId);
    removedMileRows = rrDeleteRowsByColumnValue_(RR_MILE_SHEET, 'Linked Record ID', linkedRecordId);
  }

  rrAppendRawEvent_(payload, removedRawRows || removedSprintRows || removedRepRows || removedMileRows
    ? 'Workout clear removed ' + removedRawRows + ' Athlete Raw row(s)'
    : 'Workout clear matched no Athlete Raw rows');
}

function rrHandleProfileUpdate_(payload) {
  var profile = payload.profile || payload.athleteProfile || {};
  var sheet = rrEnsureSheetWithHeaders_(RR_PROFILES_SHEET, [
    'Received At', 'Athlete', 'User ID', 'Age', 'Gender', 'Tenure', 'Fight Date', 'Camp Length', 'Modality'
  ]);
  sheet.appendRow([
    new Date(),
    rrSanitizeSheetText_(payload.athleteName || profile.athleteName || ''),
    payload.userId || '',
    rrSanitizeSheetText_(profile.age || ''),
    rrSanitizeSheetText_(profile.gender || ''),
    rrSanitizeSheetText_(profile.trainingTenure || ''),
    rrSanitizeSheetText_(profile.fightDate || ''),
    rrSanitizeSheetText_(profile.campLength || ''),
    rrSanitizeSheetText_(profile.defaultModality || '')
  ]);
  rrAppendRawEvent_(payload, 'Profile saved');
}

function rrHandleHRInfoUpdate_(payload) {
  var hr = payload.hrInfo || {};
  var sheet = rrEnsureSheetWithHeaders_(RR_HR_SHEET, [
    'Received At', 'Athlete', 'User ID', 'Goal Weight', 'Target Date', 'Max HR', 'Resting HR'
  ]);
  sheet.appendRow([
    new Date(),
    rrSanitizeSheetText_(payload.athleteName || ''),
    payload.userId || '',
    rrSanitizeSheetText_(hr.goalWeight || ''),
    rrSanitizeSheetText_(hr.targetDate || ''),
    hr.maxHr || '',
    hr.restingHr || ''
  ]);
  rrAppendRawEvent_(payload, 'HR info saved');
}

function rrHandleSprintSession_(payload) {
  var meta = rrProofMetaFromPayload_(payload);
  var context = payload.workoutContext || {};
  var summary = payload.summary || {};
  var config = payload.config || {};
  var sheet = rrEnsureSheetWithHeaders_(RR_SPRINT_SHEET, [
    'Received At', 'Session ID', 'Athlete', 'User ID', 'Linked Record ID', 'Proof Key',
    'Week Index', 'Workout Index', 'Week Tab', 'Day', 'Workout Type', 'Intervals',
    'Avg Drop', 'Peak HR', 'Target BPM', 'Submitted At'
  ]);
  sheet.appendRow([
    new Date(),
    meta.linkedRecordId,
    rrSanitizeSheetText_(payload.athleteName || ''),
    meta.userId,
    meta.linkedRecordId,
    meta.proofKey,
    meta.weekIndex,
    meta.workoutIndex,
    rrSanitizeSheetText_(payload.weekTab || context.weekTab || ''),
    rrSanitizeSheetText_(payload.dayOfWeek || context.dayOfWeek || ''),
    rrSanitizeSheetText_(payload.workoutType || context.workoutType || 'Sprint Intervals'),
    summary.intervals || (payload.reps || []).length,
    summary.avgDrop || '',
    summary.peakHR || '',
    config.targetBPM || context.targetBPM || '',
    payload.submittedAt || new Date().toISOString()
  ]);
  rrWriteProofMetaColumns_(sheet, sheet.getLastRow(), meta);

  var repsSheet = rrEnsureSheetWithHeaders_(RR_SPRINT_REPS_SHEET, [
    'Received At', 'Session ID', 'Rep', 'Sprint HR', 'Rest HR', 'Drop', 'Suspicious'
  ]);
  (payload.reps || []).forEach(function(rep) {
    repsSheet.appendRow([
      new Date(), meta.linkedRecordId, rep.rep, rep.sprintHR, rep.restHR, rep.drop, rep.suspicious ? 'yes' : ''
    ]);
  });

  rrAppendAthleteRawSprintRow_(payload, meta);
  rrAppendRawEvent_(payload, 'Sprint session saved');
}

function rrHandleMileTest_(payload) {
  var meta = rrProofMetaFromPayload_(payload);
  var test = payload.test || {};
  var context = payload.testContext || payload.workoutContext || {};
  var sheet = rrEnsureSheetWithHeaders_(RR_MILE_SHEET, [
    'Received At', 'Linked Record ID', 'Athlete', 'User ID', 'Proof Key', 'Week Index',
    'Workout Index', 'Distance', 'Total Minutes', 'Avg BPM', 'Max BPM', 'Pace', 'Saved At'
  ]);
  sheet.appendRow([
    new Date(),
    meta.linkedRecordId,
    rrSanitizeSheetText_(payload.athleteName || ''),
    meta.userId,
    meta.proofKey,
    meta.weekIndex === '' ? (context.weekIndex != null ? context.weekIndex : '') : meta.weekIndex,
    meta.workoutIndex === '' ? (context.workoutIndex != null ? context.workoutIndex : '') : meta.workoutIndex,
    test.distance || '',
    test.totalMinutes || '',
    test.avgBpm || '',
    test.maxBpm || '',
    test.paceMinPerMile || '',
    test.savedAt || payload.submittedAt || new Date().toISOString()
  ]);
  rrWriteProofMetaColumns_(sheet, sheet.getLastRow(), meta);
  rrAppendAthleteRawMileRow_(payload, meta, test, context);
  rrAppendRawEvent_(payload, 'Mile test saved');
}

function rrHandleDailyWorkout_(payload) {
  var meta = rrProofMetaFromPayload_(payload);
  var context = payload.workoutContext || {};
  var log = payload.workoutLog || {};
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RR_ATHLETE_RAW_SHEET);
  if (!sheet) {
    rrAppendRawEvent_(payload, 'Daily workout received (no Athlete Raw Data sheet)');
    return;
  }
  var indexes = rrEnsureColumns_(sheet, [
    'Date', 'Athlete', 'Week', 'Day', 'Workout Type', 'Modality', 'Output Type', 'Output Value',
    'Distance', 'Avg Watts', 'Total Minutes', 'Avg BPM', 'Max BPM', 'Status', 'Skip Reason'
  ].concat(RR_PROOF_META_HEADERS).concat(['Proof Status', 'Workout Proof', 'Proof Uploaded At']));
  var weekLabel = payload.weekTab || context.weekTab || (meta.weekIndex === '' ? '' : 'Week ' + (Number(meta.weekIndex) + 1));
  var row = sheet.getLastRow() + 1;
  var outputType = String(log.outputType || '');
  var outputValue = log.outputValue != null && log.outputValue !== '' ? log.outputValue : '';
  var distanceValue = outputType === 'distance' ? (log.distance || outputValue || '') : '';
  var wattsValue = outputType === 'watts' ? (log.avgWatts || outputValue || '') : '';
  sheet.getRange(row, indexes['Date'] || 1).setValue(log.completedAt ? new Date(log.completedAt) : new Date());
  if (indexes['Athlete']) sheet.getRange(row, indexes['Athlete']).setValue(rrSanitizeSheetText_(payload.athleteName || ''));
  if (indexes['Week']) sheet.getRange(row, indexes['Week']).setValue(rrSanitizeSheetText_(weekLabel));
  if (indexes['Day']) sheet.getRange(row, indexes['Day']).setValue(rrSanitizeSheetText_(payload.dayOfWeek || context.dayOfWeek || ''));
  if (indexes['Workout Type']) sheet.getRange(row, indexes['Workout Type']).setValue(rrSanitizeSheetText_(payload.workoutType || context.workoutType || ''));
  if (indexes['Modality']) sheet.getRange(row, indexes['Modality']).setValue(rrSanitizeSheetText_(payload.modality || log.modality || context.modality || ''));
  if (indexes['Output Type']) sheet.getRange(row, indexes['Output Type']).setValue(rrSanitizeSheetText_(outputType));
  if (indexes['Output Value']) sheet.getRange(row, indexes['Output Value']).setValue(outputValue);
  if (indexes['Distance']) sheet.getRange(row, indexes['Distance']).setValue(distanceValue);
  if (indexes['Avg Watts']) sheet.getRange(row, indexes['Avg Watts']).setValue(wattsValue);
  if (indexes['Total Minutes']) sheet.getRange(row, indexes['Total Minutes']).setValue(log.totalMinutes || '');
  if (indexes['Avg BPM']) sheet.getRange(row, indexes['Avg BPM']).setValue(log.avgBpm || '');
  if (indexes['Max BPM']) sheet.getRange(row, indexes['Max BPM']).setValue(log.maxBpm || '');
  if (indexes['Status']) sheet.getRange(row, indexes['Status']).setValue(log.status === 'skipped' ? 'Skipped' : 'Completed');
  if (indexes['Skip Reason']) sheet.getRange(row, indexes['Skip Reason']).setValue(rrSanitizeSheetText_(log.skipReasonLabel || log.skipReason || ''));
  rrWriteProofMetaColumns_(sheet, row, meta);
  rrAppendRawEvent_(payload, 'Daily workout saved');
}

function rrAppendAthleteRawSprintRow_(payload, meta) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RR_ATHLETE_RAW_SHEET);
  if (!sheet) return;
  var context = payload.workoutContext || {};
  var summary = payload.summary || {};
  var indexes = rrEnsureColumns_(sheet, [
    'Date', 'Athlete', 'Week', 'Day', 'Workout Type', 'Avg Drop', 'Peak HR', 'Intervals'
  ].concat(RR_PROOF_META_HEADERS));
  var row = sheet.getLastRow() + 1;
  if (indexes['Date']) sheet.getRange(row, indexes['Date']).setValue(new Date());
  if (indexes['Athlete']) sheet.getRange(row, indexes['Athlete']).setValue(rrSanitizeSheetText_(payload.athleteName || ''));
  if (indexes['Week']) sheet.getRange(row, indexes['Week']).setValue(rrSanitizeSheetText_(payload.weekTab || context.weekTab || ''));
  if (indexes['Day']) sheet.getRange(row, indexes['Day']).setValue(rrSanitizeSheetText_(payload.dayOfWeek || context.dayOfWeek || ''));
  if (indexes['Workout Type']) sheet.getRange(row, indexes['Workout Type']).setValue(rrSanitizeSheetText_(payload.workoutType || context.workoutType || 'Sprint Intervals'));
  if (indexes['Avg Drop']) sheet.getRange(row, indexes['Avg Drop']).setValue(summary.avgDrop || '');
  if (indexes['Peak HR']) sheet.getRange(row, indexes['Peak HR']).setValue(summary.peakHR || '');
  if (indexes['Intervals']) sheet.getRange(row, indexes['Intervals']).setValue(summary.intervals || '');
  rrWriteProofMetaColumns_(sheet, row, meta);
}

function rrAppendAthleteRawMileRow_(payload, meta, test, context) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RR_ATHLETE_RAW_SHEET);
  if (!sheet) return;
  var indexes = rrEnsureColumns_(sheet, [
    'Date', 'Athlete', 'Week', 'Day', 'Workout Type', 'Distance', 'Total Minutes', 'Avg BPM', 'Max BPM'
  ].concat(RR_PROOF_META_HEADERS));
  var row = sheet.getLastRow() + 1;
  if (indexes['Date']) sheet.getRange(row, indexes['Date']).setValue(test.savedAt ? new Date(test.savedAt) : new Date());
  if (indexes['Athlete']) sheet.getRange(row, indexes['Athlete']).setValue(rrSanitizeSheetText_(payload.athleteName || ''));
  if (indexes['Week']) sheet.getRange(row, indexes['Week']).setValue(rrSanitizeSheetText_(context.weekTab || 'Mile Test'));
  if (indexes['Day']) sheet.getRange(row, indexes['Day']).setValue(rrSanitizeSheetText_(context.dayOfWeek || ''));
  if (indexes['Workout Type']) sheet.getRange(row, indexes['Workout Type']).setValue(rrSanitizeSheetText_(context.workoutType || 'Mile Test'));
  if (indexes['Distance']) sheet.getRange(row, indexes['Distance']).setValue(test.distance || '');
  if (indexes['Total Minutes']) sheet.getRange(row, indexes['Total Minutes']).setValue(test.totalMinutes || '');
  if (indexes['Avg BPM']) sheet.getRange(row, indexes['Avg BPM']).setValue(test.avgBpm || '');
  if (indexes['Max BPM']) sheet.getRange(row, indexes['Max BPM']).setValue(test.maxBpm || '');
  rrWriteProofMetaColumns_(sheet, row, meta);
}
