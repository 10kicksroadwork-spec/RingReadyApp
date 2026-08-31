/**
 * Rebuild Athlete Raw Data sprint rows from Ring Ready receiver tabs.
 *
 * Use this instead of the legacy "Web Extract" menu action, which recalculated
 * sprint averages from stale summary values and could drop negative drops.
 *
 * Install in the same Apps Script project as RingReadyWebApp.gs and
 * RingReadySprintDropUtils.gs, then either:
 *
 *   rrImportPwaReceiverToAthleteRawData(true);   // dry run
 *   rrImportPwaReceiverToAthleteRawData(false);  // apply
 *
 * Or point the custom menu / legacy Web Extract button at:
 *
 *   WebExtract();
 */

var RR_IMPORT_SPRINT_SHEET = 'Ring Ready Sprint Sessions';
var RR_IMPORT_SPRINT_REPS_SHEET = 'Ring Ready Sprint Reps';
var RR_IMPORT_MILE_SHEET = 'Ring Ready Mile Tests';
var RR_IMPORT_ATHLETE_RAW_SHEET = 'Athlete Raw Data';
var RR_IMPORT_PROOF_META_HEADERS = ['User ID', 'Linked Record ID', 'Proof Key', 'Week Index', 'Workout Index'];

/**
 * @param {boolean=} dryRun Defaults to true.
 * @return {Object} Summary counts.
 */
function rrImportPwaReceiverToAthleteRawData(dryRun) {
  if (dryRun === undefined || dryRun === null) dryRun = true;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var athleteSheet = spreadsheet.getSheetByName(RR_IMPORT_ATHLETE_RAW_SHEET);
  if (!athleteSheet) throw new Error('Missing sheet: ' + RR_IMPORT_ATHLETE_RAW_SHEET);

  var repsSheet = spreadsheet.getSheetByName(RR_IMPORT_SPRINT_REPS_SHEET);
  var sessionsSheet = spreadsheet.getSheetByName(RR_IMPORT_SPRINT_SHEET);
  if (!repsSheet || repsSheet.getLastRow() < 2) {
    throw new Error('No sprint rep rows found in "' + RR_IMPORT_SPRINT_REPS_SHEET + '".');
  }
  if (!sessionsSheet || sessionsSheet.getLastRow() < 2) {
    throw new Error('No sprint session rows found in "' + RR_IMPORT_SPRINT_SHEET + '".');
  }

  var loaded = rrSprintDropLoadSessionsFromRepsSheet_(repsSheet);
  var sessionsById = loaded.sessions;
  var repIndexes = loaded.indexes;
  var sessionMeta = rrImportLoadSprintSessionMeta_(sessionsSheet);
  var fixedReps = rrImportFixRepRows_(repsSheet, repIndexes, sessionsById, dryRun);
  var updatedSessions = rrImportUpdateSprintSessionAverages_(sessionsSheet, sessionsById, dryRun);
  var sprintRaw = rrImportSyncSprintRowsToAthleteRaw_(athleteSheet, sessionsById, sessionMeta, dryRun);
  var mileRaw = rrImportSyncMileRowsToAthleteRaw_(athleteSheet, spreadsheet.getSheetByName(RR_IMPORT_MILE_SHEET), dryRun);

  Logger.log(
    (dryRun ? '[DRY RUN] ' : '') +
    'Athlete Raw import complete. Sprint sessions: ' + Object.keys(sessionsById).length +
    '; rep rows normalized: ' + fixedReps +
    '; sprint session avgs updated: ' + updatedSessions +
    '; athlete raw sprint rows updated: ' + sprintRaw.updated +
    '; athlete raw sprint rows added: ' + sprintRaw.added +
    '; athlete raw mile rows updated: ' + mileRaw.updated +
    '; athlete raw mile rows added: ' + mileRaw.added + '.'
  );

  return {
    dryRun: dryRun,
    sessions: Object.keys(sessionsById).length,
    fixedReps: fixedReps,
    updatedSessions: updatedSessions,
    athleteRawSprintUpdated: sprintRaw.updated,
    athleteRawSprintAdded: sprintRaw.added,
    athleteRawMileUpdated: mileRaw.updated,
    athleteRawMileAdded: mileRaw.added
  };
}

/** Legacy menu alias — replace old Web Extract with this handler. */
function WebExtract() {
  return rrImportPwaReceiverToAthleteRawData(false);
}

function webExtract() {
  return WebExtract();
}

function rrImportLoadSprintSessionMeta_(sessionsSheet) {
  var indexes = rrSprintDropEnsureColumns_(sessionsSheet, [
    'Received At', 'Session ID', 'Athlete', 'User ID', 'Linked Record ID', 'Proof Key',
    'Week Index', 'Workout Index', 'Week Tab', 'Day', 'Workout Type', 'Intervals',
    'Avg Drop', 'Peak HR', 'Target BPM', 'Submitted At'
  ].concat(RR_IMPORT_PROOF_META_HEADERS));

  var values = sessionsSheet.getDataRange().getDisplayValues();
  var metaById = {};

  for (var row = 1; row < values.length; row++) {
    var line = values[row];
    var sessionId = String(line[(indexes['Session ID'] || 2) - 1] || '').trim();
    if (!sessionId) continue;
    metaById[sessionId] = {
      rowNumber: row + 1,
      sessionId: sessionId,
      athlete: String(line[(indexes['Athlete'] || 3) - 1] || '').trim(),
      userId: String(line[(indexes['User ID'] || 4) - 1] || '').trim(),
      linkedRecordId: String(line[(indexes['Linked Record ID'] || 5) - 1] || sessionId).trim(),
      proofKey: String(line[(indexes['Proof Key'] || 6) - 1] || '').trim(),
      weekIndex: line[(indexes['Week Index'] || 7) - 1],
      workoutIndex: line[(indexes['Workout Index'] || 8) - 1],
      weekTab: String(line[(indexes['Week Tab'] || 9) - 1] || '').trim(),
      day: String(line[(indexes['Day'] || 10) - 1] || '').trim(),
      workoutType: String(line[(indexes['Workout Type'] || 11) - 1] || 'Sprint Intervals').trim(),
      intervals: line[(indexes['Intervals'] || 12) - 1],
      peakHR: line[(indexes['Peak HR'] || 14) - 1],
      submittedAt: line[(indexes['Submitted At'] || 16) - 1]
    };
  }

  return { indexes: indexes, metaById: metaById };
}

function rrImportFixRepRows_(repsSheet, indexes, sessionsById, dryRun) {
  var fixed = 0;
  Object.keys(sessionsById).forEach(function(sessionId) {
    sessionsById[sessionId].reps.forEach(function(rep) {
      var values = repsSheet.getRange(rep.rowNumber, 1, 1, repsSheet.getLastColumn()).getDisplayValues()[0];
      var currentDrop = values[(indexes['Drop'] || 6) - 1];
      var currentSuspicious = values[(indexes['Suspicious'] || 7) - 1];
      var nextDrop = rep.drop;
      var nextSuspicious = rep.suspicious ? 'yes' : '';
      if (String(currentDrop) === String(nextDrop) && String(currentSuspicious || '') === String(nextSuspicious || '')) return;

      fixed++;
      if (dryRun) return;

      rrSprintDropWriteRepCell_(repsSheet, rep.rowNumber, indexes['Drop'], nextDrop);
      if (indexes['Suspicious']) repsSheet.getRange(rep.rowNumber, indexes['Suspicious']).setValue(nextSuspicious);
    });
  });
  return fixed;
}

function rrImportUpdateSprintSessionAverages_(sessionsSheet, sessionsById, dryRun) {
  var loaded = rrImportLoadSprintSessionMeta_(sessionsSheet);
  var indexes = loaded.indexes;
  var updated = 0;

  Object.keys(loaded.metaById).forEach(function(sessionId) {
    var meta = loaded.metaById[sessionId];
    var session = sessionsById[sessionId];
    if (!session || session.avgDrop === null) return;

    var values = sessionsSheet.getRange(meta.rowNumber, 1, 1, sessionsSheet.getLastColumn()).getDisplayValues()[0];
    var currentAvg = rrSprintDropNumberOrNull_(values[(indexes['Avg Drop'] || 13) - 1]);
    if (currentAvg === session.avgDrop) return;

    updated++;
    if (!dryRun && indexes['Avg Drop']) {
      rrSprintDropWriteRepCell_(sessionsSheet, meta.rowNumber, indexes['Avg Drop'], session.avgDrop);
    }
  });

  return updated;
}

function rrImportSyncSprintRowsToAthleteRaw_(athleteSheet, sessionsById, sessionMeta, dryRun) {
  var indexes = rrSprintDropEnsureColumns_(athleteSheet, [
    'Date', 'Athlete', 'Week', 'Day', 'Workout Type', 'Avg Drop', 'Peak HR', 'Intervals'
  ].concat(RR_IMPORT_PROOF_META_HEADERS));

  var values = athleteSheet.getDataRange().getDisplayValues();
  var rowBySessionId = rrImportIndexAthleteRawRows_(values, indexes);
  var updated = 0;
  var added = 0;

  Object.keys(sessionMeta.metaById).forEach(function(sessionId) {
    var meta = sessionMeta.metaById[sessionId];
    var session = sessionsById[sessionId];
    if (!session || session.avgDrop === null) return;

    var linkedId = meta.linkedRecordId || sessionId;
    var targetRow = rowBySessionId[linkedId] || rowBySessionId[sessionId];
    var isNew = !targetRow;

    if (isNew) {
      targetRow = athleteSheet.getLastRow() + 1;
      added++;
    } else {
      updated++;
    }

    if (dryRun) return;

    if (indexes['Date']) {
      athleteSheet.getRange(targetRow, indexes['Date']).setValue(meta.submittedAt ? new Date(meta.submittedAt) : new Date());
    }
    if (indexes['Athlete']) athleteSheet.getRange(targetRow, indexes['Athlete']).setValue(meta.athlete || '');
    if (indexes['Week']) athleteSheet.getRange(targetRow, indexes['Week']).setValue(meta.weekTab || '');
    if (indexes['Day']) athleteSheet.getRange(targetRow, indexes['Day']).setValue(meta.day || '');
    if (indexes['Workout Type']) athleteSheet.getRange(targetRow, indexes['Workout Type']).setValue(meta.workoutType || 'Sprint Intervals');
    if (indexes['Avg Drop']) rrSprintDropWriteRepCell_(athleteSheet, targetRow, indexes['Avg Drop'], session.avgDrop);
    if (indexes['Peak HR']) athleteSheet.getRange(targetRow, indexes['Peak HR']).setValue(meta.peakHR || '');
    if (indexes['Intervals']) athleteSheet.getRange(targetRow, indexes['Intervals']).setValue(meta.intervals || session.reps.length);

    rrImportWriteProofMeta_(athleteSheet, targetRow, indexes, {
      userId: meta.userId,
      linkedRecordId: linkedId,
      proofKey: meta.proofKey,
      weekIndex: meta.weekIndex,
      workoutIndex: meta.workoutIndex
    });
  });

  return { updated: updated, added: added };
}

function rrImportSyncMileRowsToAthleteRaw_(athleteSheet, mileSheet, dryRun) {
  if (!mileSheet || mileSheet.getLastRow() < 2) return { updated: 0, added: 0 };

  var mileIndexes = rrSprintDropEnsureColumns_(mileSheet, [
    'Received At', 'Linked Record ID', 'Athlete', 'User ID', 'Proof Key', 'Week Index',
    'Workout Index', 'Distance', 'Total Minutes', 'Avg BPM', 'Max BPM', 'Pace', 'Saved At'
  ]);
  var athleteIndexes = rrSprintDropEnsureColumns_(athleteSheet, [
    'Date', 'Athlete', 'Week', 'Day', 'Workout Type', 'Distance', 'Total Minutes', 'Avg BPM', 'Max BPM'
  ].concat(RR_IMPORT_PROOF_META_HEADERS));

  var mileValues = mileSheet.getDataRange().getDisplayValues();
  var athleteValues = athleteSheet.getDataRange().getDisplayValues();
  var rowByLinkedId = rrImportIndexAthleteRawRows_(athleteValues, athleteIndexes);
  var updated = 0;
  var added = 0;

  for (var row = 1; row < mileValues.length; row++) {
    var line = mileValues[row];
    var linkedId = String(line[(mileIndexes['Linked Record ID'] || 2) - 1] || '').trim();
    if (!linkedId) continue;

    var targetRow = rowByLinkedId[linkedId];
    var isNew = !targetRow;
    if (isNew) {
      targetRow = athleteSheet.getLastRow() + 1;
      added++;
    } else {
      updated++;
    }

    if (dryRun) continue;

    if (athleteIndexes['Date']) {
      athleteSheet.getRange(targetRow, athleteIndexes['Date']).setValue(line[(mileIndexes['Saved At'] || 13) - 1] || new Date());
    }
    if (athleteIndexes['Athlete']) athleteSheet.getRange(targetRow, athleteIndexes['Athlete']).setValue(line[(mileIndexes['Athlete'] || 3) - 1] || '');
    if (athleteIndexes['Week']) athleteSheet.getRange(targetRow, athleteIndexes['Week']).setValue('Mile Test');
    if (athleteIndexes['Day']) athleteSheet.getRange(targetRow, athleteIndexes['Day']).setValue('');
    if (athleteIndexes['Workout Type']) athleteSheet.getRange(targetRow, athleteIndexes['Workout Type']).setValue('Mile Test');
    if (athleteIndexes['Distance']) athleteSheet.getRange(targetRow, athleteIndexes['Distance']).setValue(line[(mileIndexes['Distance'] || 8) - 1] || '');
    if (athleteIndexes['Total Minutes']) athleteSheet.getRange(targetRow, athleteIndexes['Total Minutes']).setValue(line[(mileIndexes['Total Minutes'] || 9) - 1] || '');
    if (athleteIndexes['Avg BPM']) athleteSheet.getRange(targetRow, athleteIndexes['Avg BPM']).setValue(line[(mileIndexes['Avg BPM'] || 10) - 1] || '');
    if (athleteIndexes['Max BPM']) athleteSheet.getRange(targetRow, athleteIndexes['Max BPM']).setValue(line[(mileIndexes['Max BPM'] || 11) - 1] || '');

    rrImportWriteProofMeta_(athleteSheet, targetRow, athleteIndexes, {
      userId: String(line[(mileIndexes['User ID'] || 4) - 1] || '').trim(),
      linkedRecordId: linkedId,
      proofKey: String(line[(mileIndexes['Proof Key'] || 5) - 1] || '').trim(),
      weekIndex: line[(mileIndexes['Week Index'] || 6) - 1],
      workoutIndex: line[(mileIndexes['Workout Index'] || 7) - 1]
    });
  }

  return { updated: updated, added: added };
}

function rrImportIndexAthleteRawRows_(values, indexes) {
  var linkedCol = indexes['Linked Record ID'];
  var map = {};
  if (!linkedCol) return map;

  for (var row = 1; row < values.length; row++) {
    var linkedId = String(values[row][linkedCol - 1] || '').trim();
    if (linkedId) map[linkedId] = row + 1;
  }
  return map;
}

function rrImportWriteProofMeta_(sheet, rowNumber, indexes, meta) {
  if (indexes['User ID']) sheet.getRange(rowNumber, indexes['User ID']).setValue(meta.userId || '');
  if (indexes['Linked Record ID']) sheet.getRange(rowNumber, indexes['Linked Record ID']).setValue(meta.linkedRecordId || '');
  if (indexes['Proof Key']) sheet.getRange(rowNumber, indexes['Proof Key']).setValue(meta.proofKey || '');
  if (indexes['Week Index']) sheet.getRange(rowNumber, indexes['Week Index']).setValue(meta.weekIndex === '' ? '' : meta.weekIndex);
  if (indexes['Workout Index']) sheet.getRange(rowNumber, indexes['Workout Index']).setValue(meta.workoutIndex === '' ? '' : meta.workoutIndex);
}
