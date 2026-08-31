/**
 * One-time Google Sheets backfill for sprint recovery drops.
 *
 * Problem:
 * Older PWA builds excluded negative / suspicious drops from summary.avgDrop
 * when syncing sprint sessions. Per-rep rows usually still stored the raw Drop
 * value (e.g. -1), but Ring Ready Sprint Sessions and Athlete Raw Data could
 * show an average that ignored those reps.
 *
 * Install:
 * 1. Open the Apps Script project bound to the coach/master Google Sheet.
 * 2. Add RingReadySprintDropUtils.gs, then this file, alongside RingReadyWebApp.gs.
 * 3. Run once from the Apps Script editor:
 *
 *    rrBackfillSprintDropAverages(true);   // dry run — review Logger output
 *    rrBackfillSprintDropAverages(false);  // apply sheet updates
 *
 * Safe to re-run. Sessions whose stored average already matches the rep math
 * are skipped.
 */

var RR_SPRINT_SHEET = 'Ring Ready Sprint Sessions';
var RR_SPRINT_REPS_SHEET = 'Ring Ready Sprint Reps';
var RR_ATHLETE_RAW_SHEET = 'Athlete Raw Data';
var RR_PROOF_META_HEADERS = ['User ID', 'Linked Record ID', 'Proof Key', 'Week Index', 'Workout Index'];

/**
 * @param {boolean=} dryRun When true (default), only logs planned changes.
 * @return {Object} Summary counts.
 */
function rrBackfillSprintDropAverages(dryRun) {
  if (dryRun === undefined || dryRun === null) dryRun = true;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var repsSheet = spreadsheet.getSheetByName(RR_SPRINT_REPS_SHEET);
  if (!repsSheet || repsSheet.getLastRow() < 2) {
    throw new Error('No sprint rep rows found in "' + RR_SPRINT_REPS_SHEET + '".');
  }

  var repIndexes = rrBackfillEnsureColumns_(repsSheet, [
    'Received At', 'Session ID', 'Rep', 'Sprint HR', 'Rest HR', 'Drop', 'Suspicious'
  ]);
  var sessionsById = rrBackfillLoadSessionsFromReps_(repsSheet, repIndexes);
  var sessionIds = Object.keys(sessionsById);
  if (!sessionIds.length) {
    Logger.log('No sprint sessions found in rep sheet.');
    return { dryRun: dryRun, sessions: 0, updatedSessions: 0, updatedAthleteRaw: 0, fixedReps: 0 };
  }

  var fixedReps = rrBackfillFixRepRows_(repsSheet, repIndexes, sessionsById, dryRun);
  rrBackfillRecalculateSessionAverages_(sessionsById);

  var sprintSheet = spreadsheet.getSheetByName(RR_SPRINT_SHEET);
  var updatedSessions = sprintSheet
    ? rrBackfillUpdateSprintSessionAverages_(sprintSheet, sessionsById, dryRun)
    : 0;

  var athleteSheet = spreadsheet.getSheetByName(RR_ATHLETE_RAW_SHEET);
  var updatedAthleteRaw = athleteSheet
    ? rrBackfillUpdateAthleteRawAverages_(athleteSheet, sessionsById, dryRun)
    : 0;

  var changedCount = sessionIds.filter(function(sessionId) {
    return sessionsById[sessionId].changed;
  }).length;

  Logger.log(
    (dryRun ? '[DRY RUN] ' : '') +
    'Sprint drop backfill complete. Sessions scanned: ' + sessionIds.length +
    '; averages to change: ' + changedCount +
    '; sprint session rows updated: ' + updatedSessions +
    '; athlete raw rows updated: ' + updatedAthleteRaw +
    '; rep rows normalized: ' + fixedReps + '.'
  );

  sessionIds.forEach(function(sessionId) {
    var session = sessionsById[sessionId];
    if (!session.changed) return;
    Logger.log(
      (dryRun ? '[DRY RUN] ' : '') +
      sessionId +
      (session.athlete ? ' (' + session.athlete + ')' : '') +
      ': avg ' + (session.previousAvg === null ? '—' : session.previousAvg) +
      ' -> ' + session.newAvg +
      ' | drops [' + session.drops.join(', ') + ']'
    );
  });

  return {
    dryRun: dryRun,
    sessions: sessionIds.length,
    averagesChanged: changedCount,
    updatedSessions: updatedSessions,
    updatedAthleteRaw: updatedAthleteRaw,
    fixedReps: fixedReps
  };
}

function rrBackfillLoadSessionsFromReps_(repsSheet, indexes) {
  var values = repsSheet.getDataRange().getDisplayValues();
  var sessions = {};

  for (var row = 1; row < values.length; row++) {
    var line = values[row];
    var sessionId = String(line[(indexes['Session ID'] || 2) - 1] || '').trim();
    if (!sessionId) continue;

    var sprintHR = rrBackfillNumberOrNull_(line[(indexes['Sprint HR'] || 4) - 1]);
    var restHR = rrBackfillNumberOrNull_(line[(indexes['Rest HR'] || 5) - 1]);
    var normalized = rrBackfillNormalizeRep_(
      sprintHR,
      restHR,
      line[(indexes['Drop'] || 6) - 1],
      line[(indexes['Suspicious'] || 7) - 1]
    );

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        sessionId: sessionId,
        athlete: '',
        reps: [],
        drops: [],
        previousAvg: null,
        newAvg: null,
        changed: false
      };
    }

    sessions[sessionId].reps.push({
      rowNumber: row + 1,
      rep: rrBackfillNumberOrNull_(line[(indexes['Rep'] || 3) - 1]),
      sprintHR: sprintHR,
      restHR: restHR,
      drop: normalized.drop,
      suspicious: normalized.suspicious
    });
  }

  Object.keys(sessions).forEach(function(sessionId) {
    var session = sessions[sessionId];
    session.reps.sort(function(a, b) {
      return (a.rep || 0) - (b.rep || 0);
    });
    session.drops = session.reps
      .map(function(rep) { return rep.drop; })
      .filter(function(drop) { return rrBackfillIsLoggedDrop_(drop); })
      .map(function(drop) { return Number(drop); });
  });

  return sessions;
}

function rrBackfillRecalculateSessionAverages_(sessionsById) {
  Object.keys(sessionsById).forEach(function(sessionId) {
    var session = sessionsById[sessionId];
    session.newAvg = rrBackfillCalculateAvgDrop_(session.drops);
  });
}

function rrBackfillFixRepRows_(repsSheet, indexes, sessionsById, dryRun) {
  var fixed = 0;

  Object.keys(sessionsById).forEach(function(sessionId) {
    sessionsById[sessionId].reps.forEach(function(rep) {
      var values = repsSheet.getRange(rep.rowNumber, 1, 1, repsSheet.getLastColumn()).getDisplayValues()[0];
      var currentDrop = values[(indexes['Drop'] || 6) - 1];
      var currentSuspicious = values[(indexes['Suspicious'] || 7) - 1];
      var nextDrop = rep.drop;
      var nextSuspicious = rep.suspicious ? 'yes' : '';

      var dropChanged = String(currentDrop) !== String(nextDrop);
      var suspiciousChanged = String(currentSuspicious || '') !== String(nextSuspicious || '');
      if (!dropChanged && !suspiciousChanged) return;

      fixed++;
      if (dryRun) return;

      if (indexes['Drop']) {
        repsSheet.getRange(rep.rowNumber, indexes['Drop']).setValue(nextDrop === null ? '' : nextDrop);
      }
      if (indexes['Suspicious']) {
        repsSheet.getRange(rep.rowNumber, indexes['Suspicious']).setValue(nextSuspicious);
      }
    });
  });

  return fixed;
}

function rrBackfillUpdateSprintSessionAverages_(sheet, sessionsById, dryRun) {
  var indexes = rrBackfillEnsureColumns_(sheet, [
    'Received At', 'Session ID', 'Athlete', 'User ID', 'Linked Record ID', 'Proof Key',
    'Week Index', 'Workout Index', 'Week Tab', 'Day', 'Workout Type', 'Intervals',
    'Avg Drop', 'Peak HR', 'Target BPM', 'Submitted At'
  ].concat(RR_PROOF_META_HEADERS));

  var values = sheet.getDataRange().getDisplayValues();
  var updated = 0;

  for (var row = 1; row < values.length; row++) {
    var line = values[row];
    var sessionId = String(line[(indexes['Session ID'] || 2) - 1] || '').trim();
    if (!sessionId || !sessionsById[sessionId]) continue;

    var session = sessionsById[sessionId];
    if (session.athlete === '' && indexes['Athlete']) {
      session.athlete = String(line[indexes['Athlete'] - 1] || '').trim();
    }

    var avgCol = indexes['Avg Drop'];
    if (!avgCol || session.newAvg === null) continue;

    var currentAvg = rrBackfillNumberOrNull_(line[avgCol - 1]);
    session.previousAvg = currentAvg;
    if (currentAvg === session.newAvg) continue;

    session.changed = true;
    updated++;
    if (!dryRun) sheet.getRange(row + 1, avgCol).setValue(session.newAvg);
  }

  return updated;
}

function rrBackfillUpdateAthleteRawAverages_(sheet, sessionsById, dryRun) {
  var indexes = rrBackfillEnsureColumns_(sheet, [
    'Date', 'Athlete', 'Week', 'Day', 'Workout Type', 'Avg Drop', 'Peak HR', 'Intervals'
  ].concat(RR_PROOF_META_HEADERS));

  var values = sheet.getDataRange().getDisplayValues();
  var updated = 0;
  var linkedCol = indexes['Linked Record ID'];

  for (var row = 1; row < values.length; row++) {
    var line = values[row];
    if (!linkedCol) continue;

    var sessionId = String(line[linkedCol - 1] || '').trim();
    if (!sessionId || !sessionsById[sessionId]) continue;

    var workoutType = String(line[(indexes['Workout Type'] || 5) - 1] || '').trim();
    if (workoutType && workoutType.toLowerCase().indexOf('sprint') === -1) continue;

    var avgCol = indexes['Avg Drop'];
    if (!avgCol) continue;

    var session = sessionsById[sessionId];
    if (session.newAvg === null) continue;

    var currentAvg = rrBackfillNumberOrNull_(line[avgCol - 1]);
    if (session.previousAvg === null) session.previousAvg = currentAvg;
    if (currentAvg === session.newAvg) continue;

    session.changed = true;
    updated++;
    if (!dryRun) sheet.getRange(row + 1, avgCol).setValue(session.newAvg);
  }

  return updated;
}

function rrBackfillCalculateAvgDrop_(drops) {
  if (!drops || !drops.length) return null;
  var total = drops.reduce(function(sum, drop) { return sum + Number(drop); }, 0);
  return Math.round(total / drops.length);
}

function rrBackfillIsLoggedDrop_(drop) {
  return drop !== null && drop !== undefined && drop !== '' && isFinite(Number(drop));
}

function rrBackfillNormalizeRep_(sprintHR, restHR, dropValue, suspiciousValue) {
  var sprint = rrBackfillNumberOrNull_(sprintHR);
  var rest = rrBackfillNumberOrNull_(restHR);
  var drop = rrBackfillNumberOrNull_(dropValue);
  if (drop === null && sprint !== null && rest !== null) drop = sprint - rest;

  var suspicious = String(suspiciousValue || '').toLowerCase() === 'yes';
  if (sprint !== null && rest !== null && rest > sprint) suspicious = true;

  return {
    drop: drop,
    suspicious: suspicious
  };
}

function rrBackfillNumberOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var num = Number(value);
  return isFinite(num) ? num : null;
}

function rrBackfillEnsureColumns_(sheet, names) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var indexes = {};
  names.forEach(function(name) {
    var index = headers.indexOf(name);
    if (index >= 0) indexes[name] = index + 1;
  });
  return indexes;
}
