/**
 * Pure helpers mirroring Apps Script Athlete Raw Data grouping.
 * Used by unit tests; keep behavior aligned with
 * scripts/RingReadyWebAppCoachMaster.gs → rrSortAthleteRawDataByAthlete_.
 */

/**
 * @param {string[]} headers
 * @returns {number} 0-based column index, or -1
 */
export function findAthleteColumnIndex(headers) {
  for (let i = 0; i < (headers || []).length; i += 1) {
    const header = String(headers[i] || '').trim().toLowerCase();
    if (header === 'athlete' || header === 'athlete name') return i;
  }
  return -1;
}

/**
 * Case-insensitive athlete name compare. Returns 0 when equal so callers can
 * keep a stable secondary order (week / chronology within each athlete).
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number}
 */
export function compareAthleteNames(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Stable sort of data rows by athlete column.
 *
 * @param {unknown[][]} rows
 * @param {number} athleteIndex
 * @returns {unknown[][]}
 */
export function sortAthleteRawDataRows(rows, athleteIndex) {
  if (!Array.isArray(rows) || rows.length < 2 || athleteIndex < 0) {
    return Array.isArray(rows) ? rows.slice() : [];
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareAthleteNames(a.row[athleteIndex], b.row[athleteIndex]);
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map(({ row }) => row);
}
