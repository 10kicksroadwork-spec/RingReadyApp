import { PROGRAM } from './program.js';
import {
  formatCampStartLabel,
  inferCampWeekIndex,
  isSessionDueYet,
} from './coach-camp-schedule.js';
import { buildCoachUserIdSet, buildRosterExclusionSet, isCoachEmail, isLocalCoachPreviewHost as isLocalHost, isRosterExcludedEmail, normalizeUserId } from './coach-access.js';
import {
  archiveAndResetCamp,
  getCurrentUser,
  isCoachUser,
  loadCoachRosterPayload,
  saveCoachCampStartDate,
  saveCoachNote,
} from './auth.js';
import {
  buildPerformanceContinuity,
  formatModalityLabel,
  formatPerformanceIndex,
  MODALITY_RUNNING,
  normalizeModality,
  readOutputFromWorkoutLog,
} from './modality.js';
import { scoreZoneAdherence } from './hr-analytics.js';

const NOTES_KEY = 'ringReadyCoachPreviewNotes';
const COACH_SCREENS = new Set(['coach-dashboard', 'coach-athlete']);
const SPRINT_TARGET_DROP = 30;
const EQUIV_RATIO_MIN = 0.85;
const EQUIV_RATIO_MAX = 1.15;
const EQUIV_K = 0.5;
const BENCHMARK_TARGET_BPM = 137;
const PACE_FLAT_PCT = 0.8;
const PACE_BUCKET_LABEL = {
  zone2: 'Z2',
  tempo: 'Tempo',
  threshold: 'Th',
  fightPace: 'FP',
};

let coachHooks = null;
let selectedAthleteId = '';
let athleteDrill = '';
let rosterFilter = 'all';
let rosterQuery = '';
let bound = false;

let liveAthletes = null;
let liveLoadError = '';
let liveLoadState = 'idle';
let rosterSource = 'mock';
let rosterSourceWarnings = [];

export function isLocalCoachPreviewHost() {
  return isLocalHost();
}

export function canAccessCoachScreens() {
  return isCoachUser() || isLocalCoachPreviewHost();
}

export function isCoachScreen(screenId) {
  return COACH_SCREENS.has(String(screenId || ''));
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(value, fallback = '--') {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : fallback;
}

function formatDecimal(value, digits = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : '--';
}

function formatSignedPct(pct) {
  if (!Number.isFinite(pct)) return '--';
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(0)}%`;
}

function clampNumber(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function isSprintType(type) {
  return /\bsprint\b/i.test(String(type || ''));
}

function isBenchmarkType(type) {
  return /benchmark/i.test(String(type || ''));
}

function isMileTestType(type) {
  const text = String(type || '').toLowerCase();
  return /\bmile\b/.test(text) && /\b(test|re-?test|time trial)\b/.test(text);
}

function campWeeks(campLength) {
  return PROGRAM.slice(0, campLength === 4 ? 4 : PROGRAM.length);
}

function sessionKey(weekIndex, workoutIndex) {
  return `${weekIndex}:${workoutIndex}`;
}

/**
 * HR-adjusted equivalent distance for a 30-min benchmark.
 */
function getEquivDistance(distance, avgBpm, targetBpm) {
  const dist = Number(distance);
  if (!Number.isFinite(dist) || dist <= 0) return null;
  const avg = Number(avgBpm);
  const tgt = Number(targetBpm) || BENCHMARK_TARGET_BPM;
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(tgt) || tgt <= 0) return dist;
  const ratio = clampNumber(tgt / avg, EQUIV_RATIO_MIN, EQUIV_RATIO_MAX);
  const equiv = dist * (ratio ** EQUIV_K);
  return Number.isFinite(equiv) && equiv > 0 ? equiv : dist;
}

function emptySignal(label, detail = 'No data yet') {
  return {
    key: label,
    tone: 'neutral',
    value: '--',
    short: '--',
    detail,
    points: [],
  };
}

function paceBucket(type) {
  const text = String(type || '').toLowerCase();
  if (isSprintType(text) || isMileTestType(text)) return null;
  if (/shadow|fight-day|fight day|warm-up|warmup/.test(text)) return null;
  if (/fight-pace|fight pace/.test(text)) return 'fightPace';
  if (/threshold/.test(text)) return 'threshold';
  if (/tempo/.test(text)) return 'tempo';
  if (/benchmark|easy|long|shake/.test(text)) return 'zone2';
  return null;
}

function defaultSessionMinutes(session) {
  const existing = Number(session.minutes);
  if (Number.isFinite(existing) && existing > 0) return existing;
  const text = String(session.type || '').toLowerCase();
  const week = session.weekIndex || 0;
  if (text.includes('benchmark')) return 30;
  if (text.includes('threshold')) return [16, 22, 28, 20, 34][week] || 22;
  if (text.includes('tempo')) return 20;
  if (/fight-pace|fight pace/.test(text)) return 11;
  if (text.includes('long')) return [45, 50, 60, 45, 45][week] || 45;
  if (text.includes('easy') || text.includes('shake')) return week === 2 ? 30 : 20;
  return null;
}

/**
 * Benchmark % vs Week 1. Amber if still above baseline but down from last week.
 */
function buildBenchSignal(points) {
  if (!points.length) return emptySignal('bench', 'No benchmark yet');
  const baseline = points[0].equiv;
  const weekly = points.map((row) => ({
    ...row,
    pct: baseline > 0 ? ((row.equiv - baseline) / baseline) * 100 : 0,
  }));
  const latest = weekly[weekly.length - 1];
  const prior = weekly.length >= 2 ? weekly[weekly.length - 2] : null;
  const avgPct = weekly.reduce((sum, row) => sum + row.pct, 0) / weekly.length;

  if (weekly.length < 2) {
    return {
      key: 'bench',
      tone: 'neutral',
      value: formatDecimal(latest.equiv),
      short: '--',
      detail: 'Week 1 sets the baseline',
      points: weekly,
      lastAvg: latest.avgBpm,
      latestPct: 0,
      avgPct: 0,
    };
  }

  let tone = 'green';
  if (latest.pct < 0) tone = 'red';
  else if (prior && latest.pct + 0.4 < prior.pct) tone = 'amber';

  return {
    key: 'bench',
    tone,
    value: formatSignedPct(latest.pct),
    short: formatSignedPct(latest.pct),
    detail: `Avg ${formatSignedPct(avgPct)} vs W1 · ${formatDecimal(baseline)} → ${formatDecimal(latest.equiv)} mi`,
    points: weekly,
    lastAvg: latest.avgBpm,
    latestPct: latest.pct,
    avgPct,
  };
}

function buildZoneSignal(sessions, maxHr = null, restingHr = null) {
  const hrInfo = { maxHr: maxHr || 0, restingHr: restingHr || 0 };
  const workoutLookup = (session) => {
    const week = PROGRAM[session.weekIndex];
    return week?.workouts?.[session.workoutIndex] || null;
  };
  const { scored, onTarget } = scoreZoneAdherence(sessions, workoutLookup, hrInfo);
  if (!scored) return emptySignal('zone', 'No HR vs target yet');
  const pct = Math.round((onTarget / scored) * 100);
  let tone = 'red';
  if (pct >= 80) tone = 'green';
  else if (pct >= 60) tone = 'amber';
  return {
    key: 'zone',
    tone,
    value: `${pct}%`,
    short: `${pct}%`,
    detail: `${onTarget}/${scored} runs within target HR band`,
    points: [],
    pct,
    scored,
    onTarget,
  };
}

function buildRecoverySignal(points) {
  if (!points.length) return emptySignal('recovery', 'No sprint yet');
  const latest = points[points.length - 1].first5Avg;
  const first = points[0].first5Avg;
  const avg = points.reduce((sum, row) => sum + row.first5Avg, 0) / points.length;
  if (points.length < 2) {
    return {
      key: 'recovery',
      tone: 'neutral',
      value: `${Math.round(avg)}`,
      short: `${Math.round(latest)}`,
      detail: `Need another sprint week · target ${SPRINT_TARGET_DROP}+`,
      points,
      latest,
      first,
      avg,
    };
  }
  const down = latest < first - 0.4;
  const up = latest > first + 0.4;
  let tone = 'amber';
  if (down) tone = 'red';
  else if (up) tone = 'green';
  return {
    key: 'recovery',
    tone,
    value: `${Math.round(avg)}`,
    short: `${Math.round(latest)}`,
    detail: `${Math.round(first)} → ${Math.round(latest)} bpm drop vs W1`,
    points,
    latest,
    first,
    avg,
  };
}

function collectBenchmarkPoints(config, sessions) {
  if (Array.isArray(config.benchmarks) && config.benchmarks.length) {
    return config.benchmarks.map((row) => {
      const distance = Number(row.distance);
      const avgBpm = Number(row.avgBpm);
      const targetBPM = Number(row.targetBPM) || BENCHMARK_TARGET_BPM;
      return {
        weekIndex: row.weekIndex,
        distance,
        avgBpm,
        targetBPM,
        equiv: getEquivDistance(distance, avgBpm, targetBPM),
      };
    }).filter((row) => Number.isFinite(row.equiv));
  }
  return sessions
    .filter((session) =>
      session.status === 'logged'
      && isBenchmarkType(session.type)
      && normalizeModality(session.modality) === MODALITY_RUNNING
      && Number(session.distance) > 0
    )
    .map((session) => ({
      weekIndex: session.weekIndex,
      distance: Number(session.distance),
      avgBpm: Number(session.avgBpm),
      targetBPM: Number(session.targetBPM) || BENCHMARK_TARGET_BPM,
      equiv: getEquivDistance(session.distance, session.avgBpm, session.targetBPM || BENCHMARK_TARGET_BPM),
    }))
    .filter((row) => Number.isFinite(row.equiv));
}

function hasSprintDrop(value) {
  if (value == null || value === '') return false;
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function collectSprintPoints(config, sessions) {
  if (Array.isArray(config.sprints) && config.sprints.length) {
    return config.sprints
      .map((row) => ({ weekIndex: row.weekIndex, first5Avg: Number(row.first5Avg) }))
      .filter((row) => hasSprintDrop(row.first5Avg));
  }
  const fromSessions = sessions
    .filter((session) => session.status === 'logged' && isSprintType(session.type) && hasSprintDrop(session.drop))
    .map((session) => ({ weekIndex: session.weekIndex, first5Avg: Number(session.drop) }));
  if (fromSessions.length) return fromSessions;
  if (hasSprintDrop(config.sprintDrop)) {
    return [{ weekIndex: config.currentWeekIndex, first5Avg: Number(config.sprintDrop) }];
  }
  return [];
}

function collectPaceBuckets(sessions) {
  const buckets = { zone2: {}, tempo: {}, threshold: {}, fightPace: {} };
  sessions.forEach((session) => {
    if (session.status !== 'logged') return;
    const bucket = paceBucket(session.type);
    if (!bucket) return;
    const minutes = Number(session.minutes);
    const distance = Number(session.distance);
    if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(distance) || distance <= 0) return;
    const week = buckets[bucket][session.weekIndex] || { minutes: 0, distance: 0 };
    week.minutes += minutes;
    week.distance += distance;
    buckets[bucket][session.weekIndex] = week;
  });
  return buckets;
}

/**
 * Each zone has its own Week-1 (or first logged) baseline. Faster = positive.
 * Those bucket trends are averaged into one camp grade.
 */
function buildPaceSignal(sessions) {
  const buckets = collectPaceBuckets(sessions);
  const bucketTrends = [];
  Object.entries(buckets).forEach(([key, byWeek]) => {
    const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return;
    const baselinePace = byWeek[weeks[0]].minutes / byWeek[weeks[0]].distance;
    if (!Number.isFinite(baselinePace) || baselinePace <= 0) return;
    const weekly = weeks.map((weekIndex) => {
      const pace = byWeek[weekIndex].minutes / byWeek[weekIndex].distance;
      const pct = ((baselinePace - pace) / baselinePace) * 100;
      return { weekIndex, pace, pct };
    });
    bucketTrends.push({
      key,
      label: PACE_BUCKET_LABEL[key] || key,
      baselinePace,
      weekly,
      latestPct: weekly[weekly.length - 1].pct,
    });
  });

  const weekSet = new Set();
  bucketTrends.forEach((trend) => {
    trend.weekly.forEach((row) => weekSet.add(row.weekIndex));
  });
  const collective = [...weekSet].sort((a, b) => a - b).map((weekIndex) => {
    const pcts = [];
    bucketTrends.forEach((trend) => {
      if (trend.weekly.length < 2) return;
      const row = trend.weekly.find((item) => item.weekIndex === weekIndex);
      if (row) pcts.push(row.pct);
    });
    if (!pcts.length) return null;
    const pct = pcts.reduce((sum, value) => sum + value, 0) / pcts.length;
    return { weekIndex, pct };
  }).filter(Boolean);

  const graded = bucketTrends.filter((trend) => trend.weekly.length >= 2);
  if (!graded.length || collective.length < 2) {
    return {
      ...emptySignal('pace', 'Need two weeks in the same zone'),
      buckets: bucketTrends,
    };
  }

  const latest = collective[collective.length - 1];
  let tone = 'amber';
  if (latest.pct > PACE_FLAT_PCT) tone = 'green';
  else if (latest.pct < -PACE_FLAT_PCT) tone = 'red';

  const breakdown = graded
    .map((trend) => `${trend.label} ${formatSignedPct(trend.latestPct)}`)
    .join(' · ');

  return {
    key: 'pace',
    tone,
    value: formatSignedPct(latest.pct),
    short: formatSignedPct(latest.pct),
    detail: breakdown || 'Zone-relative vs first week',
    points: collective,
    buckets: bucketTrends,
    latestPct: latest.pct,
  };
}

function buildPerformanceSignal(performance) {
  if (!performance?.index) {
    return emptySignal('performance', 'Needs HR-valid cardio sessions');
  }
  const index = Number(performance.index);
  let tone = 'amber';
  if (index >= 100) tone = 'green';
  else if (index < 95) tone = 'red';
  const modalityLabel = performance.latestModality
    ? formatModalityLabel(performance.latestModality)
    : 'camp';
  const switchNote = performance.modalityCount > 1
    ? ` · ${performance.modalityCount} modalities, score kept continuous`
    : '';
  return {
    key: 'performance',
    tone,
    value: formatPerformanceIndex(index),
    short: formatPerformanceIndex(index),
    detail: `Camp index on ${modalityLabel}${switchNote}`,
    points: (performance.points || []).map((row) => ({
      weekIndex: row.weekIndex,
      pct: row.index,
    })),
    index,
  };
}

function hasEasyHotFlag(config) {
  return Object.values(config.flags || {}).some((flag) => /easy/i.test(String(flag)));
}

function buildHeadline(athlete) {
  const bits = [];
  const { scan, tone, missingCount, currentWeekIndex, proofGaps } = athlete;

  if (tone === 'behind' && currentWeekIndex === 0) {
    bits.push(`Week 1. ${missingCount} session${missingCount === 1 ? '' : 's'} missing.`);
  } else if (tone === 'behind') {
    bits.push(`Behind. ${missingCount} missing.`);
  } else if (tone === 'watch') {
    bits.push('Watch HR.');
    if (hasEasyHotFlag(athlete)) bits.push('Easy days running hot.');
  } else if (tone === 'proof') {
    bits.push(`${proofGaps} proof gap${proofGaps === 1 ? '' : 's'}.`);
  } else {
    bits.push('On track.');
  }

  if (tone === 'behind' && scan.recovery.tone === 'neutral' && !scan.recovery.points?.length) {
    bits.push('No sprint yet.');
  } else if (scan.zone.tone === 'red') {
    bits.push(`Zone ${scan.zone.value}.`);
  } else if (scan.bench.tone === 'red' || scan.bench.tone === 'amber') {
    bits.push(`Bench ${scan.bench.short} vs W1.`);
  } else if (scan.recovery.tone === 'red') {
    bits.push(`Drop ${Math.round(scan.recovery.latest)} bpm vs W1.`);
  } else if (scan.bench.tone === 'green') {
    bits.push(`Bench ${scan.bench.short} vs W1.`);
    if (scan.recovery.tone === 'green') bits.push(`Drop ${Math.round(scan.recovery.first)}→${Math.round(scan.recovery.latest)}.`);
    else if (scan.pace.tone === 'green') bits.push('Pace up.');
  } else if (scan.pace.tone === 'green') {
    bits.push('Pace up.');
  } else if (scan.recovery.tone === 'green') {
    bits.push(`Drop ${Math.round(scan.recovery.first)}→${Math.round(scan.recovery.latest)}.`);
  }
  if (scan.performance?.index && athlete.performance?.modalityCount > 1) {
    bits.push(`Index ${formatPerformanceIndex(scan.performance.index)} after modality switch.`);
  } else if (scan.performance?.index && !bits.some((bit) => /Index /.test(bit))) {
    bits.push(`Index ${formatPerformanceIndex(scan.performance.index)}.`);
  }

  return bits.join(' ');
}

function applyPaceWeeks(session, config) {
  const next = { ...session };
  if (normalizeModality(next.modality) !== MODALITY_RUNNING) return next;
  const bucket = paceBucket(session.type);
  if (!bucket || session.status !== 'logged') return next;
  const series = config.paceWeeks?.[bucket];
  const pace = Number(Array.isArray(series) ? series[session.weekIndex] : series?.[session.weekIndex]);
  if (!Number.isFinite(pace) || pace <= 0) return next;
  const minutes = defaultSessionMinutes(next);
  if (!minutes) return next;
  if (next.minutes == null) next.minutes = minutes;
  if (next.distance == null) next.distance = minutes / pace;
  return next;
}

function overlaySeriesOntoSession(session, config) {
  let next = { ...session };
  if (isBenchmarkType(session.type)) {
    const point = (config.benchmarks || []).find((row) => row.weekIndex === session.weekIndex);
    if (point) {
      if (next.distance == null) next.distance = point.distance;
      if (next.avgBpm == null) next.avgBpm = point.avgBpm;
      if (next.minutes == null) next.minutes = 30;
    }
  }
  if (isSprintType(session.type)) {
    const point = (config.sprints || []).find((row) => row.weekIndex === session.weekIndex);
    if (point && next.drop == null) next.drop = point.first5Avg;
  }
  return applyPaceWeeks(next, config);
}

function buildAthleteRecord(config) {
  const weeks = campWeeks(config.campLength);
  const missing = new Set(config.missing || []);
  const skipped = new Set(config.skipped || []);
  const missingProofs = new Set(config.missingProofs || []);
  const flags = config.flags || {};
  const notes = config.sessionNotes || {};
  let logged = 0;
  let due = 0;
  let proofGaps = 0;
  let watchCount = 0;
  const weekRows = [];
  const sessions = [];

  weeks.forEach((week, weekIndex) => {
    let done = 0;
    const weekSessions =     week.workouts.map((workout, workoutIndex) => {
      const key = sessionKey(weekIndex, workoutIndex);
      const isFutureWeek = weekIndex > config.currentWeekIndex;
      const isBeforeStart = config.campStartDate
        ? !isSessionDueYet(config.campStartDate, weekIndex, workout.day)
        : false;
      const isFuture = isFutureWeek || isBeforeStart;
      const isSkipped = !isFuture && skipped.has(key);
      const isMissing = !isFuture && !isSkipped && missing.has(key);
      const status = isFuture ? 'upcoming' : isSkipped ? 'skipped' : isMissing ? 'missing' : 'logged';
      const proof = isFuture || isSkipped
        ? (isFuture ? 'upcoming' : 'none')
        : missingProofs.has(key)
          ? 'missing'
          : status === 'logged'
            ? 'on-file'
            : 'none';
      const flag = flags[key] || '';
      if (!isFuture) due += 1;
      if (status === 'logged' || status === 'skipped') {
        logged += 1;
        done += 1;
      }
      if (proof === 'missing') proofGaps += 1;
      if (flag) watchCount += 1;
      const session = overlaySeriesOntoSession({
        key,
        weekIndex,
        workoutIndex,
        weekLabel: week.label,
        weekTitle: week.title,
        day: workout.day,
        type: workout.type,
        targetZone: workout.targetZone || '',
        targetBPM: workout.targetBPM ?? null,
        status,
        proof,
        flag,
        note: notes[key] || '',
        avgBpm: config.avgs?.[key] ?? null,
        maxBpm: config.maxes?.[key] ?? null,
        minutes: config.minutes?.[key] ?? null,
        distance: config.distances?.[key] ?? null,
        drop: config.drops?.[key] ?? null,
        modality: normalizeModality(config.modalities?.[key] || MODALITY_RUNNING),
        avgWatts: config.watts?.[key] ?? null,
        outputValue: config.outputValues?.[key] ?? null,
      }, config);
      const override = config.sessionOverrides?.[key];
      if (override) Object.assign(session, override);
      if (session.outputValue == null) {
        session.outputValue = session.avgWatts ?? session.distance ?? null;
      }
      sessions.push(session);
      return session;
    });
    weekRows.push({
      label: week.label,
      title: week.title,
      done,
      total: week.workouts.length,
      pct: week.workouts.length ? Math.round((done / week.workouts.length) * 100) : 0,
      sessions: weekSessions,
    });
  });

  const attention = [];
  if (due - logged > 0) attention.push(`${due - logged} session${due - logged === 1 ? '' : 's'} missing`);
  if (proofGaps > 0) attention.push(`${proofGaps} proof gap${proofGaps === 1 ? '' : 's'}`);
  if (watchCount > 0) attention.push(`${watchCount} HR flag${watchCount === 1 ? '' : 's'}`);
  const skippedCount = sessions.filter((session) => session.status === 'skipped').length;
  if (skippedCount > 0) attention.push(`${skippedCount} skipped`);

  let tone = 'on-track';
  if (due - logged > 0) tone = 'behind';
  else if (watchCount > 0) tone = 'watch';
  else if (proofGaps > 0) tone = 'proof';

  const benchPoints = collectBenchmarkPoints(config, sessions);
  const sprintPoints = collectSprintPoints(config, sessions);
  const performance = buildPerformanceContinuity(sessions);
  const scan = {
    bench: buildBenchSignal(benchPoints),
    zone: buildZoneSignal(sessions, config.maxHr, config.restingHr),
    recovery: buildRecoverySignal(sprintPoints),
    pace: buildPaceSignal(sessions),
    performance: buildPerformanceSignal(performance),
  };

  const athlete = {
    ...config,
    completionPct: due ? Math.round((logged / due) * 100) : 0,
    logged,
    due,
    missingCount: Math.max(0, due - logged),
    skippedCount,
    proofGaps,
    watchCount,
    attention,
    tone,
    weekRows,
    sessions,
    scan,
    performance,
  };
  athlete.headline = buildHeadline(athlete);
  return athlete;
}

const MOCK_ATHLETES = [
  buildAthleteRecord({
    id: 'alex',
    name: 'Alex Rivera',
    campLength: 7,
    currentWeekIndex: 4,
    campStartDate: '2026-07-27',
    fightDate: '2026-09-14',
    tenure: '1-3 years',
    maxHr: 186,
    restingHr: 54,
    lastSession: 'Tue · Benchmark (Assault Bike)',
    missing: [],
    missingProofs: [],
    sessionNotes: {
      '3:1': 'Ankle flare-up. Coach approved Assault Bike for cardio.',
      '4:1': 'Second week on bike. Watts climbing, index still continuous.',
    },
    benchmarks: [
      { weekIndex: 0, distance: 2.85, avgBpm: 137 },
      { weekIndex: 1, distance: 2.98, avgBpm: 136 },
      { weekIndex: 2, distance: 3.10, avgBpm: 137 },
    ],
    sprints: [
      { weekIndex: 0, first5Avg: 31 },
      { weekIndex: 1, first5Avg: 33 },
      { weekIndex: 2, first5Avg: 34 },
    ],
    paceWeeks: {
      zone2: [9.1, 8.85, 8.6],
      threshold: [7.15, 7.0, 6.9],
    },
    modalities: {
      '0:0': 'running', '0:1': 'running', '0:2': 'running', '0:3': 'running', '0:4': 'running',
      '1:0': 'running', '1:1': 'running', '1:2': 'running', '1:3': 'running', '1:4': 'running',
      '2:0': 'running', '2:1': 'running', '2:2': 'running', '2:3': 'running', '2:4': 'running',
      '3:0': 'running', '3:1': 'assault_bike', '3:2': 'assault_bike', '3:3': 'assault_bike', '3:4': 'assault_bike',
      '4:0': 'running', '4:1': 'assault_bike', '4:2': 'assault_bike', '4:3': 'assault_bike', '4:4': 'assault_bike',
    },
    minutes: {
      '0:1': 30, '0:2': 16, '0:3': 20, '0:4': 45,
      '1:1': 30, '1:2': 22, '1:3': 20, '1:4': 50,
      '2:1': 30, '2:2': 28, '2:3': 30, '2:4': 60,
      '3:1': 30, '3:2': 20, '3:3': 20, '3:4': 45,
      '4:1': 30, '4:2': 20, '4:3': 20, '4:4': 45,
    },
    distances: {
      '0:1': 2.85, '0:3': 2.20, '0:4': 4.90,
      '1:1': 2.98, '1:3': 2.28, '1:4': 5.55,
      '2:1': 3.10, '2:3': 3.45, '2:4': 6.80,
    },
    watts: {
      '3:1': 179, '3:2': 210, '3:3': 185, '3:4': 168,
      '4:1': 191, '4:2': 218, '4:3': 190, '4:4': 176,
    },
    avgs: {
      '0:1': 137, '0:2': 163, '0:3': 138, '0:4': 139,
      '1:1': 136, '1:2': 164, '1:3': 137, '1:4': 138,
      '2:1': 137, '2:2': 163, '2:3': 138, '2:4': 137,
      '3:1': 137, '3:2': 164, '3:3': 138, '3:4': 136,
      '4:1': 136, '4:2': 163, '4:3': 137, '4:4': 135,
    },
  }),
  buildAthleteRecord({
    id: 'maya',
    name: 'Maya Chen',
    campLength: 7,
    currentWeekIndex: 2,
    fightDate: '2026-10-04',
    tenure: '3-5 years',
    maxHr: 188,
    restingHr: 52,
    lastSession: 'Today · Threshold',
    missing: [],
    missingProofs: [],
    benchmarks: [
      { weekIndex: 0, distance: 2.82, avgBpm: 136 },
      { weekIndex: 1, distance: 2.96, avgBpm: 137 },
      { weekIndex: 2, distance: 3.14, avgBpm: 135 },
    ],
    sprints: [
      { weekIndex: 0, first5Avg: 33 },
      { weekIndex: 1, first5Avg: 35 },
      { weekIndex: 2, first5Avg: 38 },
    ],
    paceWeeks: {
      zone2: [9.0, 8.75, 8.5],
      threshold: [7.1, 6.95, 6.8],
    },
    avgs: {
      '0:2': 161, '0:3': 135, '0:4': 138,
      '1:2': 164, '1:3': 136, '1:4': 139,
      '2:2': 164, '2:3': 137, '2:4': 138,
    },
    maxes: { '2:2': 171 },
    minutes: { '2:2': 16 },
  }),
  buildAthleteRecord({
    id: 'jordan',
    name: 'Jordan Hale',
    campLength: 7,
    currentWeekIndex: 1,
    fightDate: '2026-09-19',
    tenure: '1-3 years',
    maxHr: 181,
    restingHr: 58,
    lastSession: 'Mon · Sprints',
    missing: ['0:4', '1:3'],
    skipped: ['0:3'],
    missingProofs: ['1:0'],
    sessionNotes: {
      '0:3': 'Travel day. Gene approved the skip.',
    },
    benchmarks: [
      { weekIndex: 0, distance: 2.70, avgBpm: 140 },
      { weekIndex: 1, distance: 2.68, avgBpm: 141 },
    ],
    sprints: [
      { weekIndex: 0, first5Avg: 24 },
      { weekIndex: 1, first5Avg: 24 },
    ],
    paceWeeks: {
      threshold: [7.2, 7.28],
    },
    avgs: {
      '0:2': 158,
      '1:2': 160,
    },
  }),
  buildAthleteRecord({
    id: 'sam',
    name: 'Sam Ortiz',
    campLength: 7,
    currentWeekIndex: 4,
    fightDate: '2026-10-18',
    tenure: '5+ years',
    maxHr: 176,
    restingHr: 49,
    lastSession: 'Tue · Benchmark',
    missing: [],
    missingProofs: [],
    flags: {
      '3:3': 'Easy-day HR sat in Tempo',
      '4:1': 'Benchmark avg 154 · Zone 2 is 106–123',
    },
    benchmarks: [
      { weekIndex: 0, distance: 3.20, avgBpm: 138 },
      { weekIndex: 1, distance: 3.28, avgBpm: 140 },
      { weekIndex: 2, distance: 3.35, avgBpm: 144 },
      { weekIndex: 3, distance: 3.42, avgBpm: 148 },
      { weekIndex: 4, distance: 3.40, avgBpm: 154 },
    ],
    sprints: [
      { weekIndex: 0, first5Avg: 38 },
      { weekIndex: 2, first5Avg: 40 },
      { weekIndex: 4, first5Avg: 41 },
    ],
    paceWeeks: {
      zone2: [8.9, 8.6, 8.4, 8.2, 8.0],
      threshold: [7.0, 6.95, 6.9, null, 6.85],
      tempo: { 3: 7.4 },
      fightPace: { 4: 6.4 },
    },
    avgs: {
      '0:2': 162, '0:3': 148, '0:4': 146,
      '1:2': 163, '1:3': 150, '1:4': 147,
      '2:2': 164, '2:3': 149, '2:4': 145,
      '3:2': 160, '3:3': 148,
      '4:1': 154, '4:2': 164, '4:4': 170,
    },
    minutes: { '4:1': 30, '3:3': 15 },
  }),
  buildAthleteRecord({
    id: 'riley',
    name: 'Riley Brooks',
    campLength: 7,
    currentWeekIndex: 0,
    fightDate: '2026-11-08',
    tenure: '6-12 months',
    maxHr: 192,
    restingHr: 61,
    lastSession: 'Sat · Mile Test',
    missing: ['0:1', '0:2', '0:3', '0:4'],
    missingProofs: [],
    benchmarks: [],
    sprints: [],
  }),
  buildAthleteRecord({
    id: 'avery',
    name: 'Avery Kim',
    campLength: 4,
    currentWeekIndex: 3,
    fightDate: '2026-09-06',
    tenure: '3-5 years',
    maxHr: 184,
    restingHr: 50,
    lastSession: 'Sun · Long Run',
    missing: [],
    missingProofs: [],
    benchmarks: [
      { weekIndex: 0, distance: 2.90, avgBpm: 136 },
      { weekIndex: 1, distance: 3.02, avgBpm: 137 },
      { weekIndex: 2, distance: 3.11, avgBpm: 136 },
      { weekIndex: 3, distance: 3.22, avgBpm: 135 },
    ],
    sprints: [
      { weekIndex: 0, first5Avg: 32 },
      { weekIndex: 1, first5Avg: 34 },
      { weekIndex: 2, first5Avg: 35 },
      { weekIndex: 3, first5Avg: 36 },
    ],
    paceWeeks: {
      zone2: [9.0, 8.8, 8.65, 8.5],
      threshold: [7.05, 6.95, 6.85],
      tempo: { 3: 7.5 },
    },
    avgs: {
      '0:2': 162, '0:3': 136, '0:4': 138,
      '1:2': 164, '1:3': 137, '1:4': 139,
      '2:2': 163, '2:3': 136, '2:4': 138,
      '3:2': 154, '3:3': 135, '3:4': 137,
    },
  }),
];

function inferCurrentWeekIndex(fightDate, campLength, completionWeeks, campStartDate) {
  const fromStart = inferCampWeekIndex(campStartDate, campLength);
  if (fromStart !== null) return fromStart;
  const lastWeek = (campLength === 4 ? 4 : 7) - 1;
  if (fightDate) {
    const fight = new Date(`${fightDate}T12:00:00`);
    if (!Number.isNaN(fight.getTime())) {
      const start = new Date(fight);
      start.setDate(start.getDate() - (lastWeek + 1) * 7);
      const idx = Math.floor((Date.now() - start.getTime()) / (7 * 86400000));
      return clampNumber(idx, 0, lastWeek);
    }
  }
  if (completionWeeks.length) return clampNumber(Math.max(...completionWeeks), 0, lastWeek);
  return 0;
}

function completionKeyFromRow(row) {
  if (row.completion_key) return String(row.completion_key);
  if (Number.isFinite(Number(row.week_index)) && Number.isFinite(Number(row.workout_index))) {
    return `${Number(row.week_index)}:${Number(row.workout_index)}`;
  }
  return '';
}

function mileTestKeyFromRow(row) {
  const ctx = row.test_context_json && typeof row.test_context_json === 'object' ? row.test_context_json : {};
  if (Number.isFinite(Number(ctx.weekIndex)) && Number.isFinite(Number(ctx.workoutIndex))) {
    return sessionKey(Number(ctx.weekIndex), Number(ctx.workoutIndex));
  }
  const match = String(row.test_key || '').match(/^program:\d+:(\d+):(\d+)$/);
  if (match) return sessionKey(Number(match[1]), Number(match[2]));
  return '';
}

function synthesizeCompletionFromMileTest(mileRow, workout) {
  const ctx = mileRow.test_context_json && typeof mileRow.test_context_json === 'object' ? mileRow.test_context_json : {};
  let weekIndex = Number(ctx.weekIndex);
  let workoutIndex = Number(ctx.workoutIndex);
  if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) {
    const match = String(mileRow.test_key || '').match(/^program:\d+:(\d+):(\d+)$/);
    if (match) {
      weekIndex = Number(match[1]);
      workoutIndex = Number(match[2]);
    }
  }
  return {
    completion_key: sessionKey(weekIndex, workoutIndex),
    week_index: weekIndex,
    workout_index: workoutIndex,
    workout_type: ctx.workoutType || workout.type,
    avg_bpm: mileRow.avg_bpm,
    max_bpm: mileRow.max_bpm,
    total_minutes: mileRow.total_minutes,
    distance: mileRow.distance,
    attachment_id: mileRow.attachment_id || null,
    completed_at: mileRow.saved_at || mileRow.updated_at,
    updated_at: mileRow.updated_at || mileRow.saved_at,
    record_json: mileRow.result_json && typeof mileRow.result_json === 'object' ? mileRow.result_json : {},
  };
}

function sprintDropFromRow(row) {
  const json = row.session_json && typeof row.session_json === 'object' ? row.session_json : {};
  const data = Array.isArray(json.data) ? json.data : [];
  const drops = data
    .map((rep) => Number(rep.drop ?? rep.bpmDrop ?? rep.hrDrop))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (drops.length) {
    const firstN = drops.slice(0, Math.min(5, drops.length));
    return firstN.reduce((sum, value) => sum + value, 0) / firstN.length;
  }
  const avg = Number(row.avg_drop ?? json.avgDrop);
  return Number.isFinite(avg) && avg > 0 ? avg : null;
}

function sprintContextFromRow(row) {
  const json = row.session_json && typeof row.session_json === 'object' ? row.session_json : {};
  return json.cfg?.workoutContext || json.workoutContext || {};
}

function sessionKeyFromSprintRow(row) {
  let weekIndex = Number(row.week_index);
  let workoutIndex = Number(row.workout_index);
  const context = sprintContextFromRow(row);
  if (!Number.isFinite(weekIndex)) weekIndex = Number(context.weekIndex);
  if (!Number.isFinite(workoutIndex)) workoutIndex = Number(context.workoutIndex);
  if (!Number.isFinite(weekIndex)) return '';
  if (!Number.isFinite(workoutIndex)) workoutIndex = 0;
  return sessionKey(weekIndex, workoutIndex);
}

function synthesizeCompletionFromSprint(sprintRow, workout) {
  const json = sprintRow.session_json && typeof sprintRow.session_json === 'object' ? sprintRow.session_json : {};
  const context = sprintContextFromRow(sprintRow);
  const weekIndex = Number.isFinite(Number(sprintRow.week_index))
    ? Number(sprintRow.week_index)
    : Number(context.weekIndex);
  const workoutIndex = Number.isFinite(Number(sprintRow.workout_index))
    ? Number(sprintRow.workout_index)
    : (Number.isFinite(Number(context.workoutIndex)) ? Number(context.workoutIndex) : 0);

  return {
    completion_key: sessionKeyFromSprintRow(sprintRow),
    week_index: weekIndex,
    workout_index: workoutIndex,
    workout_type: sprintRow.workout_type || workout.type,
    target_bpm: Number(sprintRow.target_bpm || context.targetBPM || workout.targetBPM),
    max_bpm: Number(sprintRow.peak_hr) || null,
    attachment_id: sprintRow.attachment_id || null,
    completed_at: sprintRow.session_at || sprintRow.updated_at,
    updated_at: sprintRow.updated_at || sprintRow.session_at,
    record_json: json,
  };
}

function formatLastSession(completions, sprints = []) {
  const dated = [
    ...completions.map((row) => ({
      at: new Date(row.completed_at || row.updated_at || 0).getTime(),
      type: row.workout_type || 'Session',
    })),
    ...sprints.map((row) => ({
      at: new Date(row.session_at || row.updated_at || 0).getTime(),
      type: row.workout_type || 'Sprint Intervals',
    })),
  ]
    .filter((row) => Number.isFinite(row.at) && row.at > 0)
    .sort((a, b) => b.at - a.at);
  if (!dated.length) return 'No sessions yet';
  const latest = dated[0];
  const day = new Date(latest.at).toLocaleDateString('en-US', { weekday: 'short' });
  return `${day} · ${latest.type}`;
}

function isSkippedCloudCompletion(row, record = {}) {
  const log = record.workoutLog || {};
  return row?.status === 'skipped'
    || record.status === 'skipped'
    || record.type === 'daily-workout-skip'
    || log.status === 'skipped';
}

function liveAthleteConfig(profile, hrRow, completions, sprints, mileTests, note, email = '', campStartDate = '') {
  const campLength = Number(profile.camp_length) === 4 ? 4 : 7;
  const weeks = campWeeks(campLength);
  const byKey = new Map();
  completions.forEach((row) => {
    const key = completionKeyFromRow(row);
    if (key) byKey.set(key, row);
  });
  const mileTestByKey = new Map();
  (mileTests || []).forEach((row) => {
    const key = mileTestKeyFromRow(row);
    if (key) mileTestByKey.set(key, row);
  });
  const sprintsByKey = new Map();
  sprints.forEach((row) => {
    const key = sessionKeyFromSprintRow(row);
    if (key) sprintsByKey.set(key, row);
  });
  const currentWeekIndex = inferCurrentWeekIndex(
    profile.fight_date,
    campLength,
    completions.map((row) => Number(row.week_index)).filter(Number.isFinite),
    campStartDate
  );
  const missing = [];
  const skipped = [];
  const missingProofs = [];
  const flags = {};
  const avgs = {};
  const maxes = {};
  const minutes = {};
  const distances = {};
  const watts = {};
  const modalities = {};
  const drops = {};
  const sessionNotes = {};
  const sprintPoints = [];

  weeks.forEach((week, weekIndex) => {
    week.workouts.forEach((workout, workoutIndex) => {
      const key = sessionKey(weekIndex, workoutIndex);
      if (weekIndex > currentWeekIndex) return;
      if (campStartDate && !isSessionDueYet(campStartDate, weekIndex, workout.day)) return;
      let row = byKey.get(key);
      const sprintRow = sprintsByKey.get(key);
      if (!row && isSprintType(workout.type) && sprintRow) {
        row = synthesizeCompletionFromSprint(sprintRow, workout);
      }
      if (!row && isMileTestType(workout.type)) {
        const mileRow = mileTestByKey.get(key);
        if (mileRow) row = synthesizeCompletionFromMileTest(mileRow, workout);
      }
      if (!row) {
        missing.push(key);
        return;
      }
      const record = row.record_json && typeof row.record_json === 'object' ? row.record_json : {};
      if (isSkippedCloudCompletion(row, record)) {
        skipped.push(key);
        const log = record.workoutLog || {};
        const skipNote = String(log.skipDetail || log.note || record.note || '').trim();
        const reason = String(log.skipReasonLabel || log.skipReason || '').trim();
        sessionNotes[key] = skipNote || (reason ? `Skipped · ${reason}` : 'Coach-approved skip.');
        return;
      }
      if (!row.attachment_id && !sprintRow?.attachment_id) missingProofs.push(key);
      const log = record.workoutLog || {};
      const output = readOutputFromWorkoutLog({
        modality: log.modality,
        outputType: log.outputType,
        outputValue: log.outputValue,
        distance: log.distance ?? row.distance,
        avgWatts: log.avgWatts,
      });
      modalities[key] = output.modality;
      if (output.outputType === 'watts' && Number.isFinite(output.outputValue)) watts[key] = output.outputValue;
      const avg = Number(row.avg_bpm);
      const tgt = Number(row.target_bpm || workout.targetBPM);
      if (Number.isFinite(avg) && avg > 0) avgs[key] = avg;
      if (Number.isFinite(Number(row.max_bpm)) && Number(row.max_bpm) > 0) maxes[key] = Number(row.max_bpm);
      if (Number.isFinite(Number(row.total_minutes)) && Number(row.total_minutes) > 0) minutes[key] = Number(row.total_minutes);
      if (output.outputType === 'distance' && Number.isFinite(output.outputValue) && output.outputValue > 0) {
        distances[key] = output.outputValue;
      } else if (Number.isFinite(Number(row.distance)) && Number(row.distance) > 0) {
        distances[key] = Number(row.distance);
      }
      if (Number.isFinite(avg) && Number.isFinite(tgt) && tgt > 0 && avg > tgt + 10 && !isSprintType(workout.type)) {
        flags[key] = `${workout.type} avg ${Math.round(avg)} · target ${Math.round(tgt)}`;
      }
    });
  });

  sprints.forEach((row) => {
    const drop = sprintDropFromRow(row);
    const key = sessionKeyFromSprintRow(row);
    if (!Number.isFinite(drop) || !key) return;
    const weekIndex = Number(key.split(':')[0]);
    if (!Number.isFinite(weekIndex)) return;
    sprintPoints.push({ weekIndex, first5Avg: drop });
    drops[key] = drop;
  });

  return {
    id: profile.user_id,
    name: profile.athlete_name || email || 'Profile incomplete',
    email,
    campLength,
    currentWeekIndex,
    fightDate: profile.fight_date || '--',
    campStartDate,
    tenure: profile.training_tenure || '',
    maxHr: hrRow?.max_hr ?? null,
    restingHr: hrRow?.resting_hr ?? null,
    lastSession: formatLastSession(completions, sprints),
    missing,
    skipped,
    missingProofs,
    flags,
    avgs,
    maxes,
    minutes,
    distances,
    watts,
    modalities,
    drops,
    sessionNotes,
    sprints: sprintPoints,
    coachNote: note || '',
  };
}

function buildLiveRoster(payload) {
  const hrByUser = new Map((payload.hrRows || []).map((row) => [row.user_id, row]));
  const completionsByUser = new Map();
  (payload.completions || []).forEach((row) => {
    const list = completionsByUser.get(row.user_id) || [];
    list.push(row);
    completionsByUser.set(row.user_id, list);
  });
  const sprintsByUser = new Map();
  (payload.sprints || []).forEach((row) => {
    const list = sprintsByUser.get(row.user_id) || [];
    list.push(row);
    sprintsByUser.set(row.user_id, list);
  });
  const mileTestsByUser = new Map();
  (payload.mileTests || []).forEach((row) => {
    const list = mileTestsByUser.get(row.user_id) || [];
    list.push(row);
    mileTestsByUser.set(row.user_id, list);
  });
  const notesByUser = new Map((payload.notes || []).map((row) => [row.athlete_user_id, row.note || '']));
  const metaByUser = new Map((payload.meta || []).map((row) => [row.athlete_user_id, row]));
  const emailByUser = new Map();
  (payload.identities || []).forEach((row) => {
    const id = normalizeUserId(row.user_id);
    if (id) emailByUser.set(id, String(row.email || '').trim().toLowerCase());
  });
  const coachUserIds = buildCoachUserIdSet(payload.identities, getCurrentUser()?.id);
  const excludedUserIds = buildRosterExclusionSet(payload.exclusions);

  return (payload.profiles || [])
    .filter((profile) => {
      const userId = normalizeUserId(profile?.user_id);
      if (!userId || coachUserIds.has(userId) || excludedUserIds.has(userId)) return false;
      const email = emailByUser.get(userId) || '';
      return !isCoachEmail(email) && !isRosterExcludedEmail(email);
    })
    .map((profile) => buildAthleteRecord(liveAthleteConfig(
      profile,
      hrByUser.get(profile.user_id),
      completionsByUser.get(profile.user_id) || [],
      sprintsByUser.get(profile.user_id) || [],
      mileTestsByUser.get(profile.user_id) || [],
      notesByUser.get(profile.user_id) || '',
      emailByUser.get(normalizeUserId(profile.user_id)) || '',
      metaByUser.get(profile.user_id)?.camp_start_date || ''
    )))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function rosterAthletes() {
  if (rosterSource === 'live') return liveAthletes || [];
  return MOCK_ATHLETES;
}

function getAthlete(id) {
  const list = rosterAthletes();
  return list.find((athlete) => athlete.id === id) || list[0] || null;
}

function readNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function writeNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function athleteNote(athlete) {
  if (rosterSource === 'live') return athlete.coachNote || '';
  return readNotes()[athlete.id] || '';
}

function summaryCounts() {
  const list = rosterAthletes();
  return {
    total: list.length,
    attention: list.filter((athlete) => athlete.tone !== 'on-track').length,
    onTrack: list.filter((athlete) => athlete.tone === 'on-track').length,
    missing: list.reduce((sum, athlete) => sum + athlete.missingCount, 0),
  };
}

function toneCopy(tone) {
  if (tone === 'behind') return 'Behind';
  if (tone === 'watch') return 'Watch HR';
  if (tone === 'proof') return 'Proof gap';
  return 'On track';
}

function parseAthleteHrValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

function getAthleteHrProfile(athlete) {
  const maxHr = parseAthleteHrValue(athlete?.maxHr);
  const restingHr = parseAthleteHrValue(athlete?.restingHr);
  return {
    maxHr,
    restingHr,
    hasMaxHr: maxHr !== null,
    hasRestingHr: restingHr !== null,
    isComplete: maxHr !== null && restingHr !== null,
  };
}

function renderAthleteHrChip(label, value, hasValue) {
  if (hasValue) {
    return `<span class="coach-hr-chip is-set"><em>${escapeHTML(label)}</em><strong>${value} bpm</strong></span>`;
  }
  return `<span class="coach-hr-chip is-missing" title="${escapeHTML(label)} HR not entered"><em>${escapeHTML(label)}</em><strong>Not set</strong></span>`;
}

function renderAthleteHrProfile(athlete, { compact = false } = {}) {
  const hr = getAthleteHrProfile(athlete);
  const chips = [
    renderAthleteHrChip('Max HR', hr.maxHr, hr.hasMaxHr),
    renderAthleteHrChip('Resting HR', hr.restingHr, hr.hasRestingHr),
  ].join('');
  if (compact) {
    return `<div class="coach-hr-row${hr.isComplete ? '' : ' is-incomplete'}" aria-label="Athlete heart rate profile">${chips}</div>`;
  }
  return `<div class="coach-hr-panel${hr.isComplete ? '' : ' is-incomplete'}" aria-label="Athlete heart rate profile">
    <div class="coach-hr-row">${chips}</div>
    ${hr.isComplete ? '' : '<p class="coach-hr-note">Athlete has not entered full HR info yet.</p>'}
  </div>`;
}

function statusCopy(status) {
  if (status === 'missing') return 'Missing';
  if (status === 'upcoming') return 'Upcoming';
  if (status === 'skipped') return 'Skipped';
  return 'Logged';
}

function matchesFilter(athlete) {
  if (rosterFilter === 'attention') return athlete.tone !== 'on-track';
  if (rosterFilter === 'on-track') return athlete.tone === 'on-track';
  return true;
}

function matchesQuery(athlete) {
  const query = rosterQuery.trim().toLowerCase();
  if (!query) return true;
  return athlete.name.toLowerCase().includes(query);
}

export function syncCoachPreviewChrome() {
  const enabled = canAccessCoachScreens();
  const liveCoach = isCoachUser();
  document.querySelectorAll('[data-coach-preview]').forEach((el) => {
    el.hidden = !enabled;
  });
  document.querySelectorAll('[data-coach-hide]').forEach((el) => {
    el.hidden = liveCoach;
  });
  document.body.classList.toggle('is-coach-preview', enabled && isCoachScreen(document.querySelector('.screen.active')?.id));
  document.body.classList.toggle('is-live-coach', liveCoach);
}

function syncCoachHeroCopy() {
  const live = rosterSource === 'live' || isCoachUser();
  const kicker = document.querySelector('#coach-dashboard .coach-hero .field-label');
  const title = document.querySelector('#coach-dashboard .coach-hero h2');
  const copy = document.querySelector('#coach-dashboard .coach-hero p');
  if (kicker) kicker.textContent = live ? 'Coach' : 'Local Preview';
  if (title) title.textContent = 'Camp roster.';
  if (copy) {
    copy.textContent = live
      ? 'Every fighter with a Ring Ready account. Sheets stays available for the deeper charts.'
      : 'Mock fighters for local preview. Open Alex Rivera to walk the mid-camp Assault Bike switch and continuous Performance Index.';
  }
  const rosterLabel = document.querySelector('#coach-roster-count')?.parentElement?.querySelector('em');
  if (rosterLabel) rosterLabel.textContent = live ? 'fighters with accounts' : 'fighters in preview';
}

function renderSignalPills(athlete) {
  const keys = ['performance', 'bench', 'zone', 'recovery', 'pace'];
  const labels = {
    performance: 'Index',
    bench: 'Bench',
    zone: 'Zone',
    recovery: 'Drop',
    pace: 'Pace',
  };
  return `<div class="coach-signal-row">${keys.map((key) => {
    const signal = athlete.scan[key];
    return `<span class="coach-signal is-${signal.tone}">${labels[key]} ${escapeHTML(signal.short)}</span>`;
  }).join('')}</div>`;
}

function renderRoster() {
  const list = document.getElementById('coach-roster-list');
  const empty = document.getElementById('coach-roster-empty');
  const counts = summaryCounts();
  syncCoachHeroCopy();
  setText('coach-roster-count', String(counts.total));
  setText('coach-attention-count', String(counts.attention));
  setText('coach-ontrack-count', String(counts.onTrack));
  setText('coach-missing-count', String(counts.missing));

  document.querySelectorAll('[data-coach-filter]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coachFilter === rosterFilter);
  });

  const search = document.getElementById('coach-roster-search');
  if (search && search.value !== rosterQuery) search.value = rosterQuery;

  if (liveLoadState === 'loading' && rosterSource === 'live') {
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'Loading fighters...';
    }
    if (list) list.innerHTML = '';
    return;
  }

  if (liveLoadError && rosterSource === 'live') {
    if (empty) {
      empty.hidden = false;
      empty.textContent = liveLoadError;
    }
    if (list) list.innerHTML = '';
    return;
  }

  const warningEl = document.getElementById('coach-roster-warnings');
  if (warningEl) {
    if (rosterSourceWarnings.length) {
      warningEl.hidden = false;
      warningEl.textContent = rosterSourceWarnings.join(' · ');
    } else {
      warningEl.hidden = true;
      warningEl.textContent = '';
    }
  }

  const athletes = rosterAthletes().filter((athlete) => matchesFilter(athlete) && matchesQuery(athlete));
  if (empty) {
    empty.hidden = athletes.length > 0;
    if (rosterSource === 'live' && counts.total === 0) {
      empty.textContent = 'No fighter accounts yet. If athletes are already logging in, run scripts/supabase-coach-access.sql in the Supabase SQL editor, then refresh.';
    } else {
      empty.textContent = rosterSource === 'live'
        ? 'No fighters match that filter. Fighters appear after they create a Ring Ready account and save a profile.'
        : 'No fighters match that filter.';
    }
  }
  if (!list) return;
  list.innerHTML = athletes.map((athlete) => `
    <button type="button" class="coach-roster-card is-${athlete.tone}" data-page-target="coach-athlete" data-coach-athlete="${escapeHTML(athlete.id)}">
      <div class="coach-roster-card-top">
        <div>
          <div class="info-kicker">Week ${athlete.currentWeekIndex + 1} · ${athlete.campLength} week camp</div>
          <strong>${escapeHTML(athlete.name)}</strong>
          ${athlete.email ? `<div class="coach-roster-email">${escapeHTML(athlete.email)}</div>` : ''}
        </div>
        <span class="coach-status-chip">${escapeHTML(toneCopy(athlete.tone))}</span>
      </div>
      <p>${escapeHTML(athlete.headline)}</p>
      ${renderAthleteHrProfile(athlete, { compact: true })}
      ${renderSignalPills(athlete)}
      <div class="coach-roster-meta">
        <span>${athlete.logged}/${athlete.due} logged</span>
        ${athlete.campStartDate ? `<span>Starts ${escapeHTML(formatCampStartLabel(athlete.campStartDate))}</span>` : ''}
        <span>${escapeHTML(athlete.lastSession)}</span>
        <span>Fight ${escapeHTML(athlete.fightDate)}</span>
        <span class="coach-roster-open">Open</span>
      </div>
    </button>
  `).join('');
}

function sparkRange(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return { min: 0, max: 1 };
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.18;
  return { min: min - pad, max: max + pad };
}

function renderSpark(points, valueKey, labelFn) {
  if (!points.length) return '<p class="coach-trend-empty">No trend yet.</p>';
  const values = points.map((row) => Number(row[valueKey]));
  const { min, max } = sparkRange(values);
  const span = Math.max(max - min, 0.001);
  const width = 100;
  const height = 36;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), ok: Number.isFinite(value) };
  });
  const line = coords.filter((point) => point.ok).map((point) => `${point.x},${point.y}`).join(' ');
  const dots = coords.filter((point) => point.ok).map((point) =>
    `<circle cx="${point.x}" cy="${point.y}" r="2.2"></circle>`
  ).join('');
  const polyline = coords.filter((point) => point.ok).length > 1
    ? `<polyline points="${line}"></polyline>`
    : '';
  return `<div class="coach-spark" aria-hidden="true">
    <svg class="coach-spark-line" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${polyline}${dots}</svg>
    <div class="coach-spark-labels">${points.map((row) =>
      `<span>${escapeHTML(labelFn(row))}</span>`
    ).join('')}</div>
  </div>`;
}

function renderMetricCard(id, title, signal, clickable) {
  const sparkKey = signal.key === 'recovery' ? 'first5Avg' : 'pct';
  const sparkPoints = signal.key === 'zone' ? [] : (signal.points || []);
  const spark = sparkPoints.length
    ? renderSpark(sparkPoints, sparkKey, (row) => `W${row.weekIndex + 1}`)
    : '';
  const tag = clickable ? 'button' : 'article';
  const clickAttrs = clickable
    ? `type="button" data-coach-drill="${id}" aria-expanded="${athleteDrill === id ? 'true' : 'false'}"`
    : '';
  const unit = signal.key === 'recovery' && signal.value !== '--'
    ? ' bpm'
    : '';
  return `<${tag} class="coach-metric-card is-${signal.tone}${clickable ? ' is-clickable' : ''}${athleteDrill === id ? ' is-open' : ''}" ${clickAttrs}>
    <div class="coach-metric-card-head">
      <span>${escapeHTML(title)}</span>
      ${clickable ? '<em>Open sessions</em>' : ''}
    </div>
    <strong>${escapeHTML(signal.value)}${unit}</strong>
    <p>${escapeHTML(signal.detail)}</p>
    ${spark}
  </${tag}>`;
}

function renderMetricCards(athlete) {
  return [
    renderMetricCard('performance', 'Performance Index', athlete.scan.performance, false),
    renderMetricCard('benchmark', 'Benchmark Run', athlete.scan.bench, true),
    renderMetricCard('zone', 'HR Zone Adherence', athlete.scan.zone, false),
    renderMetricCard('sprint', 'Recovery Trend', athlete.scan.recovery, true),
    renderMetricCard('pace', 'Overall Pace Trend', athlete.scan.pace, false),
  ].join('');
}

function sessionDetail(session) {
  if (session.status === 'skipped') {
    return session.note || 'Coach-approved skip. No workout proof required.';
  }
  if (session.flag) return session.flag;
  if (session.note) return session.note;
  if (session.proof === 'missing') return 'Logged, but workout proof is missing.';
  if (session.status === 'missing') return 'Assigned work not logged yet.';
  const bits = [];
  const modality = normalizeModality(session.modality);
  if (modality !== MODALITY_RUNNING) bits.push(formatModalityLabel(modality));
  if (session.minutes) bits.push(`${formatNumber(session.minutes)} min`);
  if (modality !== MODALITY_RUNNING && Number(session.avgWatts || session.outputValue) > 0) {
    bits.push(`${formatNumber(session.avgWatts || session.outputValue)} W`);
  } else if (session.distance) {
    bits.push(`${formatDecimal(session.distance)} mi`);
  }
  if (session.avgBpm) bits.push(`${formatNumber(session.avgBpm)} avg bpm`);
  if (session.drop) bits.push(`${formatNumber(session.drop)} drop`);
  if (isBenchmarkType(session.type) && session.distance && modality === MODALITY_RUNNING) {
    const equiv = getEquivDistance(session.distance, session.avgBpm, session.targetBPM);
    if (equiv) bits.push(`${formatDecimal(equiv)} equiv mi`);
  }
  return bits.join(' · ') || `Logged · ${session.targetZone || 'in zone'}`;
}

function renderSessionRows(sessions) {
  if (!sessions.length) return '<p class="coach-trend-empty">No sessions in this view.</p>';
  return sessions.map((session) => `
    <div class="coach-session-row is-${session.status}${session.flag ? ' has-flag' : ''}${session.proof === 'missing' ? ' has-proof-gap' : ''}">
      <div>
        <span>${escapeHTML(session.weekLabel)} / ${escapeHTML(session.day)}</span>
        <strong>${escapeHTML(session.type)}</strong>
        <p>${escapeHTML(sessionDetail(session))}</p>
      </div>
      <em>${escapeHTML(session.status === 'missing' ? 'Missing' : statusCopy(session.status))}</em>
    </div>
  `).join('');
}

function renderDrill(athlete) {
  if (athleteDrill !== 'benchmark' && athleteDrill !== 'sprint') return '';
  const isBench = athleteDrill === 'benchmark';
  const rows = athlete.sessions.filter((session) => {
    if (session.status === 'upcoming') return false;
    if (session.status === 'missing') return false;
    return isBench ? isBenchmarkType(session.type) : isSprintType(session.type);
  });
  const title = isBench ? 'Benchmark workouts' : 'Sprint workouts';
  return `
    <div class="coach-drill-head">
      <div class="info-kicker">${escapeHTML(title)}</div>
      <button type="button" class="coach-drill-close" data-coach-drill-close>Close</button>
    </div>
    <div class="coach-session-list">${renderSessionRows(rows)}</div>
  `;
}

function renderAthlete() {
  const athlete = getAthlete(selectedAthleteId);
  if (!athlete) return;
  selectedAthleteId = athlete.id;
  const note = athleteNote(athlete);
  const missed = athlete.sessions.filter((session) => session.status === 'missing');
  const skipped = athlete.sessions.filter((session) => session.status === 'skipped');

  setText('coach-athlete-kicker', `Week ${athlete.currentWeekIndex + 1} · ${athlete.campLength} week camp`);
  setText('coach-athlete-name', athlete.name);
  setText('coach-athlete-sub', [
    toneCopy(athlete.tone),
    athlete.campStartDate ? `Starts ${formatCampStartLabel(athlete.campStartDate)}` : '',
    athlete.email,
    `Fight ${athlete.fightDate}`,
    athlete.tenure,
  ].filter(Boolean).join(' · '));
  setText('coach-athlete-verdict', athlete.headline);
  const hrRoot = document.getElementById('coach-athlete-hr');
  if (hrRoot) hrRoot.innerHTML = renderAthleteHrProfile(athlete);
  const chip = document.getElementById('coach-athlete-status');
  if (chip) {
    chip.textContent = toneCopy(athlete.tone);
    chip.className = `coach-status-chip is-${athlete.tone}`;
  }

  const cards = document.getElementById('coach-athlete-cards');
  if (cards) cards.innerHTML = renderMetricCards(athlete);

  const drill = document.getElementById('coach-athlete-drill');
  if (drill) {
    const html = renderDrill(athlete);
    drill.hidden = !html;
    drill.innerHTML = html;
  }

  const attention = document.getElementById('coach-athlete-attention');
  if (attention) {
    attention.hidden = athlete.attention.length === 0;
    attention.innerHTML = athlete.attention.length
      ? `<div class="info-kicker">Needs a look</div><p>${escapeHTML(athlete.attention.join('. '))}.</p>`
      : '';
  }

  const missedRoot = document.getElementById('coach-athlete-missed');
  if (missedRoot) {
    missedRoot.hidden = missed.length === 0;
    missedRoot.innerHTML = missed.length
      ? `<div class="info-kicker">Missed workouts</div><div class="coach-session-list">${renderSessionRows(missed)}</div>`
      : '';
  }

  const skippedRoot = document.getElementById('coach-athlete-skipped');
  if (skippedRoot) {
    skippedRoot.hidden = skipped.length === 0;
    skippedRoot.innerHTML = skipped.length
      ? `<div class="info-kicker">Skipped workouts</div><div class="coach-session-list">${renderSessionRows(skipped)}</div>`
      : '';
  }

  const noteCopy = document.querySelector('#coach-athlete .coach-note-copy');
  if (noteCopy) {
    noteCopy.textContent = rosterSource === 'live'
      ? 'Shared with Gene and Daniel. Fighters do not see this note.'
      : 'Stays on this device for the preview. Later this becomes a cloud note on the athlete record.';
  }

  const noteInput = document.getElementById('coach-athlete-note');
  if (noteInput) noteInput.value = note;

  const startInput = document.getElementById('coach-athlete-start-date');
  if (startInput) startInput.value = athlete.campStartDate || '';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function saveOpenStartDate() {
  if (!selectedAthleteId) return;
  const input = document.getElementById('coach-athlete-start-date');
  const campStartDate = String(input?.value || '').trim();
  if (rosterSource === 'live') {
    try {
      await saveCoachCampStartDate(selectedAthleteId, campStartDate || null);
      await loadLiveRoster();
      renderAthlete();
      renderRoster();
      coachHooks?.showToast?.('START DATE SAVED');
    } catch (error) {
      console.warn('Coach start date save failed', error);
      coachHooks?.showToast?.('COULD NOT SAVE START DATE');
    }
    return;
  }
  const athlete = getAthlete(selectedAthleteId);
  if (athlete) {
    athlete.campStartDate = campStartDate;
    renderAthlete();
    renderRoster();
  }
  coachHooks?.showToast?.('START DATE SAVED LOCALLY');
}

async function cleanSlateOpenAthlete() {
  if (!selectedAthleteId) return;
  const athlete = getAthlete(selectedAthleteId);
  const name = athlete?.name || 'this fighter';
  if (rosterSource !== 'live') {
    coachHooks?.showToast?.('CLEAN SLATE NEEDS LIVE COACH LOGIN');
    return;
  }
  if (!window.confirm(`Archive ${name}'s current camp and start a clean slate?\n\nWorkouts, sprints, mile test, and camp start date clear. Name, HR, and coach note stay.`)) return;
  if (!window.confirm('Confirm clean slate. This cannot be undone from the app.')) return;

  const btn = document.getElementById('coach-clean-slate-btn');
  if (btn) btn.disabled = true;
  try {
    const label = [name, athlete?.fightDate ? `Fight ${athlete.fightDate}` : '', new Date().toLocaleDateString('en-US')].filter(Boolean).join(' · ');
    await archiveAndResetCamp({ athleteUserId: selectedAthleteId, label });
    await loadLiveRoster();
    renderAthlete();
    renderRoster();
    const startInput = document.getElementById('coach-athlete-start-date');
    if (startInput) startInput.value = '';
    coachHooks?.showToast?.('CAMP ARCHIVED · CLEAN SLATE READY');
  } catch (error) {
    console.warn('Coach clean slate failed', error);
    coachHooks?.showToast?.(String(error?.message || error || 'CLEAN SLATE FAILED').toUpperCase());
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveOpenNote() {
  if (!selectedAthleteId) return;
  const input = document.getElementById('coach-athlete-note');
  const note = String(input?.value || '').trim();
  if (rosterSource === 'live') {
    try {
      await saveCoachNote(selectedAthleteId, note);
      const athlete = getAthlete(selectedAthleteId);
      if (athlete) athlete.coachNote = note;
      coachHooks?.showToast?.('COACH NOTE SAVED');
    } catch (error) {
      console.warn('Coach note save failed', error);
      coachHooks?.showToast?.('COULD NOT SAVE NOTE');
    }
    return;
  }
  const notes = readNotes();
  notes[selectedAthleteId] = note;
  writeNotes(notes);
  coachHooks?.showToast?.('COACH NOTE SAVED LOCALLY');
}

async function loadLiveRoster() {
  if (!isCoachUser()) {
    rosterSource = 'mock';
    liveAthletes = null;
    liveLoadError = '';
    liveLoadState = 'idle';
    return;
  }
  liveLoadState = 'loading';
  rosterSource = 'live';
  liveLoadError = '';
  rosterSourceWarnings = [];
  try {
    const payload = await loadCoachRosterPayload();
    const sourceErrors = payload?.sourceErrors || {};
    rosterSourceWarnings = Object.entries(sourceErrors).map(([key, message]) => {
      const labels = {
        sprints: 'Sprint data unavailable',
        completions: 'Completion data unavailable',
        mileTests: 'Mile test data unavailable',
        hrRows: 'HR data unavailable',
        notes: 'Coach notes unavailable',
      };
      return labels[key] || `${key} unavailable: ${message}`;
    });
    liveAthletes = buildLiveRoster(payload || {
      profiles: [], hrRows: [], completions: [], sprints: [], mileTests: [], notes: [], identities: [], exclusions: [], meta: [],
    });
    liveLoadState = 'ready';
  } catch (error) {
    console.warn('Coach roster load failed', error);
    liveAthletes = [];
    liveLoadState = 'error';
    const message = String(error?.message || error);
    liveLoadError = /permission|rls|policy|42501|42p01|does not exist|schema cache/i.test(message)
      ? 'Coach access is not enabled yet. Run scripts/supabase-coach-access.sql in the Supabase SQL editor, then refresh.'
      : 'Could not load fighters. Check the connection and try again.';
  }
}

export function renderCoachPage(screenId) {
  if (!canAccessCoachScreens()) return;
  syncCoachPreviewChrome();
  if (isCoachUser() && liveLoadState === 'idle') {
    loadLiveRoster().then(() => renderCoachPage(screenId));
  }
  if (screenId === 'coach-dashboard') renderRoster();
  if (screenId === 'coach-athlete') renderAthlete();
}

export function openCoachPreviewIfRequested() {
  if (isCoachUser()) {
    coachHooks?.navigateTo?.('coach-dashboard');
    return true;
  }
  if (!isLocalCoachPreviewHost()) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('coach') !== '1') return false;
  const athleteId = String(params.get('athlete') || '').trim();
  if (athleteId && MOCK_ATHLETES.some((athlete) => athlete.id === athleteId)) {
    selectedAthleteId = athleteId;
    athleteDrill = '';
    coachHooks?.navigateTo?.('coach-athlete');
  } else {
    selectedAthleteId = '';
    coachHooks?.navigateTo?.('coach-dashboard');
  }
  return true;
}

export function setSelectedCoachAthlete(id) {
  selectedAthleteId = String(id || '');
  athleteDrill = '';
}

export async function refreshCoachPreview() {
  syncCoachPreviewChrome();
  if (isCoachUser()) await loadLiveRoster();
  else {
    rosterSource = 'mock';
    liveAthletes = null;
  }
}

export function initCoachPreview(hooks) {
  coachHooks = hooks;
  syncCoachPreviewChrome();
  if (bound) {
    refreshCoachPreview().then(() => openCoachPreviewIfRequested());
    return;
  }
  bound = true;

  document.addEventListener('click', (event) => {
    const athleteBtn = event.target.closest('[data-coach-athlete]');
    if (athleteBtn) setSelectedCoachAthlete(athleteBtn.dataset.coachAthlete);

    const drillBtn = event.target.closest('[data-coach-drill]');
    if (drillBtn && canAccessCoachScreens()) {
      event.preventDefault();
      const next = drillBtn.dataset.coachDrill || '';
      athleteDrill = athleteDrill === next ? '' : next;
      renderAthlete();
      return;
    }

    const closeBtn = event.target.closest('[data-coach-drill-close]');
    if (closeBtn && canAccessCoachScreens()) {
      event.preventDefault();
      athleteDrill = '';
      renderAthlete();
      return;
    }

    const filterBtn = event.target.closest('[data-coach-filter]');
    if (!filterBtn || !canAccessCoachScreens()) return;
    event.preventDefault();
    rosterFilter = filterBtn.dataset.coachFilter || 'all';
    renderRoster();
  }, true);

  document.getElementById('coach-roster-search')?.addEventListener('input', (event) => {
    rosterQuery = event.currentTarget.value || '';
    renderRoster();
  });
  document.getElementById('coach-note-save-btn')?.addEventListener('click', saveOpenNote);
  document.getElementById('coach-start-save-btn')?.addEventListener('click', saveOpenStartDate);
  document.getElementById('coach-clean-slate-btn')?.addEventListener('click', cleanSlateOpenAthlete);

  refreshCoachPreview().then(() => {
    const screen = document.querySelector('.screen.active')?.id;
    if (isCoachScreen(screen)) renderCoachPage(screen);
  });
}
