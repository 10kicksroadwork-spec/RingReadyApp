/**
 * Drop-in patch for the live coach/master Apps Script project.
 *
 * Problem: Web App Extract / rrImportPwaReceiverToAthleteRawData writes Athlete
 * Raw Data in week/chronological order across all athletes, so the same person
 * is scattered through the sheet.
 *
 * Fix: after extract (and on demand), group rows by the Athlete column.
 *
 * Install:
 * 1. Paste this file into the SAME Apps Script project as your receiver.
 * 2. Save. Apps Script uses the last definition of WebExtract() — this patch
 *    should load after your receiver file, or replace the receiver's WebExtract.
 * 3. Re-run the "Web App Extract" / WebExtract() menu action.
 *
 * Optional one-shot without re-import:
 *   rrSortAthleteRawDataByAthlete()
 */

/** Menu alias — rebuild from raw events, then group by athlete. */
function WebExtract() {
  rrImportPwaReceiverToAthleteRawData();
  // Import may already sort (newer CoachMaster). Second sort is idempotent.
  rrSortAthleteRawDataByAthlete_();
}

/**
 * Regroup Athlete Raw Data by athlete without re-importing.
 * Wire this to a custom menu item if useful.
 */
function rrSortAthleteRawDataByAthlete() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Athlete Raw Data');
  if (!sh) {
    SpreadsheetApp.getUi().alert('Missing sheet: Athlete Raw Data');
    return;
  }
  rrSortAthleteRawDataByAthlete_(sh);
  SpreadsheetApp.getUi().alert(
    'Athlete Raw Data sorted',
    'Workouts are now grouped by Athlete.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 */
function rrSortAthleteRawDataByAthlete_(sh) {
  if (!sh) return;
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 3 || lastCol < 1) return;

  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var athleteCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var header = String(headers[i] || '').trim().toLowerCase();
    if (header === 'athlete' || header === 'athlete name') {
      athleteCol = i;
      break;
    }
  }
  if (athleteCol < 0) return;

  // Preserve per-row formatting/colors by sorting the sheet range in place.
  sh.getRange(2, 1, lastRow - 1, lastCol).sort({
    column: athleteCol + 1,
    ascending: true
  });
}
