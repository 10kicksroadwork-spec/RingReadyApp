/**
 * 10 Kicks: Ring Ready PWA backend receiver (coach/master spreadsheet).
 *
 * Install in the Apps Script project bound to the coach/master spreadsheet.
 * Run rrSetupBackendSheets() once, then deploy as a Web App:
 * - Execute as: Me
 * - Who has access: Anyone with the link
 *
 * Handles PWA sync events and rebuilds Athlete Raw Data via rrImportPwaReceiverToAthleteRawData().
 * Clears removed workouts from Athlete Raw Data when the PWA sends workout_completion_clear.
 */

const RR_SHEET_NAMES = {
  RAW: 'Ring Ready Raw Events',
  SPRINT_SESSIONS: 'Ring Ready Sprint Sessions',
  SPRINT_REPS: 'Ring Ready Sprint Reps',
  MILE_TESTS: 'Ring Ready Mile Tests',
  DAILY_WORKOUTS: 'Ring Ready Daily Workouts',
  PROFILES: 'Ring Ready Profiles',
  HR_INFO: 'Ring Ready HR Info',
};

const RR_HEADERS = {
  RAW: [
    'Received At',
    'Event Type',
    'Event ID',
    'Athlete',
    'Local Date',
    'Submitted At',
    'App Name',
    'Payload JSON',
  ],
  SPRINT_SESSIONS: [
    'Received At',
    'Session ID',
    'Event ID',
    'Athlete',
    'Local Date',
    'Submitted At',
    'Workout Type',
    'HR Source',
    'Reps Planned',
    'Rest Seconds',
    'Max HR',
    'Target %',
    'Target BPM',
    'Intervals Completed',
    'Avg Drop',
    'Peak HR',
    'Valid Drop Count',
    'BPM Drop CSV',
    'Profile JSON',
  ],
  SPRINT_REPS: [
    'Received At',
    'Session ID',
    'Event ID',
    'Athlete',
    'Rep',
    'Sprint HR',
    'Rest HR',
    'Drop',
    'Suspicious',
  ],
  MILE_TESTS: [
    'Received At',
    'Event ID',
    'Athlete',
    'Local Date',
    'Submitted At',
    'Distance',
    'Total Minutes',
    'Pace Min/Mile',
    'Avg BPM',
    'Max BPM',
    'Saved At',
    'HR Info JSON',
    'Profile JSON',
  ],
  DAILY_WORKOUTS: [
    'Received At',
    'Event ID',
    'Athlete',
    'Local Date',
    'Submitted At',
    'Week Tab',
    'Workout Type',
    'Day of Week',
    'Distance',
    'Total Minutes',
    'Avg BPM',
    'Max BPM',
    'Target BPM',
    'Target Zone',
    'Completed At',
    'Profile JSON',
  ],
  PROFILES: [
    'Received At',
    'Event ID',
    'Athlete',
    'Local Date',
    'Submitted At',
    'Age',
    'Gender',
    'Gender Detail',
    'Training Tenure',
    'Primary Discipline',
    'Weight Class',
    'Fight Date',
    'Camp Length',
    'Profile JSON',
  ],
  HR_INFO: [
    'Received At',
    'Event ID',
    'Athlete',
    'Local Date',
    'Submitted At',
    'Goal Weight',
    'Target Date',
    'Max HR',
    'Resting HR',
    'HR Info JSON',
    'Profile JSON',
  ],
};

const RR_RAW_DATA_SHEET_NAME = 'Athlete Raw Data';
const RR_RAW_DATA_HEADERS = [
  'Athlete',
  'Week Tab',
  'Workout Type',
  'Day of Week',
  'Description',
  'Warmup/ Cooldown',
  'Target HR Zone',
  'Target Average BPM',
  'Completed',
  'Completed At',
  'Distance (mi)',
  'Total Time (min)',
  'Average BPM',
  'Max BPM',
  'BPM Drop (Sprint)',
  'Source URL',
  'Start Date',
  'Expected Date',
  'Days From Start',
  'Schedule Status',
  'HR Delta (Avg - Target)',
  'Effort Ratio (Target/Avg)',
  'Equiv Distance (mi)',
  'Quality Flags',
  'Disable Threshold Normalization',
];

function doGet() {
  return rrJsonResponse_({
    ok: true,
    app: '10 Kicks: Ring Ready',
    service: 'Google Sheets receiver',
    time: new Date().toISOString(),
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;

  try {
    lock.waitLock(10000);
    locked = true;

    var payload = rrParsePayload_(e);
    var result = rrHandlePayload_(payload, new Date());
    return rrJsonResponse_({
      ok: true,
      eventType: result.eventType,
      eventId: result.eventId,
      wrote: result.wrote,
    });
  } catch (err) {
    return rrJsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function rrSetupBackendSheets() {
  var ss = rrSpreadsheet_();
  rrEnsureBackendSheets_(ss);
  rrEnsureAthleteRawDataSheet_(ss);
  SpreadsheetApp.getUi().alert(
    'Ring Ready backend ready',
    'Receiver tabs were created/verified. Deploy this Apps Script project as a Web App and connect the URL to the PWA.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function rrTestBackendReceiver() {
  var payload = {
    schemaVersion: 1,
    appName: '10 Kicks: Ring Ready',
    eventType: 'sprint_session',
    eventId: 'test-' + Date.now(),
    sessionId: 'test-' + Date.now(),
    athleteName: 'Test Athlete',
    athleteProfile: { athleteName: 'Test Athlete', age: '28', gender: 'Man' },
    submittedAt: new Date().toISOString(),
    localDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy'),
    workoutType: 'Sprint Intervals',
    workoutContext: {
      weekTab: 'Week 1 (Foundation)',
      dayOfWeek: 'Monday',
      workoutType: 'Sprint Intervals',
      description: '2x150 m Sprints (90 Second rest). Backend receiver test.',
      warmup: 'Warm up as assigned.',
      targetZone: '90-95%',
      targetBPM: 171,
      reps: 2,
      restSeconds: 90,
      distanceMeters: 150,
    },
    weekTab: 'Week 1 (Foundation)',
    dayOfWeek: 'Monday',
    description: '2x150 m Sprints (90 Second rest). Backend receiver test.',
    warmup: 'Warm up as assigned.',
    targetZone: '90-95%',
    source: 'pwa-test',
    hrSource: 'manual',
    config: { reps: 2, restSeconds: 90, maxHR: 190, targetPct: 90, targetBPM: 171 },
    summary: { intervals: 2, avgDrop: 28, peakHR: 184, bpmDropCsv: '25, 31', validDropCount: 2 },
    reps: [
      { rep: 1, sprintHR: 181, restHR: 156, drop: 25, suspicious: false },
      { rep: 2, sprintHR: 184, restHR: 153, drop: 31, suspicious: false },
    ],
  };

  var result = rrHandlePayload_(payload, new Date());
  SpreadsheetApp.getUi().alert('Ring Ready test wrote: ' + result.wrote.join(', '));
}

function rrHandlePayload_(payload, receivedAt) {
  if (!payload || typeof payload !== 'object') throw new Error('Missing JSON payload.');
  if (!payload.eventType) throw new Error('Missing eventType.');

  var ss = rrSpreadsheet_();
  rrEnsureBackendSheets_(ss);
  rrUpsertRawEvent_(ss, payload, receivedAt);

  var wrote = [RR_SHEET_NAMES.RAW];
  if (payload.eventType === 'sprint_session') {
    rrAppendSprintSession_(ss, payload, receivedAt);
    rrAppendSprintReps_(ss, payload, receivedAt);
    wrote.push(RR_SHEET_NAMES.SPRINT_SESSIONS, RR_SHEET_NAMES.SPRINT_REPS);
    if (rrAppendPwaWorkoutToAthleteRawData_(ss, payload, receivedAt)) wrote.push(RR_RAW_DATA_SHEET_NAME);
  } else if (payload.eventType === 'mile_test') {
    rrAppendMileTest_(ss, payload, receivedAt);
    wrote.push(RR_SHEET_NAMES.MILE_TESTS);
    if (rrAppendPwaWorkoutToAthleteRawData_(ss, payload, receivedAt)) wrote.push(RR_RAW_DATA_SHEET_NAME);
  } else if (payload.eventType === 'daily_workout' || payload.eventType === 'daily_workout_skip') {
    rrAppendDailyWorkout_(ss, payload, receivedAt);
    wrote.push(RR_SHEET_NAMES.DAILY_WORKOUTS);
    if (rrAppendPwaWorkoutToAthleteRawData_(ss, payload, receivedAt)) wrote.push(RR_RAW_DATA_SHEET_NAME);
  } else if (
    payload.eventType === 'workout_completion_clear'
    || payload.eventType === 'daily_workout_deleted'
  ) {
    var clearResult = rrClearPwaWorkoutFromSheets_(ss, payload);
    wrote.push(RR_RAW_DATA_SHEET_NAME);
    if (clearResult.daily) wrote.push(RR_SHEET_NAMES.DAILY_WORKOUTS);
    if (clearResult.sprintSessions) wrote.push(RR_SHEET_NAMES.SPRINT_SESSIONS);
    if (clearResult.sprintReps) wrote.push(RR_SHEET_NAMES.SPRINT_REPS);
    if (clearResult.mileTests) wrote.push(RR_SHEET_NAMES.MILE_TESTS);
  } else if (payload.eventType === 'profile_update') {
    rrAppendProfile_(ss, payload, receivedAt);
    wrote.push(RR_SHEET_NAMES.PROFILES);
  } else if (payload.eventType === 'hr_info_update') {
    rrAppendHRInfo_(ss, payload, receivedAt);
    wrote.push(RR_SHEET_NAMES.HR_INFO);
  }

  return {
    eventType: payload.eventType,
    eventId: payload.eventId || payload.sessionId || '',
    wrote: wrote,
  };
}

function rrParsePayload_(e) {
  var contents = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!contents && e && e.parameter && e.parameter.payload) contents = e.parameter.payload;
  if (!contents) throw new Error('Empty request body.');
  return JSON.parse(contents);
}

function rrSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This receiver must be bound to a spreadsheet.');
  return ss;
}

function rrEnsureBackendSheets_(ss) {
  rrEnsureSheet_(ss, RR_SHEET_NAMES.RAW, RR_HEADERS.RAW);
  rrEnsureSheet_(ss, RR_SHEET_NAMES.SPRINT_SESSIONS, RR_HEADERS.SPRINT_SESSIONS);
  rrEnsureSheet_(ss, RR_SHEET_NAMES.SPRINT_REPS, RR_HEADERS.SPRINT_REPS);
  rrEnsureSheet_(ss, RR_SHEET_NAMES.MILE_TESTS, RR_HEADERS.MILE_TESTS);
  rrEnsureSheet_(ss, RR_SHEET_NAMES.DAILY_WORKOUTS, RR_HEADERS.DAILY_WORKOUTS);
  rrEnsureSheet_(ss, RR_SHEET_NAMES.PROFILES, RR_HEADERS.PROFILES);
  rrEnsureSheet_(ss, RR_SHEET_NAMES.HR_INFO, RR_HEADERS.HR_INFO);
}

function rrEnsureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var range = sh.getRange(1, 1, 1, headers.length);
  var current = range.getValues()[0];
  var needsHeaders = current.some(function (value, index) {
    return String(value || '') !== headers[index];
  });

  if (needsHeaders) {
    range.setValues([headers]);
    range.setFontWeight('bold');
    range.setBackground('#111111');
    range.setFontColor('#f6cf3d');
    sh.setFrozenRows(1);
  }

  sh.autoResizeColumns(1, headers.length);
  return sh;
}

function rrUpsertRawEvent_(ss, payload, receivedAt) {
  rrUpsertObjectRow_(ss.getSheetByName(RR_SHEET_NAMES.RAW), RR_HEADERS.RAW, {
    'Received At': receivedAt,
    'Event Type': payload.eventType || '',
    'Event ID': payload.eventId || payload.sessionId || '',
    'Athlete': rrAthleteName_(payload),
    'Local Date': payload.localDate || '',
    'Submitted At': payload.submittedAt || '',
    'App Name': payload.appName || '',
    'Payload JSON': rrJsonString_(payload),
  }, 'Event ID');
}

function rrAppendSprintSession_(ss, payload, receivedAt) {
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

function rrAppendSprintReps_(ss, payload, receivedAt) {
  var reps = Array.isArray(payload.reps) ? payload.reps : [];
  if (!reps.length) return;

  var sh = ss.getSheetByName(RR_SHEET_NAMES.SPRINT_REPS);
  rrDeleteRowsByValue_(sh, RR_HEADERS.SPRINT_REPS, 'Session ID', payload.sessionId || '');
  var rows = reps.map(function (rep, index) {
    return RR_HEADERS.SPRINT_REPS.map(function (header) {
      var row = {
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
      return row[header] === undefined ? '' : row[header];
    });
  });

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, RR_HEADERS.SPRINT_REPS.length).setValues(rows);
}

function rrAppendMileTest_(ss, payload, receivedAt) {
  var test = payload.test || {};
  rrUpsertObjectRow_(ss.getSheetByName(RR_SHEET_NAMES.MILE_TESTS), RR_HEADERS.MILE_TESTS, {
    'Received At': receivedAt,
    'Event ID': payload.eventId || '',
    'Athlete': rrAthleteName_(payload),
    'Local Date': payload.localDate || '',
    'Submitted At': payload.submittedAt || '',
    'Distance': rrNumOrBlank_(test.distance),
    'Total Minutes': rrNumOrBlank_(test.totalMinutes),
    'Pace Min/Mile': rrNumOrBlank_(test.paceMinPerMile),
    'Avg BPM': rrNumOrBlank_(test.avgBpm),
    'Max BPM': rrNumOrBlank_(test.maxBpm),
    'Saved At': test.savedAt || '',
    'HR Info JSON': rrJsonString_(payload.hrInfo || {}),
    'Profile JSON': rrJsonString_(payload.athleteProfile || {}),
  }, 'Event ID');
}

function rrAppendDailyWorkout_(ss, payload, receivedAt) {
  var log = payload.workoutLog || {};
  var ctx = payload.workoutContext || {};
  rrUpsertObjectRow_(ss.getSheetByName(RR_SHEET_NAMES.DAILY_WORKOUTS), RR_HEADERS.DAILY_WORKOUTS, {
    'Received At': receivedAt,
    'Event ID': payload.eventId || '',
    'Athlete': rrAthleteName_(payload),
    'Local Date': payload.localDate || '',
    'Submitted At': payload.submittedAt || '',
    'Week Tab': payload.weekTab || ctx.weekTab || '',
    'Workout Type': payload.workoutType || ctx.workoutType || 'Daily Workout',
    'Day of Week': payload.dayOfWeek || ctx.dayOfWeek || '',
    'Distance': rrNumOrBlank_(log.distance),
    'Total Minutes': rrNumOrBlank_(log.totalMinutes),
    'Avg BPM': rrNumOrBlank_(log.avgBpm),
    'Max BPM': rrNumOrBlank_(log.maxBpm),
    'Target BPM': rrNumOrBlank_(payload.targetBPM || ctx.targetBPM),
    'Target Zone': payload.targetZone || ctx.targetZone || '',
    'Completed At': log.completedAt || payload.submittedAt || '',
    'Profile JSON': rrJsonString_(payload.athleteProfile || {}),
  }, 'Event ID');
}

function rrAppendProfile_(ss, payload, receivedAt) {
  var profile = payload.profile || payload.athleteProfile || {};
  rrUpsertObjectRow_(ss.getSheetByName(RR_SHEET_NAMES.PROFILES), RR_HEADERS.PROFILES, {
    'Received At': receivedAt,
    'Event ID': payload.eventId || '',
    'Athlete': profile.athleteName || payload.athleteName || '',
    'Local Date': payload.localDate || '',
    'Submitted At': payload.submittedAt || '',
    'Age': profile.age || '',
    'Gender': profile.gender || '',
    'Gender Detail': profile.genderDetail || '',
    'Training Tenure': profile.trainingTenure || '',
    'Primary Discipline': profile.primaryDiscipline || '',
    'Weight Class': profile.weightClass || '',
    'Fight Date': profile.fightDate || '',
    'Camp Length': profile.campLength || '',
    'Profile JSON': rrJsonString_(profile),
  }, 'Event ID');
}

function rrAppendHRInfo_(ss, payload, receivedAt) {
  var hr = payload.hrInfo || {};
  rrUpsertObjectRow_(ss.getSheetByName(RR_SHEET_NAMES.HR_INFO), RR_HEADERS.HR_INFO, {
    'Received At': receivedAt,
    'Event ID': payload.eventId || '',
    'Athlete': rrAthleteName_(payload),
    'Local Date': payload.localDate || '',
    'Submitted At': payload.submittedAt || '',
    'Goal Weight': rrNumOrBlank_(hr.goalWeight),
    'Target Date': hr.targetDate || '',
    'Max HR': rrNumOrBlank_(hr.maxHr),
    'Resting HR': rrNumOrBlank_(hr.restingHr),
    'HR Info JSON': rrJsonString_(hr),
    'Profile JSON': rrJsonString_(payload.athleteProfile || {}),
  }, 'Event ID');
}

function rrUpsertObjectRow_(sh, headers, rowObject, keyHeader) {
  var keyIndex = headers.indexOf(keyHeader);
  var keyValue = keyIndex >= 0 ? String(rowObject[keyHeader] || '') : '';
  var targetRow = sh.getLastRow() + 1;

  if (keyValue && sh.getLastRow() >= 2) {
    var values = sh.getRange(2, keyIndex + 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (var index = 0; index < values.length; index++) {
      if (String(values[index][0] || '') === keyValue) {
        targetRow = index + 2;
        break;
      }
    }
  }

  var row = headers.map(function (header) {
    return rowObject[header] === undefined ? '' : rowObject[header];
  });
  sh.getRange(targetRow, 1, 1, headers.length).setValues([row]);
}

function rrDeleteRowsByValue_(sh, headers, keyHeader, keyValue) {
  if (!sh || !keyValue || sh.getLastRow() < 2) return 0;
  var keyIndex = headers.indexOf(keyHeader);
  if (keyIndex < 0) return 0;
  var values = sh.getRange(2, keyIndex + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  var removed = 0;
  for (var index = values.length - 1; index >= 0; index--) {
    if (String(values[index][0] || '') === String(keyValue)) {
      sh.deleteRow(index + 2);
      removed++;
    }
  }
  return removed;
}

function rrAppendObjectRow_(sh, headers, rowObject) {
  var row = headers.map(function (header) {
    return rowObject[header] === undefined ? '' : rowObject[header];
  });
  sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function rrAthleteName_(payload) {
  return payload.athleteName || (payload.athleteProfile && payload.athleteProfile.athleteName) || '';
}

function rrNumOrBlank_(value) {
  var num = Number(value);
  return Number.isFinite(num) ? num : '';
}

function rrJsonString_(value) {
  try {
    return JSON.stringify(value || {});
  } catch (err) {
    return String(value || '');
  }
}

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
      var receivedAt = values[r][0] instanceof Date ? values[r][0] : new Date();
      if (payload.eventType !== 'sprint_session' && payload.eventType !== 'mile_test'
        && payload.eventType !== 'daily_workout' && payload.eventType !== 'daily_workout_skip') continue;
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

/** Legacy menu alias for rebuilding Athlete Raw Data from raw events. */
function WebExtract() {
  rrImportPwaReceiverToAthleteRawData();
}

function rrAppendPwaWorkoutToAthleteRawData_(ss, payload, receivedAt) {
  if (payload.eventType !== 'sprint_session' && payload.eventType !== 'mile_test'
    && payload.eventType !== 'daily_workout' && payload.eventType !== 'daily_workout_skip') return false;

  var marker = rrPwaSourceMarker_(payload);
  if (!marker) return false;

  var sh = rrEnsureAthleteRawDataSheet_(ss);
  var rowObject = payload.eventType === 'sprint_session'
    ? rrBuildSprintRawDataRow_(payload, receivedAt)
    : payload.eventType === 'mile_test'
      ? rrBuildMileRawDataRow_(payload, receivedAt)
      : rrBuildDailyWorkoutRawDataRow_(payload, receivedAt);

  rrUpsertRawDataRowObject_(sh, rowObject, marker);
  return true;
}

function rrBuildSprintRawDataRow_(payload, receivedAt) {
  var ctx = payload.workoutContext || {};
  var cfg = payload.config || {};
  var summary = payload.summary || {};

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
    'BPM Drop (Sprint)': summary.bpmDropCsv || '',
    'Source URL': rrPwaSourceMarker_(payload),
    'Start Date': '',
    'Expected Date': '',
    'Days From Start': '',
    'Schedule Status': 'PWA',
    'HR Delta (Avg - Target)': '',
    'Effort Ratio (Target/Avg)': '',
    'Equiv Distance (mi)': '',
    'Quality Flags': '',
    'Disable Threshold Normalization': '',
  };
}

function rrBuildMileRawDataRow_(payload, receivedAt) {
  var ctx = payload.testContext || {};
  var test = payload.test || {};

  return {
    'Athlete': rrAthleteName_(payload),
    'Week Tab': ctx.weekTab || 'Mile Test',
    'Workout Type': ctx.workoutType || 'Mile Test',
    'Day of Week': ctx.dayOfWeek || '',
    'Description': ctx.description || '',
    'Warmup/ Cooldown': ctx.warmup || '',
    'Target HR Zone': 'Max HR Test',
    'Target Average BPM': '',
    'Completed': 'TRUE',
    'Completed At': test.savedAt || payload.submittedAt || receivedAt,
    'Distance (mi)': rrNumOrBlank_(test.distance),
    'Total Time (min)': rrNumOrBlank_(test.totalMinutes),
    'Average BPM': rrNumOrBlank_(test.avgBpm),
    'Max BPM': rrNumOrBlank_(test.maxBpm),
    'BPM Drop (Sprint)': '',
    'Source URL': rrPwaSourceMarker_(payload),
    'Start Date': '',
    'Expected Date': '',
    'Days From Start': '',
    'Schedule Status': 'PWA',
    'HR Delta (Avg - Target)': '',
    'Effort Ratio (Target/Avg)': '',
    'Equiv Distance (mi)': '',
    'Quality Flags': '',
    'Disable Threshold Normalization': '',
  };
}

function rrBuildDailyWorkoutRawDataRow_(payload, receivedAt) {
  var ctx = payload.workoutContext || {};
  var log = payload.workoutLog || {};

  return {
    'Athlete': rrAthleteName_(payload),
    'Week Tab': payload.weekTab || ctx.weekTab || '',
    'Workout Type': payload.workoutType || ctx.workoutType || 'Daily Workout',
    'Day of Week': payload.dayOfWeek || ctx.dayOfWeek || '',
    'Description': payload.description || ctx.description || '',
    'Warmup/ Cooldown': payload.warmup || ctx.warmup || '',
    'Target HR Zone': payload.targetZone || ctx.targetZone || '',
    'Target Average BPM': rrNumOrBlank_(payload.targetBPM || ctx.targetBPM),
    'Completed': log.status === 'skipped' ? 'SKIPPED' : 'TRUE',
    'Completed At': log.completedAt || payload.submittedAt || receivedAt,
    'Distance (mi)': rrNumOrBlank_(log.distance),
    'Total Time (min)': rrNumOrBlank_(log.totalMinutes),
    'Average BPM': rrNumOrBlank_(log.avgBpm),
    'Max BPM': rrNumOrBlank_(log.maxBpm),
    'BPM Drop (Sprint)': '',
    'Source URL': rrPwaSourceMarker_(payload),
    'Start Date': '',
    'Expected Date': '',
    'Days From Start': '',
    'Schedule Status': 'PWA',
    'HR Delta (Avg - Target)': '',
    'Effort Ratio (Target/Avg)': '',
    'Equiv Distance (mi)': '',
    'Quality Flags': '',
    'Disable Threshold Normalization': '',
  };
}

function rrEnsureAthleteRawDataSheet_(ss) {
  var sh = ss.getSheetByName(RR_RAW_DATA_SHEET_NAME) || ss.insertSheet(RR_RAW_DATA_SHEET_NAME);
  rrEnsureRawDataHeaders_(sh);
  return sh;
}

function rrEnsureRawDataHeaders_(sh) {
  var width = Math.max(sh.getLastColumn(), RR_RAW_DATA_HEADERS.length);
  var current = [];

  if (width > 0) {
    current = sh.getRange(1, 1, 1, width).getValues()[0].map(function (header) {
      return String(header || '');
    });
  }

  var hasHeaders = current.some(function (header) { return header !== ''; });
  if (!hasHeaders) current = RR_RAW_DATA_HEADERS.slice();

  RR_RAW_DATA_HEADERS.forEach(function (header) {
    if (current.indexOf(header) === -1) current.push(header);
  });

  sh.getRange(1, 1, 1, current.length).setValues([current]);
  sh.getRange(1, 1, 1, current.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return current;
}

function rrRawDataHasSource_(sh, marker) {
  var headers = rrEnsureRawDataHeaders_(sh);
  var sourceIdx = headers.indexOf('Source URL');
  if (sourceIdx < 0 || sh.getLastRow() < 2) return false;

  var values = sh.getRange(2, sourceIdx + 1, sh.getLastRow() - 1, 1).getValues();
  return values.some(function (row) { return String(row[0] || '') === marker; });
}

function rrUpsertRawDataRowObject_(sh, rowObject, marker) {
  var headers = rrEnsureRawDataHeaders_(sh);
  var sourceIdx = headers.indexOf('Source URL');
  var targetRow = sh.getLastRow() + 1;

  if (sourceIdx >= 0 && marker && sh.getLastRow() >= 2) {
    var values = sh.getRange(2, sourceIdx + 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (var index = 0; index < values.length; index++) {
      if (String(values[index][0] || '') === String(marker)) {
        targetRow = index + 2;
        break;
      }
    }
  }

  var row = headers.map(function (header) {
    return rowObject[header] === undefined ? '' : rowObject[header];
  });
  sh.getRange(targetRow, 1, 1, headers.length).setValues([row]);
}

function rrPwaSourceMarker_(payload) {
  var id = payload.linkedRecordId || payload.eventId || payload.sessionId || '';
  return id ? 'Ring Ready PWA:' + id : '';
}

function rrClearPwaWorkoutFromSheets_(ss, payload) {
  var marker = rrPwaSourceMarker_(payload);
  var originalId = String(payload.linkedRecordId || payload.eventId || payload.sessionId || '');
  var result = {
    rawData: 0,
    daily: 0,
    sprintSessions: 0,
    sprintReps: 0,
    mileTests: 0,
  };

  if (originalId) {
    result.daily = rrDeleteRowsByValue_(
      ss.getSheetByName(RR_SHEET_NAMES.DAILY_WORKOUTS),
      RR_HEADERS.DAILY_WORKOUTS,
      'Event ID',
      originalId
    );
    result.sprintSessions = rrDeleteRowsByValue_(
      ss.getSheetByName(RR_SHEET_NAMES.SPRINT_SESSIONS),
      RR_HEADERS.SPRINT_SESSIONS,
      'Session ID',
      originalId
    );
    result.sprintReps = rrDeleteRowsByValue_(
      ss.getSheetByName(RR_SHEET_NAMES.SPRINT_REPS),
      RR_HEADERS.SPRINT_REPS,
      'Session ID',
      originalId
    );
    result.mileTests = rrDeleteRowsByValue_(
      ss.getSheetByName(RR_SHEET_NAMES.MILE_TESTS),
      RR_HEADERS.MILE_TESTS,
      'Event ID',
      originalId
    );
  }

  var rawDataSheet = rrEnsureAthleteRawDataSheet_(ss);
  var rawHeaders = rrEnsureRawDataHeaders_(rawDataSheet);

  if (marker) {
    result.rawData += rrDeleteRowsByValue_(rawDataSheet, rawHeaders, 'Source URL', marker);
  }

  if (!result.rawData) {
    result.rawData += rrDeleteAthleteRawRowsBySlot_(rawDataSheet, rawHeaders, payload);
  }

  return result;
}

function rrDeleteAthleteRawRowsBySlot_(sh, headers, payload) {
  var ctx = payload.workoutContext || {};
  var athlete = String(rrAthleteName_(payload) || '').trim();
  var weekTab = String(payload.weekTab || ctx.weekTab || '').trim();
  var dayOfWeek = String(payload.dayOfWeek || ctx.dayOfWeek || '').trim();
  if (!athlete || (!weekTab && !dayOfWeek)) return 0;

  var athleteIdx = headers.indexOf('Athlete');
  var weekIdx = headers.indexOf('Week Tab');
  var dayIdx = headers.indexOf('Day of Week');
  if (athleteIdx < 0 || weekIdx < 0 || dayIdx < 0 || sh.getLastRow() < 2) return 0;

  var removed = 0;
  for (var row = sh.getLastRow(); row >= 2; row--) {
    var rowAthlete = String(sh.getRange(row, athleteIdx + 1).getDisplayValue() || '').trim();
    var rowWeek = String(sh.getRange(row, weekIdx + 1).getDisplayValue() || '').trim();
    var rowDay = String(sh.getRange(row, dayIdx + 1).getDisplayValue() || '').trim();
    if (rowAthlete !== athlete) continue;
    if (weekTab && rowWeek !== weekTab) continue;
    if (dayOfWeek && rowDay !== dayOfWeek) continue;
    sh.deleteRow(row);
    removed++;
  }
  return removed;
}

function rrSprintDistanceMiles_(payload) {
  var ctx = payload.workoutContext || {};
  var cfg = payload.config || {};
  var summary = payload.summary || {};
  var reps = Number(ctx.reps || cfg.reps || summary.intervals || 0);
  var meters = Number(ctx.distanceMeters || 0);

  if (!meters) {
    var text = String((payload.description || ctx.description || '') + ' ' + (payload.workoutType || ctx.workoutType || ''));
    var match = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*m/i);
    if (match) {
      if (!reps) reps = Number(match[1]);
      meters = Number(match[2]);
    }
  }

  if (!reps || !meters) return '';
  return Math.round(((reps * meters) / 1609.344) * 100) / 100;
}

function rrJsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
