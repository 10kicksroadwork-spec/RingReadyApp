/**
 * Drop-in patch for the live 10 Kicks Ring Ready receiver (your Apps Script editor version).
 *
 * Problem: Athlete Raw Data column "BPM Drop (Sprint)" uses summary.bpmDropCsv, which
 * older PWA builds built without negative drops. Web Extract / rrImportPwaReceiverToAthleteRawData
 * re-reads that stale CSV and the -1 disappears.
 *
 * Install:
 * 1. Paste this entire file into the SAME Apps Script project as your receiver.
 * 2. Replace the three functions at the bottom of your receiver file with the patched
 *    versions exported here (or keep originals — these override by name on save order).
 *
 * After install, re-run:
 *   rrImportPwaReceiverToAthleteRawData()
 */

function rrCalculateSprintDropsFromReps_(reps) {
  return (Array.isArray(reps) ? reps : []).map(function (rep) {
    var drop = Number(rep.drop);
    if (Number.isFinite(drop)) return drop;
    var sprint = Number(rep.sprintHR);
    var rest = Number(rep.restHR);
    if (Number.isFinite(sprint) && Number.isFinite(rest)) return sprint - rest;
    return null;
  }).filter(function (drop) {
    return drop !== null && Number.isFinite(drop);
  });
}

function rrSummarizeSprintDropsFromReps_(reps) {
  var drops = rrCalculateSprintDropsFromReps_(reps);
  if (!drops.length) {
    return { avgDrop: '', bpmDropCsv: '', validDropCount: '' };
  }
  var total = drops.reduce(function (sum, drop) {
    return sum + drop;
  }, 0);
  return {
    avgDrop: Math.round(total / drops.length),
    bpmDropCsv: drops.join(', '),
    validDropCount: drops.length,
  };
}

function rrApplySprintDropSummaryFromReps_(payload) {
  if (!payload || payload.eventType !== 'sprint_session') return payload;
  var reps = Array.isArray(payload.reps) ? payload.reps : [];
  var dropSummary = rrSummarizeSprintDropsFromReps_(reps);
  if (dropSummary.avgDrop === '') return payload;

  payload.summary = payload.summary || {};
  payload.summary.avgDrop = dropSummary.avgDrop;
  payload.summary.bpmDropCsv = dropSummary.bpmDropCsv;
  payload.summary.validDropCount = dropSummary.validDropCount;
  return payload;
}

/** Patched — recalculates avg/csv from reps before writing session row. */
function rrAppendSprintSession_(ss, payload, receivedAt) {
  payload = rrApplySprintDropSummaryFromReps_(payload);
  var cfg = payload.config || {};
  var summary = payload.summary || {};
  rrUpsertObjectRow_(ss.getSheetByName(RR_SHEET_NAMES.SPRINT_SESSIONS), RR_HEADERS.SPRINT_SESSIONS, {
    'Received At': receivedAt,
    'Session ID': payload.sessionId || '',
    'Event ID': payload.eventId || payload.sessionId || '',
    'Athlete': rrAthleteName_(payload),
    'Local Date': payload.localDate || '',
    'Submitted At': payload.submittedAt || '',
    'Workout Type': payload.workoutType || '',
    'HR Source': payload.hrSource || '',
    'Reps Planned': rrNumOrBlank_(cfg.reps),
    'Rest Seconds': rrNumOrBlank_(cfg.restSeconds),
    'Max HR': rrNumOrBlank_(cfg.maxHR),
    'Target %': rrNumOrBlank_(cfg.targetPct),
    'Target BPM': rrNumOrBlank_(cfg.targetBPM),
    'Intervals Completed': rrNumOrBlank_(summary.intervals),
    'Avg Drop': rrNumOrBlank_(summary.avgDrop),
    'Peak HR': rrNumOrBlank_(summary.peakHR),
    'Valid Drop Count': rrNumOrBlank_(summary.validDropCount),
    'BPM Drop CSV': summary.bpmDropCsv || '',
    'Profile JSON': rrJsonString_(payload.athleteProfile || {}),
  }, 'Session ID');
}

/** Patched — writes Drop cells as plain numbers so -1 is not lost. */
function rrAppendSprintReps_(ss, payload, receivedAt) {
  payload = rrApplySprintDropSummaryFromReps_(payload);
  var reps = Array.isArray(payload.reps) ? payload.reps : [];
  if (!reps.length) return;

  var sh = ss.getSheetByName(RR_SHEET_NAMES.SPRINT_REPS);
  rrDeleteRowsByValue_(sh, RR_HEADERS.SPRINT_REPS, 'Session ID', payload.sessionId || '');
  var dropCol = RR_HEADERS.SPRINT_REPS.indexOf('Drop') + 1;

  reps.forEach(function (rep, index) {
    var rowObject = {
      'Received At': receivedAt,
      'Session ID': payload.sessionId || '',
      'Event ID': payload.eventId || payload.sessionId || '',
      'Athlete': rrAthleteName_(payload),
      'Rep': rrNumOrBlank_(rep.rep || index + 1),
      'Sprint HR': rrNumOrBlank_(rep.sprintHR),
      'Rest HR': rrNumOrBlank_(rep.restHR),
      'Drop': rrNumOrBlank_(rep.drop),
      'Suspicious': rep.suspicious ? 'Yes' : 'No',
    };
    rrAppendObjectRow_(sh, RR_HEADERS.SPRINT_REPS, rowObject);
    if (dropCol > 0 && Number.isFinite(Number(rep.drop))) {
      sh.getRange(sh.getLastRow(), dropCol).setValue(Number(rep.drop)).setNumberFormat('0');
    }
  });
}

/** Patched — BPM Drop (Sprint) from reps, not stale summary.bpmDropCsv alone. */
function rrBuildSprintRawDataRow_(payload, receivedAt) {
  payload = rrApplySprintDropSummaryFromReps_(payload);
  var ctx = payload.workoutContext || {};
  var cfg = payload.config || {};
  var summary = payload.summary || {};
  var dropSummary = rrSummarizeSprintDropsFromReps_(payload.reps || []);

  return {
    'Athlete': rrAthleteName_(payload),
    'Week Tab': payload.weekTab || ctx.weekTab || '',
    'Workout Type': payload.workoutType || ctx.workoutType || 'Sprint Intervals',
    'Day of Week': payload.dayOfWeek || ctx.dayOfWeek || '',
    'Description': payload.description || ctx.description || '',
    'Warmup/ Cooldown': payload.warmup || ctx.warmup || '',
    'Target HR Zone': payload.targetZone || ctx.targetZone || '',
    'Target Average BPM': rrNumOrBlank_(cfg.targetBPM || ctx.targetBPM),
    'Completed': 'TRUE',
    'Completed At': payload.submittedAt || receivedAt,
    'Distance (mi)': rrSprintDistanceMiles_(payload),
    'Total Time (min)': '',
    'Average BPM': '',
    'Max BPM': rrNumOrBlank_(summary.peakHR),
    'BPM Drop (Sprint)': dropSummary.bpmDropCsv || summary.bpmDropCsv || '',
    'Source URL': rrPwaSourceMarker_(payload),
    'Start Date': '',
    'Expected Date': '',
    'Days From Start': '',
    'Schedule Status': 'PWA',
    'HR Delta (Avg - Target)': '',
    'Effort Ratio (Target/Avg)': '',
    'Equiv Distance (mi)': '',
    'Quality Flags': dropSummary.avgDrop !== '' && Number(dropSummary.avgDrop) < 0 ? 'Negative avg drop rep present' : '',
    'Disable Threshold Normalization': '',
  };
}

/** Patched import — recalculates drops from payload.reps in stored Raw Events JSON. */
function rrImportPwaReceiverToAthleteRawData() {
  var ss = rrSpreadsheet_();
  var rawEvents = ss.getSheetByName(RR_SHEET_NAMES.RAW);
  if (!rawEvents || rawEvents.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('No Ring Ready raw events found yet.');
    return;
  }

  var values = rawEvents.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header || ''); });
  var payloadIdx = headers.indexOf('Payload JSON');
  if (payloadIdx < 0) throw new Error('Payload JSON column not found in ' + RR_SHEET_NAMES.RAW + '.');

  var imported = 0;
  var skipped = 0;
  var errors = 0;

  for (var r = 1; r < values.length; r++) {
    var rawJson = values[r][payloadIdx];
    if (!rawJson) continue;

    try {
      var payload = JSON.parse(String(rawJson));
      if (payload.eventType === 'sprint_session') payload = rrApplySprintDropSummaryFromReps_(payload);
      var receivedAt = values[r][0] instanceof Date ? values[r][0] : new Date();
      if (payload.eventType !== 'sprint_session' && payload.eventType !== 'mile_test' && payload.eventType !== 'daily_workout') continue;
      if (rrAppendPwaWorkoutToAthleteRawData_(ss, payload, receivedAt)) imported++;
      else skipped++;
    } catch (err) {
      errors++;
      console.warn('Ring Ready import skipped row ' + (r + 1), err);
    }
  }

  SpreadsheetApp.getUi().alert(
    'Ring Ready PWA import complete',
    'Imported: ' + imported + '\nAlready present/skipped: ' + skipped + '\nErrors: ' + errors,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
