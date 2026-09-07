/**
 * Canonical coach analytics lenses — shared by Detailed Summary and
 * aggregate metric pages. Same athlete + same scan data must yield the
 * same value/status everywhere (see docs/COACH_DECISION_DASHBOARD_SPEC.md).
 */

import { MILE_TEST_BASELINE_KEY } from './workout-completion-identity.js';

export { MILE_TEST_BASELINE_KEY } from './workout-completion-identity.js';

export const LENS_BENCHMARK = 'benchmark';
export const LENS_RECOVERY = 'recovery';
export const LENS_PACE = 'pace';
export const LENS_HR_ADHERENCE = 'hrAdherence';

export const STATUS_IMPROVING = 'improving';
export const STATUS_DECLINING = 'declining';
export const STATUS_BASELINE = 'baseline';
export const STATUS_ON_TARGET = 'on-target';
export const STATUS_NEEDS_ATTENTION = 'needs-attention';
export const STATUS_WATCH = 'watch';
export const STATUS_NO_DATA = 'no-data';
export const STATUS_UNAVAILABLE = 'unavailable';

const PACE_FLAT_PCT = 0.8;

export const METRIC_PAGE_DEFS = {
  [LENS_BENCHMARK]: {
    screenId: 'coach-benchmark-stats',
    title: 'Benchmark Stats',
    sortLabel: 'Performance Index',
    defaultSort: 'desc',
    filters: [
      { id: 'improving', label: 'Improving' },
      { id: 'declining', label: 'Declining' },
      { id: 'all', label: 'All' },
    ],
  },
  [LENS_RECOVERY]: {
    screenId: 'coach-recovery-stats',
    title: 'Recovery Stats',
    sortLabel: 'Recovery Improvement',
    defaultSort: 'desc',
    filters: [
      { id: 'improving', label: 'Improving' },
      { id: 'declining', label: 'Declining' },
      { id: 'all', label: 'All' },
    ],
  },
  [LENS_PACE]: {
    screenId: 'coach-pace-stats',
    title: 'Overall Pace Stats',
    sortLabel: 'Pace Improvement',
    defaultSort: 'desc',
    filters: [
      { id: 'improving', label: 'Improving' },
      { id: 'declining', label: 'Declining' },
      { id: 'all', label: 'All' },
    ],
  },
  [LENS_HR_ADHERENCE]: {
    screenId: 'coach-hr-adherence-stats',
    title: 'HR Adherence Stats',
    sortLabel: 'Adherence',
    defaultSort: 'asc',
    filters: [
      { id: 'on-target', label: 'On Target' },
      { id: 'needs-attention', label: 'Needs Attention' },
      { id: 'all', label: 'All' },
    ],
  },
};

export function screenIdForLens(lens) {
  return METRIC_PAGE_DEFS[lens]?.screenId || '';
}

export function lensForScreenId(screenId) {
  return Object.keys(METRIC_PAGE_DEFS).find((lens) => METRIC_PAGE_DEFS[lens].screenId === screenId) || '';
}

/**
 * PI status: >100 Improving, =100 Baseline, <100 Declining.
 * Baseline is never labeled Improving.
 */
export function classifyPerformanceIndex(index) {
  if (!Number.isFinite(index)) {
    return { status: STATUS_NO_DATA, hasData: false, sortValue: null, delta: null };
  }
  const delta = index - 100;
  if (index > 100) {
    return { status: STATUS_IMPROVING, hasData: true, sortValue: index, delta };
  }
  if (index < 100) {
    return { status: STATUS_DECLINING, hasData: true, sortValue: index, delta };
  }
  return { status: STATUS_BASELINE, hasData: true, sortValue: index, delta: 0 };
}

/**
 * Higher First-5 BPM drop = better recovery.
 * delta = latest - baseline.
 */
export function classifyRecovery(latest, baseline, sampleCount = 0) {
  const latestNum = Number(latest);
  const baselineNum = Number(baseline);
  if (!Number.isFinite(latestNum) || !Number.isFinite(baselineNum) || sampleCount < 1) {
    return { status: STATUS_NO_DATA, hasData: false, sortValue: null, delta: null };
  }
  if (sampleCount < 2) {
    return {
      status: STATUS_BASELINE,
      hasData: true,
      sortValue: 0,
      delta: 0,
      latest: latestNum,
      baseline: baselineNum,
    };
  }
  const delta = latestNum - baselineNum;
  let status = STATUS_BASELINE;
  if (delta > 0.4) status = STATUS_IMPROVING;
  else if (delta < -0.4) status = STATUS_DECLINING;
  return {
    status,
    hasData: true,
    sortValue: delta,
    delta,
    latest: latestNum,
    baseline: baselineNum,
  };
}

export function classifyPace(latestPct, hasComparableWeeks) {
  if (!hasComparableWeeks || !Number.isFinite(latestPct)) {
    return { status: STATUS_NO_DATA, hasData: false, sortValue: null, delta: null };
  }
  let status = STATUS_BASELINE;
  if (latestPct > PACE_FLAT_PCT) status = STATUS_IMPROVING;
  else if (latestPct < -PACE_FLAT_PCT) status = STATUS_DECLINING;
  return { status, hasData: true, sortValue: latestPct, delta: latestPct };
}

/**
 * Zone adherence thresholds match buildZoneSignal:
 * >=80 on-target, >=60 watch, else needs-attention.
 * Zero eligible → No Data (not 0%).
 */
export function classifyHrAdherence(onTarget, scored) {
  const scoredNum = Number(scored);
  const onTargetNum = Number(onTarget);
  if (!Number.isFinite(scoredNum) || scoredNum <= 0 || !Number.isFinite(onTargetNum)) {
    return { status: STATUS_NO_DATA, hasData: false, sortValue: null, pct: null };
  }
  const pct = Math.round((onTargetNum / scoredNum) * 100);
  let status = STATUS_NEEDS_ATTENTION;
  if (pct >= 80) status = STATUS_ON_TARGET;
  else if (pct >= 60) status = STATUS_WATCH;
  return { status, hasData: true, sortValue: pct, pct, onTarget: onTargetNum, scored: scoredNum };
}

export function statusBadgeLabel(status) {
  switch (status) {
    case STATUS_IMPROVING: return 'IMPROVING';
    case STATUS_DECLINING: return 'DECLINING';
    case STATUS_BASELINE: return 'BASELINE';
    case STATUS_ON_TARGET: return 'ON TARGET';
    case STATUS_NEEDS_ATTENTION: return 'NEEDS ATTENTION';
    case STATUS_WATCH: return 'WATCH';
    case STATUS_NO_DATA: return 'NO DATA';
    case STATUS_UNAVAILABLE: return 'DATA UNAVAILABLE';
    default: return 'NO DATA';
  }
}

/**
 * Whether a card passes a page filter chip.
 * PI/recovery/pace: improving | declining | all
 * HR: on-target | needs-attention | all
 * Baseline/Watch/No Data appear under All only.
 */
export function cardMatchesFilter(card, filterId) {
  const filter = String(filterId || 'all');
  if (filter === 'all') return true;
  if (!card?.hasData) return false;
  if (filter === 'improving') return card.status === STATUS_IMPROVING;
  if (filter === 'declining') return card.status === STATUS_DECLINING;
  if (filter === 'on-target') return card.status === STATUS_ON_TARGET;
  if (filter === 'needs-attention') return card.status === STATUS_NEEDS_ATTENTION;
  return true;
}

export function cardMatchesSearch(card, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(card?.athleteName || '').toLowerCase().includes(q);
}

export function sortMetricCards(cards, direction = 'desc') {
  const dir = direction === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    const aOk = a.hasData && Number.isFinite(a.sortValue);
    const bOk = b.hasData && Number.isFinite(b.sortValue);
    if (aOk && bOk && a.sortValue !== b.sortValue) {
      return a.sortValue > b.sortValue ? dir : -dir;
    }
    if (aOk !== bOk) return aOk ? -1 : 1;
    return String(a.athleteName || '').localeCompare(String(b.athleteName || ''), undefined, { sensitivity: 'base' });
  });
}

function formatSignedPct(pct, digits = 1) {
  if (!Number.isFinite(pct)) return '--';
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(digits)}%`;
}

function formatPi(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(1) : '--';
}

/** HR-adjusted equivalent distance for Benchmark Index (matches coach-preview). */
const BENCHMARK_EQUIV_RATIO_MIN = 0.85;
const BENCHMARK_EQUIV_RATIO_MAX = 1.15;
const BENCHMARK_EQUIV_K = 0.5;
const BENCHMARK_TARGET_BPM = 137;

function clampBenchmarkRatio(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

export function getBenchmarkEquivDistance(distance, avgBpm, targetBpm = BENCHMARK_TARGET_BPM) {
  const dist = Number(distance);
  if (!Number.isFinite(dist) || dist <= 0) return null;
  const avg = Number(avgBpm);
  const tgt = Number(targetBpm) || BENCHMARK_TARGET_BPM;
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(tgt) || tgt <= 0) return dist;
  const ratio = clampBenchmarkRatio(tgt / avg, BENCHMARK_EQUIV_RATIO_MIN, BENCHMARK_EQUIV_RATIO_MAX);
  const equiv = dist * (ratio ** BENCHMARK_EQUIV_K);
  return Number.isFinite(equiv) && equiv > 0 ? equiv : dist;
}

/**
 * Canonical Benchmark Index from valid Benchmark sessions only.
 * Week 1 = 100; later weeks = equivDistance / week1Equiv × 100.
 * Distinct from the cross-modality Performance Index (2-session baseline).
 */
export function buildBenchmarkMetricFromPoints(points = [], { unavailable = false, unavailableDetail = '' } = {}) {
  if (unavailable) {
    return {
      ...unavailableMetric(unavailableDetail || 'Completion source unavailable — Benchmark Index not classified'),
      baselineEquivalentDistance: null,
      latestEquivalentDistance: null,
      index: null,
      unavailable: true,
    };
  }

  const valid = (Array.isArray(points) ? points : [])
    .map((row) => {
      const equiv = Number.isFinite(Number(row?.equiv)) && Number(row.equiv) > 0
        ? Number(row.equiv)
        : getBenchmarkEquivDistance(row?.distance, row?.avgBpm, row?.targetBPM);
      return {
        weekIndex: Number.isFinite(Number(row?.weekIndex)) ? Number(row.weekIndex) : null,
        equiv,
        distance: Number(row?.distance),
        avgBpm: Number(row?.avgBpm),
      };
    })
    .filter((row) => Number.isFinite(row.equiv) && row.equiv > 0);

  if (!valid.length) {
    return {
      value: null,
      displayValue: '--',
      delta: null,
      detail: 'No benchmark yet',
      status: STATUS_NO_DATA,
      badge: statusBadgeLabel(STATUS_NO_DATA),
      tone: statusToTone(STATUS_NO_DATA),
      hasData: false,
      baselineEquivalentDistance: null,
      latestEquivalentDistance: null,
      index: null,
      trendPoints: [],
      unavailable: false,
    };
  }

  const baselineEquiv = valid[0].equiv;
  const trendPoints = valid.map((row) => {
    const index = baselineEquiv > 0 ? (row.equiv / baselineEquiv) * 100 : 100;
    return {
      weekIndex: row.weekIndex,
      value: Number(Number(index).toFixed(1)),
      equiv: row.equiv,
    };
  });
  const latest = trendPoints[trendPoints.length - 1];
  const index = latest.value;
  const classified = classifyPerformanceIndex(index);
  const latestEquiv = valid[valid.length - 1].equiv;

  return {
    value: classified.hasData ? index : null,
    displayValue: classified.hasData ? formatPi(index) : '--',
    delta: classified.delta,
    detail: classified.hasData
      ? (valid.length < 2
        ? 'Week 1 sets the baseline'
        : `W1 100 → ${formatPi(index)}`)
      : 'No benchmark yet',
    status: classified.status,
    badge: statusBadgeLabel(classified.status),
    tone: statusToTone(classified.status),
    hasData: classified.hasData,
    baselineEquivalentDistance: baselineEquiv,
    latestEquivalentDistance: latestEquiv,
    index: classified.hasData ? index : null,
    trendPoints,
    unavailable: false,
  };
}

function resolveBenchmarkPoints(athlete, helpers = {}) {
  const fromScan = athlete?.scan?.bench?.points;
  if (Array.isArray(fromScan) && fromScan.length) {
    return fromScan;
  }
  if (Array.isArray(athlete?.benchmarks) && athlete.benchmarks.length) {
    return athlete.benchmarks;
  }
  const sessions = Array.isArray(athlete?.sessions) ? athlete.sessions : [];
  const normalize = typeof helpers.normalizeModality === 'function'
    ? helpers.normalizeModality
    : (value) => value;
  const runningId = helpers.runningModalityId || 'running';
  return sessions
    .filter((session) =>
      session?.status === 'logged'
      && /benchmark/i.test(String(session.type || ''))
      && normalize(session.modality) === runningId
      && Number(session.distance) > 0
    )
    .map((session) => ({
      weekIndex: session.weekIndex,
      distance: Number(session.distance),
      avgBpm: Number(session.avgBpm),
      targetBPM: Number(session.targetBPM) || BENCHMARK_TARGET_BPM,
    }));
}

export function statusToTone(status) {
  if (status === STATUS_IMPROVING || status === STATUS_ON_TARGET) return 'green';
  if (status === STATUS_DECLINING || status === STATUS_NEEDS_ATTENTION) return 'red';
  if (status === STATUS_BASELINE || status === STATUS_WATCH) return 'amber';
  return 'neutral';
}

/**
 * Coach-facing copy for partial source outages. Never silently treat an
 * outage as athlete "No Data" without this banner on analysis pages.
 */
/**
 * Structured source availability for fail-closed coach decisions.
 * Warnings alone are not enough — unavailable sources must not invent athlete states.
 */
export function buildCoachSourceAvailability(sourceErrors = {}, sources = null) {
  const keys = [
    'profiles',
    'hrRows',
    'completions',
    'sprints',
    'mileTests',
    'notes',
    'identities',
    'exclusions',
    'meta',
    'attachments',
  ];
  const availability = {};
  keys.forEach((key) => {
    if (sources && typeof sources === 'object' && key in sources) {
      availability[key] = Boolean(sources[key]);
    } else {
      availability[key] = !(sourceErrors && sourceErrors[key]);
    }
  });
  return availability;
}

export function formatCoachSourceWarnings(sourceErrors = {}) {
  const entries = sourceErrors && typeof sourceErrors === 'object'
    ? Object.entries(sourceErrors)
    : [];
  return entries.map(([key, message]) => {
    const lower = `${key} ${message || ''}`.toLowerCase();
    if (lower.includes('sprint')) {
      return 'Sprint data is temporarily unavailable. Recovery metrics are marked data unavailable — not athlete no data.';
    }
    if (lower.includes('mile')) {
      return 'Mile test data is temporarily unavailable. Mile Test metrics are marked data unavailable.';
    }
    if (lower.includes('hr') && !lower.includes('adherence')) {
      return 'HR data is temporarily unavailable. Zone adherence metrics may be incomplete.';
    }
    if (lower.includes('completion')) {
      return 'Completion data is temporarily unavailable. Missing / Behind / schedule adherence are not classified from this outage.';
    }
    if (lower.includes('identit')) {
      return 'Roster identity data is temporarily unavailable. Athlete roster is withheld until identities can be verified.';
    }
    if (lower.includes('exclusion')) {
      return 'Roster exclusion data is temporarily unavailable. Athlete roster is withheld until exclusions can be verified.';
    }
    if (lower.includes('note')) {
      return 'Coach notes are temporarily unavailable.';
    }
    return String(message || `${key} unavailable`);
  }).filter(Boolean);
}

function formatClockFromSeconds(totalSeconds) {
  const total = Math.round(Number(totalSeconds) || 0);
  if (!(total > 0)) return '--';
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSignedNumber(value, digits = 0, suffix = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}${suffix}`;
}

function isMileTestSession(session) {
  const text = String(session?.type || '').toLowerCase();
  return /\bmile\b/.test(text) && /\b(test|re-?test|time trial)\b/.test(text);
}

function mileSecondsFromSession(session) {
  const explicit = Number(session?.timeSec ?? session?.time_sec ?? session?.seconds);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const minutes = Number(session?.minutes);
  if (Number.isFinite(minutes) && minutes > 0 && minutes < 20) return minutes * 60;
  return null;
}

function mileSecondsFromCloudRow(row = {}) {
  const explicit = Number(row.total_seconds ?? row.totalSeconds ?? row.timeSec ?? row.seconds);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const minutes = Number(row.total_minutes ?? row.totalMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
  const result = row.result_json && typeof row.result_json === 'object' ? row.result_json : {};
  const fromResult = Number(result.totalSeconds ?? result.timeSec ?? result.seconds);
  if (Number.isFinite(fromResult) && fromResult > 0) return fromResult;
  const resultMinutes = Number(result.totalMinutes ?? result.minutes);
  if (Number.isFinite(resultMinutes) && resultMinutes > 0) return resultMinutes * 60;
  return null;
}

/**
 * Normalize raw Supabase mile_tests rows (including mile-test:baseline)
 * into the coach analytics history shape. Prefer this over reconstructing
 * mile history only from weekly program sessions.
 */
export function normalizeMileTestCloudRows(rows = []) {
  return (rows || []).map((row) => {
    const testKey = String(row.test_key || row.testKey || '').trim();
    const ctx = (row.test_context_json && typeof row.test_context_json === 'object')
      ? row.test_context_json
      : ((row.testContextJson && typeof row.testContextJson === 'object') ? row.testContextJson : {});
    let weekIndex = Number(ctx.weekIndex);
    let workoutIndex = Number(ctx.workoutIndex);
    if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) {
      const match = testKey.match(/^program:\d+:(\d+):(\d+)$/);
      if (match) {
        weekIndex = Number(match[1]);
        workoutIndex = Number(match[2]);
      }
    }
    const seconds = mileSecondsFromCloudRow(row);
    const avgBpm = Number(row.avg_bpm ?? row.avgBpm);
    const maxBpm = Number(row.max_bpm ?? row.maxBpm);
    const savedAt = row.saved_at || row.savedAt || row.updated_at || row.updatedAt || null;
    const isBaseline = testKey === MILE_TEST_BASELINE_KEY || ctx.isBaseline === true;
    return {
      testKey,
      savedAt,
      weekIndex: Number.isFinite(weekIndex) ? weekIndex : null,
      workoutIndex: Number.isFinite(workoutIndex) ? workoutIndex : null,
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      timeSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      avgBpm: Number.isFinite(avgBpm) && avgBpm > 0 ? avgBpm : null,
      maxBpm: Number.isFinite(maxBpm) && maxBpm > 0 ? maxBpm : null,
      distance: Number(row.distance) || null,
      isBaseline,
      label: isBaseline ? 'Baseline' : (Number.isFinite(weekIndex) ? `W${weekIndex + 1}` : (testKey || 'Mile Test')),
    };
  }).filter((row) => Number.isFinite(row.seconds) && row.seconds > 0);
}

function sortMileTestHistory(rows) {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.savedAt || '') || null;
    const bTime = Date.parse(b.savedAt || '') || null;
    if (aTime != null && bTime != null && aTime !== bTime) return aTime - bTime;
    if (a.isBaseline !== b.isBaseline) return a.isBaseline ? -1 : 1;
    const aWeek = Number.isFinite(a.weekIndex) ? a.weekIndex : Number.POSITIVE_INFINITY;
    const bWeek = Number.isFinite(b.weekIndex) ? b.weekIndex : Number.POSITIVE_INFINITY;
    if (aWeek !== bWeek) return aWeek - bWeek;
    return String(a.testKey || '').localeCompare(String(b.testKey || ''));
  });
}

function collectMileTestRows(athlete) {
  const fromConfig = (athlete?.mileTests || []).map((row) => {
    // Already-normalized cloud rows or mock { weekIndex, timeSec }
    if (row && (row.testKey || row.isBaseline || row.avgBpm != null || row.maxBpm != null || row.savedAt)) {
      const seconds = Number(row.seconds ?? row.timeSec);
      return {
        testKey: row.testKey || '',
        savedAt: row.savedAt || null,
        weekIndex: Number.isFinite(Number(row.weekIndex)) ? Number(row.weekIndex) : null,
        workoutIndex: Number.isFinite(Number(row.workoutIndex)) ? Number(row.workoutIndex) : null,
        seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
        timeSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
        avgBpm: Number.isFinite(Number(row.avgBpm)) ? Number(row.avgBpm) : null,
        maxBpm: Number.isFinite(Number(row.maxBpm)) ? Number(row.maxBpm) : null,
        distance: Number(row.distance) || null,
        isBaseline: Boolean(row.isBaseline) || row.testKey === MILE_TEST_BASELINE_KEY,
        label: row.label || null,
      };
    }
    const seconds = Number(row?.timeSec ?? row?.seconds);
    return {
      testKey: '',
      savedAt: null,
      weekIndex: Number(row?.weekIndex),
      workoutIndex: null,
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      timeSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      avgBpm: Number.isFinite(Number(row?.avgBpm)) ? Number(row.avgBpm) : null,
      maxBpm: Number.isFinite(Number(row?.maxBpm)) ? Number(row.maxBpm) : null,
      distance: Number(row?.distance) || null,
      isBaseline: Number(row?.weekIndex) === 0,
      label: row?.label || null,
    };
  }).filter((row) => Number.isFinite(row.seconds) && row.seconds > 0);

  if (fromConfig.length) return sortMileTestHistory(fromConfig);

  return sortMileTestHistory(
    (athlete?.sessions || [])
      .filter((session) => session.status === 'logged' && isMileTestSession(session))
      .map((session) => ({
        testKey: '',
        savedAt: session.completedAt || session.savedAt || null,
        weekIndex: Number(session.weekIndex),
        workoutIndex: Number(session.workoutIndex),
        seconds: mileSecondsFromSession(session),
        timeSec: mileSecondsFromSession(session),
        avgBpm: Number.isFinite(Number(session.avgBpm)) ? Number(session.avgBpm) : null,
        maxBpm: Number.isFinite(Number(session.maxBpm)) ? Number(session.maxBpm) : null,
        distance: Number(session.distance) || null,
        isBaseline: Number(session.weekIndex) === 0,
        label: session.type || 'Mile Test',
      }))
      .filter((row) => Number.isFinite(row.seconds) && row.seconds > 0)
  );
}

function pickMileBaseline(rows) {
  if (!rows.length) return null;
  return rows.find((row) => row.isBaseline) || rows[0];
}

function pickMileLatest(rows) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const baseline = pickMileBaseline(rows);
  const nonBaseline = rows.filter((row) => row !== baseline);
  return nonBaseline.length ? nonBaseline[nonBaseline.length - 1] : rows[rows.length - 1];
}

function buildWeeklyHrTrend(athlete, helpers = {}) {
  const sessions = Array.isArray(athlete?.sessions) ? athlete.sessions : [];
  const byWeek = new Map();
  sessions.forEach((session) => {
    if (session.status !== 'logged') return;
    if (/sprint|mile/i.test(String(session.type || ''))) return;
    const weekIndex = Number(session.weekIndex);
    if (!Number.isFinite(weekIndex)) return;
    const workout = helpers.workoutLookup?.(session) || null;
    const zoneTarget = helpers.getSessionZoneTarget?.(session, workout, {
      maxHr: athlete.maxHr,
      restingHr: athlete.restingHr,
    });
    if (!zoneTarget) return;
    if (!byWeek.has(weekIndex)) byWeek.set(weekIndex, { scored: 0, onTarget: 0 });
    const bucket = byWeek.get(weekIndex);
    bucket.scored += 1;
    if (helpers.isSessionAvgOnTarget?.(session.avgBpm, zoneTarget)) bucket.onTarget += 1;
  });

  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekIndex, stats]) => {
      const pct = stats.scored > 0 ? Math.round((100 * stats.onTarget) / stats.scored) : null;
      return {
        weekIndex,
        scored: stats.scored,
        onTarget: stats.onTarget,
        pct,
        value: pct,
      };
    });
}

function buildZoneHeatmap(athlete, helpers = {}) {
  return (athlete?.sessions || [])
    .filter((session) => session.status === 'logged')
    .filter((session) => !/sprint|mile/i.test(String(session.type || '')))
    .map((session) => {
      const workout = helpers.workoutLookup?.(session) || null;
      const zoneTarget = helpers.getSessionZoneTarget?.(session, workout, {
        maxHr: athlete.maxHr,
        restingHr: athlete.restingHr,
      });
      if (!zoneTarget) return null;
      const onTarget = Boolean(helpers.isSessionAvgOnTarget?.(session.avgBpm, zoneTarget));
      return {
        weekIndex: Number(session.weekIndex),
        workoutIndex: Number(session.workoutIndex),
        day: session.day || '',
        type: session.type || '',
        avgBpm: Number(session.avgBpm) || null,
        onTarget,
        status: onTarget ? STATUS_ON_TARGET : STATUS_NEEDS_ATTENTION,
        label: `W${Number(session.weekIndex) + 1}${session.day ? ` ${session.day}` : ''}`,
      };
    })
    .filter(Boolean);
}

/**
 * HR vs pace observations over time (Sheets decision framing).
 * Does NOT invent a paceSec/BPM "efficiency score".
 * When a prior session sits in a similar HR band (±5 bpm), attach a pace comparison.
 */
function buildHrPaceEfficiency(athlete, helpers = {}) {
  const normalize = helpers.normalizeModality || ((value) => value);
  const runningId = helpers.runningModalityId;
  const observations = (athlete?.sessions || [])
    .filter((session) => session.status === 'logged')
    .filter((session) => !runningId || normalize(session.modality) === runningId)
    .map((session) => {
      const minutes = Number(session.minutes);
      const distance = Number(session.distance);
      const avgBpm = Number(session.avgBpm);
      if (!(minutes > 0) || !(distance > 0) || !(avgBpm > 0)) return null;
      const paceSec = (minutes * 60) / distance;
      return {
        weekIndex: Number(session.weekIndex),
        workoutIndex: Number(session.workoutIndex),
        day: session.day || '',
        type: session.type || '',
        avgBpm,
        paceSec,
        paceLabel: formatClockFromSeconds(paceSec) === '--' ? '--' : `${formatClockFromSeconds(paceSec)}/mi`,
        label: `W${Number(session.weekIndex) + 1}${session.day ? ` ${session.day}` : ''}`,
      };
    })
    .filter(Boolean);

  return observations.map((row, index) => {
    const prior = [...observations.slice(0, index)]
      .reverse()
      .find((candidate) => Math.abs(candidate.avgBpm - row.avgBpm) <= 5);
    if (!prior) {
      return {
        ...row,
        similarHrComparison: null,
        comparisonLabel: 'No similar-HR prior yet',
      };
    }
    const paceDeltaSec = Number((row.paceSec - prior.paceSec).toFixed(1));
    let interpretation = 'similar';
    if (paceDeltaSec < -2) interpretation = 'faster-at-similar-hr';
    else if (paceDeltaSec > 2) interpretation = 'slower-at-similar-hr';
    return {
      ...row,
      similarHrComparison: {
        vsLabel: prior.label,
        vsAvgBpm: prior.avgBpm,
        paceDeltaSec,
        interpretation,
      },
      comparisonLabel: interpretation === 'faster-at-similar-hr'
        ? `Faster vs ${prior.label} at similar HR`
        : interpretation === 'slower-at-similar-hr'
          ? `Slower vs ${prior.label} at similar HR`
          : `Similar pace vs ${prior.label} at similar HR`,
    };
  });
}

function unavailableMetric(detail) {
  return {
    value: null,
    displayValue: '--',
    delta: null,
    detail,
    status: STATUS_UNAVAILABLE,
    badge: statusBadgeLabel(STATUS_UNAVAILABLE),
    tone: statusToTone(STATUS_UNAVAILABLE),
    hasData: false,
    trendPoints: [],
    unavailable: true,
  };
}

export function buildCoachAthleteAnalytics(athlete, helpers = {}) {
  const performanceIndex = Number(athlete?.performance?.index ?? athlete?.scan?.performance?.index);
  const performanceClassified = classifyPerformanceIndex(performanceIndex);
  const performanceTrend = (athlete?.scan?.performance?.points || athlete?.performance?.points || [])
    .map((row) => ({
      weekIndex: row.weekIndex,
      value: Number(row.pct ?? row.index),
    }))
    .filter((row) => Number.isFinite(row.value));

  const recoveryPoints = (athlete?.scan?.recovery?.points || [])
    .map((row) => ({
      weekIndex: row.weekIndex,
      value: Number(row.first5Avg ?? row.value),
    }))
    .filter((row) => Number.isFinite(row.value));
  const recoveryLatest = Number.isFinite(Number(athlete?.scan?.recovery?.latest))
    ? Number(athlete.scan.recovery.latest)
    : (recoveryPoints.length ? recoveryPoints[recoveryPoints.length - 1].value : null);
  const recoveryBaseline = Number.isFinite(Number(athlete?.scan?.recovery?.first))
    ? Number(athlete.scan.recovery.first)
    : (recoveryPoints.length ? recoveryPoints[0].value : null);
  const recoveryCampAverage = Number.isFinite(Number(athlete?.scan?.recovery?.avg))
    ? Number(athlete.scan.recovery.avg)
    : (recoveryPoints.length
      ? recoveryPoints.reduce((sum, row) => sum + row.value, 0) / recoveryPoints.length
      : null);
  const recoveryClassified = classifyRecovery(
    recoveryLatest,
    recoveryBaseline,
    recoveryPoints.length || (Number.isFinite(recoveryLatest) ? 1 : 0)
  );

  const paceLatestPct = Number(athlete?.scan?.pace?.latestPct);
  const pacePoints = (athlete?.scan?.pace?.points || [])
    .map((row) => ({
      weekIndex: row.weekIndex,
      value: Number(row.pct ?? row.value),
    }))
    .filter((row) => Number.isFinite(row.value));
  const paceClassified = classifyPace(paceLatestPct, pacePoints.length >= 2 && Number.isFinite(paceLatestPct));

  const zoneSignal = athlete?.scan?.zone || {};
  let hrOnTarget = Number(zoneSignal.onTarget);
  let hrScored = Number(zoneSignal.scored);
  if ((!Number.isFinite(hrScored) || hrScored <= 0) && typeof helpers.scoreZoneAdherence === 'function') {
    const scored = helpers.scoreZoneAdherence(
      athlete?.sessions || [],
      (session) => helpers.workoutLookup?.(session) || null,
      { maxHr: athlete?.maxHr, restingHr: athlete?.restingHr }
    );
    hrOnTarget = Number(scored?.onTarget);
    hrScored = Number(scored?.scored);
  }
  const hrClassified = classifyHrAdherence(hrOnTarget, hrScored);
  const hrTrend = buildWeeklyHrTrend(athlete, helpers);

  const sources = athlete?.sources || helpers.sources || buildCoachSourceAvailability(athlete?.sourceErrors || {});
  const sprintsAvailable = sources.sprints !== false;
  const mileTestsAvailable = sources.mileTests !== false;
  const completionsAvailable = sources.completions !== false;

  const benchmarkMetric = buildBenchmarkMetricFromPoints(
    resolveBenchmarkPoints(athlete, helpers),
    {
      unavailable: !completionsAvailable,
      unavailableDetail: 'Completion source unavailable — Benchmark Index not classified',
    }
  );

  const mileRows = mileTestsAvailable ? collectMileTestRows(athlete) : [];
  const mileBaselineRow = pickMileBaseline(mileRows);
  const mileLatestRow = pickMileLatest(mileRows);
  const mileBaseline = mileBaselineRow?.seconds ?? null;
  const mileLatest = mileLatestRow?.seconds ?? null;
  const mileDelta = Number.isFinite(mileLatest) && Number.isFinite(mileBaseline)
    ? Number((mileLatest - mileBaseline).toFixed(1))
    : null;
  const mileStatus = !mileTestsAvailable
    ? STATUS_UNAVAILABLE
    : Number.isFinite(mileDelta)
      ? (mileDelta < -0.4 ? STATUS_IMPROVING : mileDelta > 0.4 ? STATUS_DECLINING : STATUS_BASELINE)
      : (Number.isFinite(mileLatest) ? STATUS_BASELINE : STATUS_NO_DATA);

  const baselineAvgBpm = mileBaselineRow?.avgBpm ?? null;
  const latestAvgBpm = mileLatestRow?.avgBpm ?? null;
  const baselineMaxBpm = mileBaselineRow?.maxBpm ?? null;
  const latestMaxBpm = mileLatestRow?.maxBpm ?? null;
  const avgBpmDelta = Number.isFinite(latestAvgBpm) && Number.isFinite(baselineAvgBpm)
    ? latestAvgBpm - baselineAvgBpm
    : null;
  const maxBpmDelta = Number.isFinite(latestMaxBpm) && Number.isFinite(baselineMaxBpm)
    ? latestMaxBpm - baselineMaxBpm
    : null;

  const profileMaxHr = Number(athlete?.maxHr);
  const zoneHeatmap = completionsAvailable ? buildZoneHeatmap(athlete, helpers) : [];
  const hrPaceEfficiency = completionsAvailable ? buildHrPaceEfficiency(athlete, helpers) : [];

  return {
    athleteId: athlete?.id || null,
    athleteName: athlete?.name || 'Athlete',
    performance: completionsAvailable
      ? {
        value: performanceClassified.hasData ? performanceIndex : null,
        displayValue: performanceClassified.hasData ? formatPi(performanceIndex) : '--',
        delta: performanceClassified.delta,
        detail: performanceClassified.hasData
          ? `W1 100 → ${formatPi(performanceIndex)}`
          : (athlete?.scan?.performance?.detail || 'No Performance Index yet'),
        status: performanceClassified.status,
        badge: statusBadgeLabel(performanceClassified.status),
        tone: statusToTone(performanceClassified.status),
        hasData: performanceClassified.hasData,
        trendPoints: performanceTrend,
        unavailable: false,
      }
      : {
        ...unavailableMetric('Completion source unavailable — Performance Index not classified'),
        trendPoints: [],
        unavailable: true,
      },
    benchmark: benchmarkMetric,
    recovery: sprintsAvailable
      ? {
        latest: recoveryLatest,
        baseline: recoveryBaseline,
        campAverage: recoveryCampAverage,
        value: recoveryClassified.hasData ? recoveryLatest : null,
        displayValue: recoveryClassified.hasData && Number.isFinite(recoveryLatest)
          ? String(Math.round(recoveryLatest))
          : '--',
        delta: recoveryClassified.delta,
        detail: recoveryClassified.hasData
          ? `Latest First-5 Drop: ${Math.round(recoveryLatest)} BPM`
          : (athlete?.scan?.recovery?.detail || 'No sprint yet'),
        campAverageLabel: Number.isFinite(recoveryCampAverage)
          ? `Camp Avg: ${Math.round(recoveryCampAverage)} BPM`
          : null,
        status: recoveryClassified.status,
        badge: statusBadgeLabel(recoveryClassified.status),
        tone: statusToTone(recoveryClassified.status),
        hasData: recoveryClassified.hasData,
        trendPoints: recoveryPoints,
        unavailable: false,
      }
      : {
        ...unavailableMetric('Sprint source unavailable — recovery not classified'),
        latest: null,
        baseline: null,
        campAverage: null,
        campAverageLabel: null,
        unavailable: true,
      },
    pace: completionsAvailable
      ? {
      value: paceClassified.hasData ? paceLatestPct : null,
      displayValue: paceClassified.hasData ? formatSignedPct(paceLatestPct, 1) : '--',
      delta: paceClassified.delta,
      detail: paceClassified.hasData
        ? (athlete?.scan?.pace?.detail || 'Running pace vs first week')
        : (athlete?.scan?.pace?.detail || 'Need two running weeks'),
      status: paceClassified.status,
      badge: statusBadgeLabel(paceClassified.status),
      tone: statusToTone(paceClassified.status),
      hasData: paceClassified.hasData,
      trendPoints: pacePoints,
    
        unavailable: false,
      }
      : {
        ...unavailableMetric('Completion source unavailable — pace not classified'),
        trendPoints: [],
        unavailable: true,
      },
    hrAdherence: completionsAvailable
      ? {
      pct: hrClassified.pct,
      scored: hrClassified.scored ?? 0,
      onTarget: hrClassified.onTarget ?? 0,
      value: hrClassified.hasData ? hrClassified.pct : null,
      displayValue: hrClassified.hasData ? `${hrClassified.pct}%` : '--',
      detail: hrClassified.hasData
        ? `${hrClassified.onTarget}/${hrClassified.scored} within target HR band`
        : (athlete?.scan?.zone?.detail || 'No HR vs target yet'),
      status: hrClassified.status,
      badge: statusBadgeLabel(hrClassified.status),
      tone: statusToTone(hrClassified.status),
      hasData: hrClassified.hasData,
      trendPoints: hrTrend,
    
        unavailable: false,
      }
      : {
        ...unavailableMetric('Completion source unavailable — HR adherence not classified'),
        pct: null,
        scored: 0,
        onTarget: 0,
        trendPoints: [],
        unavailable: true,
      },
    mileTest: {
      baseline: mileBaseline,
      latest: mileLatest,
      baselineDisplay: formatClockFromSeconds(mileBaseline),
      latestDisplay: formatClockFromSeconds(mileLatest),
      delta: mileDelta,
      deltaDisplay: formatSignedNumber(mileDelta, 0, 's'),
      baselineAvgBpm,
      latestAvgBpm,
      avgBpmDelta,
      avgBpmDeltaDisplay: formatSignedNumber(avgBpmDelta, 0, ' bpm'),
      baselineMaxBpm,
      latestMaxBpm,
      maxBpmDelta,
      maxBpmDeltaDisplay: formatSignedNumber(maxBpmDelta, 0, ' bpm'),
      status: mileStatus,
      badge: statusBadgeLabel(mileStatus),
      tone: statusToTone(mileStatus),
      hasData: mileTestsAvailable && Number.isFinite(mileLatest),
      unavailable: !mileTestsAvailable,
      history: mileRows,
      // Mile Test Max HR comes from the all-out test rows — not profile Max HR.
      maxHr: Number.isFinite(latestMaxBpm) ? latestMaxBpm : (Number.isFinite(baselineMaxBpm) ? baselineMaxBpm : null),
      maxHrDisplay: Number.isFinite(latestMaxBpm)
        ? `${Math.round(latestMaxBpm)} BPM`
        : (Number.isFinite(baselineMaxBpm) ? `${Math.round(baselineMaxBpm)} BPM` : '--'),
      profileMaxHr: Number.isFinite(profileMaxHr) ? profileMaxHr : null,
      profileMaxHrDisplay: Number.isFinite(profileMaxHr) ? `${Math.round(profileMaxHr)} BPM` : '--',
    },
    sources,
    completionsAvailable,
    zoneHeatmap,
    hrPaceEfficiency,
  };
}

function cardFromAnalyticsMetric(base, metric, {
  valueLabel,
  value,
  deltaLabel,
  detail,
  sortValue,
  trendPoints,
  extra = {},
}) {
  return {
    ...base,
    status: metric?.status || STATUS_NO_DATA,
    hasData: Boolean(metric?.hasData),
    sortValue: sortValue ?? null,
    delta: metric?.delta ?? null,
    value: value ?? '--',
    valueLabel,
    deltaLabel: deltaLabel || '',
    detail: detail || '',
    trendPoints: Array.isArray(trendPoints) ? trendPoints : [],
    badge: metric?.badge || statusBadgeLabel(metric?.status || STATUS_NO_DATA),
    ...extra,
  };
}

/**
 * Build one lens card from an athlete that already has scan/performance
 * from buildAthleteRecord (canonical pipeline). Prefers athlete.analytics
 * when present so aggregate pages cannot diverge from Detailed Summary.
 */
export function buildLensCard(athlete, lens) {
  const userId = String(athlete?.id || '');
  const athleteName = String(athlete?.name || 'Athlete');
  const weekLabel = `Week ${(athlete?.currentWeekIndex ?? 0) + 1}`;
  const base = {
    userId,
    athleteName,
    weekLabel,
    lens,
    trendPoints: [],
  };
  const analytics = athlete?.analytics || null;

  if (lens === LENS_BENCHMARK) {
    if (analytics?.benchmark) {
      const metric = analytics.benchmark;
      return cardFromAnalyticsMetric(base, metric, {
        valueLabel: 'PERFORMANCE INDEX',
        value: metric.displayValue,
        deltaLabel: metric.hasData ? formatSignedPct(metric.delta) : '',
        detail: metric.detail,
        sortValue: metric.hasData ? metric.value : null,
        trendPoints: metric.trendPoints,
        extra: {
          delta: metric.delta,
          baselineEquivalentDistance: metric.baselineEquivalentDistance,
          latestEquivalentDistance: metric.latestEquivalentDistance,
        },
      });
    }
    const points = resolveBenchmarkPoints(athlete);
    const metric = buildBenchmarkMetricFromPoints(points);
    return cardFromAnalyticsMetric(base, metric, {
      valueLabel: 'PERFORMANCE INDEX',
      value: metric.displayValue,
      deltaLabel: metric.hasData ? formatSignedPct(metric.delta) : '',
      detail: metric.detail,
      sortValue: metric.hasData ? metric.value : null,
      trendPoints: metric.trendPoints,
      extra: {
        delta: metric.delta,
        baselineEquivalentDistance: metric.baselineEquivalentDistance,
        latestEquivalentDistance: metric.latestEquivalentDistance,
      },
    });
  }

  if (lens === LENS_RECOVERY) {
    if (analytics?.recovery) {
      const metric = analytics.recovery;
      return cardFromAnalyticsMetric(base, metric, {
        valueLabel: 'SPRINT RECOVERY',
        value: metric.displayValue,
        deltaLabel: metric.hasData && metric.status !== STATUS_NO_DATA
          ? `${Number(metric.delta) >= 0 ? '+' : ''}${Math.round(Number(metric.delta))} BPM vs baseline`
          : '',
        detail: metric.detail,
        sortValue: metric.hasData ? metric.delta : null,
        trendPoints: metric.trendPoints,
        extra: {
          latest: metric.latest,
          baseline: metric.baseline,
          delta: metric.delta,
        },
      });
    }
    const signal = athlete?.scan?.recovery || {};
    const points = (signal.points || [])
      .map((row) => ({
        weekIndex: row.weekIndex,
        value: Number(row.first5Avg),
      }))
      .filter((row) => Number.isFinite(row.value));
    const classified = classifyRecovery(signal.latest, signal.first, points.length || signal.points?.length || 0);
    return {
      ...base,
      ...classified,
      value: classified.hasData && Number.isFinite(classified.latest)
        ? String(Math.round(classified.latest))
        : '--',
      valueLabel: 'SPRINT RECOVERY',
      deltaLabel: classified.hasData && classified.status !== STATUS_NO_DATA
        ? `${classified.delta >= 0 ? '+' : ''}${Math.round(classified.delta)} BPM vs baseline`
        : '',
      detail: classified.hasData
        ? `Latest First-5 Drop: ${Math.round(classified.latest)} BPM`
        : (signal.detail || 'No sprint yet'),
      trendPoints: points,
      badge: statusBadgeLabel(classified.status),
    };
  }

  if (lens === LENS_PACE) {
    if (analytics?.pace) {
      const metric = analytics.pace;
      return cardFromAnalyticsMetric(base, metric, {
        valueLabel: 'OVERALL PACE TREND',
        value: metric.displayValue,
        deltaLabel: metric.hasData ? formatSignedPct(metric.delta, 1) : '',
        detail: metric.detail,
        sortValue: metric.hasData ? metric.value : null,
        trendPoints: metric.trendPoints,
        extra: { delta: metric.delta },
      });
    }
    const signal = athlete?.scan?.pace || {};
    const hasComparable = Array.isArray(signal.points) && signal.points.length >= 2
      && Number.isFinite(signal.latestPct);
    const classified = classifyPace(signal.latestPct, hasComparable);
    const points = (signal.points || [])
      .map((row) => ({
        weekIndex: row.weekIndex,
        value: Number(row.pct),
      }))
      .filter((row) => Number.isFinite(row.value));
    return {
      ...base,
      ...classified,
      value: classified.hasData ? formatSignedPct(signal.latestPct, 1) : '--',
      valueLabel: 'OVERALL PACE TREND',
      deltaLabel: classified.hasData ? formatSignedPct(signal.latestPct, 1) : '',
      detail: classified.hasData
        ? (signal.detail || 'Running pace vs first week')
        : (signal.detail || 'Need two running weeks'),
      trendPoints: points,
      badge: statusBadgeLabel(classified.status),
    };
  }

  if (lens === LENS_HR_ADHERENCE) {
    if (analytics?.hrAdherence) {
      const metric = analytics.hrAdherence;
      return cardFromAnalyticsMetric(base, metric, {
        valueLabel: 'HR ADHERENCE',
        value: metric.displayValue,
        deltaLabel: metric.hasData
          ? `${metric.onTarget} / ${metric.scored} eligible sessions within target range`
          : '',
        detail: metric.detail,
        sortValue: metric.hasData ? metric.pct : null,
        trendPoints: metric.trendPoints,
        extra: {
          pct: metric.pct,
          onTarget: metric.onTarget,
          scored: metric.scored,
        },
      });
    }
    const signal = athlete?.scan?.zone || {};
    const classified = classifyHrAdherence(signal.onTarget, signal.scored);
    return {
      ...base,
      ...classified,
      value: classified.hasData ? `${classified.pct}%` : '--',
      valueLabel: 'HR ADHERENCE',
      deltaLabel: classified.hasData
        ? `${classified.onTarget} / ${classified.scored} eligible sessions within target range`
        : '',
      detail: classified.hasData
        ? `${classified.onTarget}/${classified.scored} within target HR band`
        : (signal.detail || 'No HR vs target yet'),
      trendPoints: [],
      badge: statusBadgeLabel(classified.status),
    };
  }

  return {
    ...base,
    status: STATUS_NO_DATA,
    hasData: false,
    sortValue: null,
    value: '--',
    valueLabel: 'METRIC',
    deltaLabel: '',
    detail: 'Unknown lens',
    badge: statusBadgeLabel(STATUS_NO_DATA),
  };
}

export function buildLensCards(athletes, lens) {
  const seen = new Set();
  const cards = [];
  (athletes || []).forEach((athlete) => {
    const id = String(athlete?.id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    cards.push(buildLensCard(athlete, lens));
  });
  return cards;
}

export function selectVisibleCards(cards, { filter = 'all', query = '', sort = 'desc' } = {}) {
  const filtered = cards.filter((card) => cardMatchesFilter(card, filter) && cardMatchesSearch(card, query));
  return sortMetricCards(filtered, sort);
}

/**
 * Running-only camp totals for Detailed Summary field parity.
 */
export function computeRunningTotals(sessions, normalizeModality, runningId) {
  let minutes = 0;
  let miles = 0;
  (sessions || []).forEach((session) => {
    if (session.status !== 'logged') return;
    if (normalizeModality(session.modality) !== runningId) return;
    const mins = Number(session.minutes);
    const dist = Number(session.distance);
    if (Number.isFinite(mins) && mins > 0) minutes += mins;
    if (Number.isFinite(dist) && dist > 0) miles += dist;
  });
  return {
    runningHours: minutes / 60,
    runningMiles: miles,
    runningMinutes: minutes,
  };
}
