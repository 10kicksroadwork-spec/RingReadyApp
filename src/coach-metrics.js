/**
 * Canonical coach analytics lenses — shared by Detailed Summary and
 * aggregate metric pages. Same athlete + same scan data must yield the
 * same value/status everywhere (see docs/COACH_DECISION_DASHBOARD_SPEC.md).
 */

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

/**
 * Build one lens card from an athlete that already has scan/performance
 * from buildAthleteRecord (canonical pipeline).
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

  if (lens === LENS_BENCHMARK) {
    const index = Number(athlete?.scan?.performance?.index ?? athlete?.performance?.index);
    const classified = classifyPerformanceIndex(index);
    const points = (athlete?.scan?.performance?.points || athlete?.performance?.points || [])
      .map((row) => ({
        weekIndex: row.weekIndex,
        value: Number(row.pct ?? row.index),
      }))
      .filter((row) => Number.isFinite(row.value));
    return {
      ...base,
      ...classified,
      value: classified.hasData ? formatPi(index) : '--',
      valueLabel: 'PERFORMANCE INDEX',
      deltaLabel: classified.hasData ? formatSignedPct(classified.delta) : '',
      detail: classified.hasData
        ? `W1 100 → ${formatPi(index)}`
        : (athlete?.scan?.performance?.detail || 'No Performance Index yet'),
      trendPoints: points,
      badge: statusBadgeLabel(classified.status),
    };
  }

  if (lens === LENS_RECOVERY) {
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
