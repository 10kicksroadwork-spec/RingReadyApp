/**
 * Shared sprint drop helpers for Ring Ready Apps Script files.
 * Counts every logged numeric drop, including negative / suspicious values.
 */

function rrSprintDropIsLogged_(drop) {
  return drop !== null && drop !== undefined && drop !== '' && isFinite(Number(drop));
}

function rrSprintDropNumberOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var num = Number(value);
  return isFinite(num) ? num : null;
}

function rrSprintDropNormalizeRep_(sprintHR, restHR, dropValue, suspiciousValue) {
  var sprint = rrSprintDropNumberOrNull_(sprintHR);
  var rest = rrSprintDropNumberOrNull_(restHR);
  var drop = rrSprintDropNumberOrNull_(dropValue);
  if (drop === null && sprint !== null && rest !== null) drop = sprint - rest;

  var suspicious = String(suspiciousValue || '').toLowerCase() === 'yes';
  if (sprint !== null && rest !== null && rest > sprint) suspicious = true;

  return {
    drop: drop,
    suspicious: suspicious
  };
}

function rrSprintDropCalculateAvgFromDrops_(drops) {
  var logged = (drops || []).filter(function(drop) { return rrSprintDropIsLogged_(drop); }).map(Number);
  if (!logged.length) return null;
  return Math.round(logged.reduce(function(sum, drop) { return sum + drop; }, 0) / logged.length);
}

function rrSprintDropCalculateAvgFromReps_(reps) {
  var drops = (reps || []).map(function(rep) {
    if (rrSprintDropIsLogged_(rep.drop)) return Number(rep.drop);
    var sprint = rrSprintDropNumberOrNull_(rep.sprintHR);
    var rest = rrSprintDropNumberOrNull_(rep.restHR);
    return sprint !== null && rest !== null ? sprint - rest : null;
  });
  return rrSprintDropCalculateAvgFromDrops_(drops);
}

function rrSprintDropEnsureColumns_(sheet, names) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var indexes = {};
  names.forEach(function(name) {
    var index = headers.indexOf(name);
    if (index >= 0) indexes[name] = index + 1;
  });
  return indexes;
}

function rrSprintDropLoadSessionsFromRepsSheet_(repsSheet) {
  var indexes = rrSprintDropEnsureColumns_(repsSheet, [
    'Received At', 'Session ID', 'Rep', 'Sprint HR', 'Rest HR', 'Drop', 'Suspicious'
  ]);
  var values = repsSheet.getDataRange().getDisplayValues();
  var sessions = {};

  for (var row = 1; row < values.length; row++) {
    var line = values[row];
    var sessionId = String(line[(indexes['Session ID'] || 2) - 1] || '').trim();
    if (!sessionId) continue;

    var normalized = rrSprintDropNormalizeRep_(
      line[(indexes['Sprint HR'] || 4) - 1],
      line[(indexes['Rest HR'] || 5) - 1],
      line[(indexes['Drop'] || 6) - 1],
      line[(indexes['Suspicious'] || 7) - 1]
    );

    if (!sessions[sessionId]) {
      sessions[sessionId] = { sessionId: sessionId, reps: [], drops: [] };
    }

    sessions[sessionId].reps.push({
      rowNumber: row + 1,
      rep: rrSprintDropNumberOrNull_(line[(indexes['Rep'] || 3) - 1]),
      sprintHR: rrSprintDropNumberOrNull_(line[(indexes['Sprint HR'] || 4) - 1]),
      restHR: rrSprintDropNumberOrNull_(line[(indexes['Rest HR'] || 5) - 1]),
      drop: normalized.drop,
      suspicious: normalized.suspicious
    });
  }

  Object.keys(sessions).forEach(function(sessionId) {
    var session = sessions[sessionId];
    session.reps.sort(function(a, b) { return (a.rep || 0) - (b.rep || 0); });
    session.drops = session.reps
      .map(function(rep) { return rep.drop; })
      .filter(function(drop) { return rrSprintDropIsLogged_(drop); })
      .map(Number);
    session.avgDrop = rrSprintDropCalculateAvgFromDrops_(session.drops);
  });

  return { indexes: indexes, sessions: sessions };
}

function rrSprintDropWriteRepCell_(sheet, rowNumber, colIndex, value) {
  if (!colIndex) return;
  var cell = sheet.getRange(rowNumber, colIndex);
  if (value === null || value === undefined || value === '') {
    cell.clearContent();
    return;
  }
  cell.setValue(value);
  cell.setNumberFormat('0');
}
