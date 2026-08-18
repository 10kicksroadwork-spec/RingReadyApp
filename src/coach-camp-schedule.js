/**
 * Calendar-based camp scheduling for the coach roster.
 * Week 1 Monday aligns to camp start; each program day becomes due on that weekday.
 */

export function parseCampDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(`${text}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function campDayOffset(workoutDay) {
  const text = String(workoutDay || '');
  if (/saturday\/sunday|sat\/sun/i.test(text)) return 5;
  if (text.includes('Sunday') && !text.includes('Saturday')) return 6;
  if (text.includes('Saturday')) return 5;
  if (text.includes('Monday')) return 0;
  if (text.includes('Tuesday')) return 1;
  if (text.includes('Wednesday')) return 2;
  if (text.includes('Thursday')) return 3;
  if (text.includes('Friday')) return 4;
  return 0;
}

export function sessionDueDate(campStartDate, weekIndex, workoutDay) {
  const start = parseCampDate(campStartDate);
  if (!start) return null;
  const due = new Date(start);
  due.setDate(due.getDate() + (Number(weekIndex) * 7) + campDayOffset(workoutDay));
  return due;
}

export function isSessionDueYet(campStartDate, weekIndex, workoutDay, now = new Date()) {
  const due = sessionDueDate(campStartDate, weekIndex, workoutDay);
  if (!due) return true;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  return today.getTime() >= due.getTime();
}

export function inferCampWeekIndex(campStartDate, campLength, now = new Date()) {
  const start = parseCampDate(campStartDate);
  if (!start) return null;
  const lastWeek = (campLength === 4 ? 4 : 7) - 1;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  if (today.getTime() < start.getTime()) return 0;
  const idx = Math.floor((today.getTime() - start.getTime()) / (7 * 86400000));
  return Math.min(lastWeek, Math.max(0, idx));
}

export function formatCampStartLabel(campStartDate) {
  const date = parseCampDate(campStartDate);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
