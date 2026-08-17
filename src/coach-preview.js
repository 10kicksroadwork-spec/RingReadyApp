import { PROGRAM } from './program.js';

const NOTES_KEY = 'ringReadyCoachPreviewNotes';
const COACH_SCREENS = new Set(['coach-dashboard', 'coach-athlete']);
const HR_TARGET_TOLERANCE_BPM = 5;
const SPRINT_TARGET_DROP = 30;
const EQUIV_RATIO_MIN = 0.85;
const EQUIV_RATIO_MAX = 1.15;
const EQUIV_K = 0.5;
const BENCHMARK_TARGET_BPM = 137;

let coachHooks = null;
let selectedAthleteId = '';
let rosterFilter = 'all';
let rosterQuery = '';
let bound = false;

export function isLocalCoachPreviewHost() {
  const host = String(window.location.hostname || '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
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

function formatTime(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return '--';
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return `${whole}:${String(seconds).padStart(2, '0')}`;
}

function formatSignedPct(pct) {
  if (!Number.isFinite(pct)) return '--';
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(0)}%`;
}

function formatSecondsShort(deltaMin) {
  if (!Number.isFinite(deltaMin)) return '--';
  const sec = Math.round(Math.abs(deltaMin) * 60);
  if (sec === 0) return '0s';
  const sign = deltaMin < 0 ? '−' : '+';
  return `${sign}${sec}s`;
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

function campWeeks(campLength) {
  return PROGRAM.slice(0, campLength === 4 ? 4 : PROGRAM.length);
}

function sessionKey(weekIndex, workoutIndex) {
  return `${weekIndex}:${workoutIndex}`;
}

/**
 * HR-adjusted equivalent distance for a 30-min benchmark (Sheets formula).
 * Credits sessions a bit below target HR; clamps wild ratios.
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

function emptySignal(label) {
  return {
    key: label,
    tone: 'neutral',
    value: '--',
    short: '--',
    detail: 'No data yet',
  };
}

function buildDoneSignal(logged, due, missingCount) {
  const pct = due ? Math.round((logged / due) * 100) : 0;
  let tone = 'green';
  if (missingCount > 0 || pct < 75) tone = 'red';
  else if (pct < 90) tone = 'amber';
  return {
    key: 'done',
    tone,
    value: `${pct}%`,
    short: `${logged}/${due}`,
    detail: `${logged}/${due} due sessions`,
    pct,
  };
}

function buildBenchSignal(points) {
  if (!points.length) return emptySignal('bench');
  const first = points[0].equiv;
  const last = points[points.length - 1].equiv;
  const lastAvg = points[points.length - 1].avgBpm;
  const lastDist = points[points.length - 1].distance;
  if (points.length < 2 || !Number.isFinite(first) || !Number.isFinite(last) || first <= 0) {
    return {
      key: 'bench',
      tone: 'neutral',
      value: Number.isFinite(lastDist) ? `${formatDecimal(lastDist)} mi` : '--',
      short: '--',
      detail: 'Need two benchmarks',
      points,
      lastAvg,
    };
  }
  const pct = ((last - first) / first) * 100;
  let tone = 'amber';
  if (pct >= 5) tone = 'green';
  else if (pct < 0) tone = 'red';
  return {
    key: 'bench',
    tone,
    value: formatSignedPct(pct),
    short: formatSignedPct(pct),
    detail: `${formatDecimal(first)} → ${formatDecimal(last)} equiv mi`,
    points,
    lastAvg,
    pct,
  };
}

function buildMileSignal(tests) {
  const list = Array.isArray(tests) ? tests : [];
  if (!list.length) return emptySignal('mile');
  const first = list[0];
  const last = list[list.length - 1];
  if (list.length < 2 || !Number.isFinite(first.minutes) || !Number.isFinite(last.minutes) || first.minutes <= 0) {
    return {
      key: 'mile',
      tone: 'neutral',
      value: formatTime(last.minutes),
      short: '--',
      detail: 'Retest not in yet',
      first,
      last,
    };
  }
  const deltaMin = last.minutes - first.minutes;
  const pct = ((first.minutes - last.minutes) / first.minutes) * 100;
  let tone = 'amber';
  if (pct >= 3) tone = 'green';
  else if (pct < 0) tone = 'red';
  const faster = deltaMin < 0;
  return {
    key: 'mile',
    tone,
    value: formatTime(last.minutes),
    short: formatSecondsShort(deltaMin),
    detail: faster
      ? `${Math.abs(Math.round(deltaMin * 60))}s faster vs baseline`
      : deltaMin > 0
        ? `${Math.round(deltaMin * 60)}s slower vs baseline`
        : 'Same as baseline',
    first,
    last,
    deltaMin,
    deltaSeconds: Math.round(deltaMin * 60),
    pct,
  };
}

function buildSprintSignal(points) {
  if (!points.length) return emptySignal('sprint');
  const first = points[0].first5Avg;
  const latest = points[points.length - 1].first5Avg;
  const change = points.length >= 2 ? latest - first : 0;
  const down = points.length >= 2 && latest < first - 0.4;
  let tone = 'amber';
  if (latest < 25 || down) tone = 'red';
  else if (latest >= SPRINT_TARGET_DROP) tone = 'green';
  return {
    key: 'sprint',
    tone,
    value: `${Math.round(latest)}`,
    short: `${Math.round(latest)}`,
    detail: points.length >= 2
      ? `${Math.round(first)} → ${Math.round(latest)} bpm drop (target ${SPRINT_TARGET_DROP})`
      : `Latest first-5 drop · target ${SPRINT_TARGET_DROP}+`,
    latest,
    first,
    change,
    points,
  };
}

function buildZoneSignal(sessions) {
  let scored = 0;
  let onTarget = 0;
  sessions.forEach((session) => {
    if (session.status !== 'logged') return;
    if (isSprintType(session.type)) return;
    const avg = Number(session.avgBpm);
    const tgt = Number(session.targetBPM);
    if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(tgt) || tgt <= 0) return;
    scored += 1;
    if (Math.abs(avg - tgt) <= HR_TARGET_TOLERANCE_BPM) onTarget += 1;
  });
  if (!scored) return emptySignal('zone');
  const pct = Math.round((onTarget / scored) * 100);
  let tone = 'red';
  if (pct >= 80) tone = 'green';
  else if (pct >= 60) tone = 'amber';
  return {
    key: 'zone',
    tone,
    value: `${pct}%`,
    short: `${pct}%`,
    detail: `${onTarget}/${scored} runs within ±${HR_TARGET_TOLERANCE_BPM} bpm`,
    pct,
    scored,
    onTarget,
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
    .filter((session) => session.status === 'logged' && isBenchmarkType(session.type) && Number(session.distance) > 0)
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

function hasEasyHotFlag(config) {
  return Object.values(config.flags || {}).some((flag) => /easy/i.test(String(flag)));
}

/**
 * One punchline: worst ops/fitness issue first, then one useful note.
 */
function buildHeadline(athlete) {
  const bits = [];
  const { scan, tone, missingCount, currentWeekIndex, campLength, proofGaps } = athlete;
  const sprint = scan.sprint;
  const bench = scan.bench;
  const mile = scan.mile;

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

  if (sprint.tone === 'neutral') {
    bits.push('No sprint yet.');
  } else if (sprint.tone === 'red' && Number.isFinite(sprint.latest)) {
    bits.push(`Sprint ${Math.round(sprint.latest)} bpm (target ${SPRINT_TARGET_DROP}).`);
  } else if (tone === 'watch' && Number.isFinite(bench.lastAvg)) {
    bits.push(`Benchmark avg ${Math.round(bench.lastAvg)} vs Zone 2.`);
  } else if (mile.tone === 'green' && Number.isFinite(mile.deltaSeconds) && mile.deltaSeconds < 0) {
    bits.push(`Mile ${Math.abs(mile.deltaSeconds)}s faster.`);
    if (currentWeekIndex >= campLength - 1) bits.push('Camp nearly done.');
  } else if (bench.tone === 'green') {
    bits.push('Benchmark up.');
    if (sprint.tone === 'green' && Number.isFinite(sprint.latest)) {
      bits.push(`Sprint ${Math.round(sprint.latest)} bpm.`);
    }
  } else if (sprint.tone === 'green' && Number.isFinite(sprint.latest)) {
    bits.push(`Sprint ${Math.round(sprint.latest)} bpm.`);
  }

  return bits.join(' ');
}

function overlaySeriesOntoSession(session, config) {
  const next = { ...session };
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
  return next;
}

function buildAthleteRecord(config) {
  const weeks = campWeeks(config.campLength);
  const missing = new Set(config.missing || []);
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
    const weekSessions = week.workouts.map((workout, workoutIndex) => {
      const key = sessionKey(weekIndex, workoutIndex);
      const isFuture = weekIndex > config.currentWeekIndex;
      const isMissing = missing.has(key);
      const status = isFuture ? 'upcoming' : isMissing ? 'missing' : 'logged';
      const proof = isFuture ? 'upcoming' : missingProofs.has(key) ? 'missing' : status === 'logged' ? 'on-file' : 'none';
      const flag = flags[key] || '';
      if (!isFuture) due += 1;
      if (status === 'logged') {
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
      }, config);
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

  let tone = 'on-track';
  if (due - logged > 0) tone = 'behind';
  else if (watchCount > 0) tone = 'watch';
  else if (proofGaps > 0) tone = 'proof';

  const benchPoints = collectBenchmarkPoints(config, sessions);
  const sprintPoints = collectSprintPoints(config, sessions);
  const scan = {
    done: buildDoneSignal(logged, due, Math.max(0, due - logged)),
    bench: buildBenchSignal(benchPoints),
    mile: buildMileSignal(config.mileTests),
    sprint: buildSprintSignal(sprintPoints),
    zone: buildZoneSignal(sessions),
  };

  const athlete = {
    ...config,
    completionPct: due ? Math.round((logged / due) * 100) : 0,
    logged,
    due,
    missingCount: Math.max(0, due - logged),
    proofGaps,
    watchCount,
    attention,
    tone,
    weekRows,
    sessions,
    scan,
    sprintDrop: sprintPoints.length ? sprintPoints[sprintPoints.length - 1].first5Avg : config.sprintDrop ?? null,
  };
  athlete.headline = buildHeadline(athlete);
  return athlete;
}

const MOCK_ATHLETES = [
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
    mileTests: [
      { label: 'Baseline', minutes: 7.7, avgBpm: 176, maxBpm: 188 },
    ],
    sprintPeak: 184,
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
    mileTests: [
      { label: 'Baseline', minutes: 8.35, avgBpm: 172, maxBpm: 181 },
    ],
    sprintPeak: 176,
    missing: ['0:3', '0:4', '1:3'],
    missingProofs: ['1:0'],
    sessionNotes: {
      '0:3': 'Said legs were heavy after sparring.',
    },
    benchmarks: [
      { weekIndex: 0, distance: 2.70, avgBpm: 140 },
      { weekIndex: 1, distance: 2.68, avgBpm: 141 },
    ],
    sprints: [
      { weekIndex: 0, first5Avg: 24 },
      { weekIndex: 1, first5Avg: 24 },
    ],
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
    mileTests: [
      { label: 'Baseline', minutes: 7.2, avgBpm: 168, maxBpm: 176 },
    ],
    sprintPeak: 174,
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
    avgs: {
      '0:2': 162, '0:3': 148, '0:4': 146,
      '1:2': 163, '1:3': 150, '1:4': 147,
      '2:2': 164, '2:3': 149, '2:4': 145,
      '3:2': 160, '3:3': 148,
      '4:1': 154,
    },
    minutes: { '4:1': 30, '3:3': 20 },
    distances: { '4:1': 3.4 },
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
    mileTests: [
      { label: 'Baseline', minutes: 9.1, avgBpm: 178, maxBpm: 192 },
    ],
    sprintPeak: null,
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
    mileTests: [
      { label: 'Baseline', minutes: 7.92, avgBpm: 171, maxBpm: 180 },
      { label: 'Re-Test', minutes: 7.47, avgBpm: 174, maxBpm: 184 },
    ],
    sprintPeak: 182,
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
    avgs: {
      '0:2': 162, '0:3': 136, '0:4': 138,
      '1:2': 164, '1:3': 137, '1:4': 139,
      '2:2': 163, '2:3': 136, '2:4': 138,
      '3:2': 154, '3:3': 135, '3:4': 137,
    },
  }),
];

function getAthlete(id) {
  return MOCK_ATHLETES.find((athlete) => athlete.id === id) || MOCK_ATHLETES[0];
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

function toneCopy(tone) {
  if (tone === 'behind') return 'Behind';
  if (tone === 'watch') return 'Watch HR';
  if (tone === 'proof') return 'Proof gap';
  return 'On track';
}

function statusCopy(status) {
  if (status === 'missing') return 'Missing';
  if (status === 'upcoming') return 'Upcoming';
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

function summaryCounts() {
  return {
    total: MOCK_ATHLETES.length,
    attention: MOCK_ATHLETES.filter((athlete) => athlete.tone !== 'on-track').length,
    onTrack: MOCK_ATHLETES.filter((athlete) => athlete.tone === 'on-track').length,
    missing: MOCK_ATHLETES.reduce((sum, athlete) => sum + athlete.missingCount, 0),
  };
}

export function syncCoachPreviewChrome() {
  const enabled = isLocalCoachPreviewHost();
  document.querySelectorAll('[data-coach-preview]').forEach((el) => {
    el.hidden = !enabled;
  });
  document.body.classList.toggle('is-coach-preview', enabled && isCoachScreen(document.querySelector('.screen.active')?.id));
}

function renderSignalPills(athlete) {
  const keys = ['done', 'bench', 'mile', 'sprint'];
  const labels = { done: 'Done', bench: 'Bench', mile: 'Mile', sprint: 'Sprint' };
  return `<div class="coach-signal-row">${keys.map((key) => {
    const signal = athlete.scan[key];
    return `<span class="coach-signal is-${signal.tone}">${labels[key]} ${escapeHTML(signal.short)}</span>`;
  }).join('')}</div>`;
}

function renderRoster() {
  const list = document.getElementById('coach-roster-list');
  const empty = document.getElementById('coach-roster-empty');
  const counts = summaryCounts();
  setText('coach-roster-count', String(counts.total));
  setText('coach-attention-count', String(counts.attention));
  setText('coach-ontrack-count', String(counts.onTrack));
  setText('coach-missing-count', String(counts.missing));

  document.querySelectorAll('[data-coach-filter]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coachFilter === rosterFilter);
  });

  const search = document.getElementById('coach-roster-search');
  if (search && search.value !== rosterQuery) search.value = rosterQuery;

  const athletes = MOCK_ATHLETES.filter((athlete) => matchesFilter(athlete) && matchesQuery(athlete));
  if (empty) empty.hidden = athletes.length > 0;
  if (!list) return;
  list.innerHTML = athletes.map((athlete) => `
    <button type="button" class="coach-roster-card is-${athlete.tone}" data-page-target="coach-athlete" data-coach-athlete="${escapeHTML(athlete.id)}">
      <div class="coach-roster-card-top">
        <div>
          <div class="info-kicker">Week ${athlete.currentWeekIndex + 1} · ${athlete.campLength} week camp</div>
          <strong>${escapeHTML(athlete.name)}</strong>
        </div>
        <span class="coach-status-chip">${escapeHTML(toneCopy(athlete.tone))}</span>
      </div>
      <p>${escapeHTML(athlete.headline)}</p>
      ${renderSignalPills(athlete)}
      <div class="coach-roster-meta">
        <span>${athlete.logged}/${athlete.due} logged</span>
        <span>${escapeHTML(athlete.lastSession)}</span>
        <span>Fight ${escapeHTML(athlete.fightDate)}</span>
        <span class="coach-roster-open">Open</span>
      </div>
    </button>
  `).join('');
}

function sparkHeights(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return values.map(() => 0);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(max - min, 0.08);
  return values.map((value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.round(28 + ((value - min) / span) * 72);
  });
}

function renderScanTiles(scan) {
  const tiles = [
    { key: 'done', label: 'Done' },
    { key: 'bench', label: 'Bench' },
    { key: 'mile', label: 'Mile' },
    { key: 'sprint', label: 'Sprint' },
    { key: 'zone', label: 'Zone' },
  ];
  return tiles.map(({ key, label }) => {
    const signal = scan[key];
    const suffix = key === 'sprint' && signal.value !== '--' ? ' bpm' : '';
    return `<article class="coach-scan-tile is-${signal.tone}">
      <span>${label}</span>
      <strong>${escapeHTML(signal.value)}${suffix}</strong>
      <em>${escapeHTML(signal.detail)}</em>
    </article>`;
  }).join('');
}

function renderTrends(athlete) {
  const points = athlete.scan.bench.points || [];
  const mile = athlete.scan.mile;
  const heights = sparkHeights(points.map((row) => row.equiv));
  const spark = points.length
    ? `<div class="coach-spark" aria-hidden="true">${points.map((row, index) => `
        <div class="coach-spark-col">
          <i style="height:${heights[index]}%"></i>
          <span>W${row.weekIndex + 1}</span>
        </div>`).join('')}</div>`
    : '<p class="coach-trend-empty">No benchmark runs yet.</p>';

  const mileTable = mile.first && mile.last && athlete.mileTests.length >= 2
    ? `<table class="coach-mile-table">
        <thead><tr><th></th><th>First</th><th>Last</th></tr></thead>
        <tbody>
          <tr><th>Time</th><td>${formatTime(mile.first.minutes)}</td><td>${formatTime(mile.last.minutes)}</td></tr>
          <tr><th>Avg HR</th><td>${formatNumber(mile.first.avgBpm)}</td><td>${formatNumber(mile.last.avgBpm)}</td></tr>
          <tr><th>Max HR</th><td>${formatNumber(mile.first.maxBpm)}</td><td>${formatNumber(mile.last.maxBpm)}</td></tr>
        </tbody>
      </table>`
    : '<p class="coach-trend-empty">Mile delta shows after the Week 6 retest.</p>';

  return `
    <div class="coach-trend-block">
      <div class="info-kicker">Benchmark equiv</div>
      ${spark}
      <p class="coach-trend-note">${escapeHTML(athlete.scan.bench.detail)}</p>
    </div>
    <div class="coach-trend-block">
      <div class="info-kicker">Mile first vs last</div>
      ${mileTable}
    </div>
  `;
}

function renderAthlete() {
  const athlete = getAthlete(selectedAthleteId);
  selectedAthleteId = athlete.id;
  const notes = readNotes();
  const note = notes[athlete.id] || '';
  const currentWeek = athlete.weekRows[athlete.currentWeekIndex] || athlete.weekRows[0];
  const recent = athlete.sessions.filter((session) => session.status !== 'upcoming').slice(-8).reverse();

  setText('coach-athlete-kicker', `Week ${athlete.currentWeekIndex + 1} · ${athlete.campLength} week camp`);
  setText('coach-athlete-name', athlete.name);
  setText('coach-athlete-sub', `${toneCopy(athlete.tone)} · Fight ${athlete.fightDate} · ${athlete.tenure}`);
  setText('coach-athlete-verdict', athlete.headline);
  const chip = document.getElementById('coach-athlete-status');
  if (chip) {
    chip.textContent = toneCopy(athlete.tone);
    chip.className = `coach-status-chip is-${athlete.tone}`;
  }

  const stats = document.getElementById('coach-athlete-stats');
  if (stats) stats.innerHTML = renderScanTiles(athlete.scan);

  const trends = document.getElementById('coach-athlete-trends');
  if (trends) trends.innerHTML = renderTrends(athlete);

  const attention = document.getElementById('coach-athlete-attention');
  if (attention) {
    attention.hidden = athlete.attention.length === 0;
    attention.innerHTML = athlete.attention.length
      ? `<div class="info-kicker">Needs a look</div><p>${escapeHTML(athlete.attention.join('. '))}.</p>`
      : '';
  }

  const weeks = document.getElementById('coach-athlete-weeks');
  if (weeks) {
    weeks.innerHTML = athlete.weekRows.map((row, index) => `
      <div class="week-bar-row">
        <span>W${index + 1}</span>
        <div class="week-bar-track"><i style="width:${row.pct}%"></i></div>
        <em>${row.done}/${row.total}</em>
      </div>
    `).join('');
  }

  const current = document.getElementById('coach-athlete-current-week');
  if (current) {
    current.innerHTML = (currentWeek?.sessions || []).map((session) => `
      <div class="coach-session-row is-${session.status}${session.flag ? ' has-flag' : ''}${session.proof === 'missing' ? ' has-proof-gap' : ''}">
        <div>
          <span>${escapeHTML(session.day)}</span>
          <strong>${escapeHTML(session.type)}</strong>
          <p>${escapeHTML(sessionDetail(session))}</p>
        </div>
        <em>${escapeHTML(statusCopy(session.status))}</em>
      </div>
    `).join('');
  }

  const recentRoot = document.getElementById('coach-athlete-recent');
  if (recentRoot) {
    recentRoot.innerHTML = recent.map((session) => `
      <div class="coach-session-row is-${session.status}${session.flag ? ' has-flag' : ''}${session.proof === 'missing' ? ' has-proof-gap' : ''}">
        <div>
          <span>${escapeHTML(session.weekLabel)} / ${escapeHTML(session.day)}</span>
          <strong>${escapeHTML(session.type)}</strong>
          <p>${escapeHTML(sessionDetail(session))}</p>
        </div>
        <em>${escapeHTML(session.proof === 'missing' ? 'No proof' : statusCopy(session.status))}</em>
      </div>
    `).join('');
  }

  const miles = document.getElementById('coach-athlete-miles');
  if (miles) {
    miles.innerHTML = athlete.mileTests.map((test) => `
      <div class="instruction-row">
        <span>${escapeHTML(test.label)}</span>
        <strong>${formatTime(test.minutes)} · ${formatNumber(test.avgBpm)} avg · ${formatNumber(test.maxBpm)} max</strong>
      </div>
    `).join('');
  }

  const noteInput = document.getElementById('coach-athlete-note');
  if (noteInput) noteInput.value = note;
}

function sessionDetail(session) {
  if (session.flag) return session.flag;
  if (session.note) return session.note;
  if (session.proof === 'missing') return 'Logged, but workout proof is missing.';
  if (session.status === 'missing') return 'Assigned work not logged yet.';
  if (session.status === 'upcoming') return `Upcoming · ${session.targetZone || 'plan as written'}`;
  const bits = [];
  if (session.minutes) bits.push(`${formatNumber(session.minutes)} min`);
  if (session.distance) bits.push(`${formatDecimal(session.distance)} mi`);
  if (session.avgBpm) bits.push(`${formatNumber(session.avgBpm)} avg bpm`);
  if (session.drop) bits.push(`${formatNumber(session.drop)} drop`);
  if (session.proof === 'on-file') bits.push('Proof on file');
  return bits.join(' · ') || `Logged · ${session.targetZone || 'in zone'}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function saveOpenNote() {
  if (!selectedAthleteId) return;
  const input = document.getElementById('coach-athlete-note');
  const notes = readNotes();
  notes[selectedAthleteId] = String(input?.value || '').trim();
  writeNotes(notes);
  coachHooks?.showToast?.('COACH NOTE SAVED LOCALLY');
}

export function renderCoachPage(screenId) {
  if (!isLocalCoachPreviewHost()) return;
  syncCoachPreviewChrome();
  if (screenId === 'coach-dashboard') renderRoster();
  if (screenId === 'coach-athlete') renderAthlete();
}

function openCoachDashboard() {
  selectedAthleteId = '';
  coachHooks?.navigateTo?.('coach-dashboard');
}

export function openCoachPreviewIfRequested() {
  if (!isLocalCoachPreviewHost()) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('coach') !== '1') return false;
  const athleteId = String(params.get('athlete') || '').trim();
  if (athleteId && MOCK_ATHLETES.some((athlete) => athlete.id === athleteId)) {
    selectedAthleteId = athleteId;
    coachHooks?.navigateTo?.('coach-athlete');
  } else {
    selectedAthleteId = '';
    coachHooks?.navigateTo?.('coach-dashboard');
  }
  return true;
}

export function setSelectedCoachAthlete(id) {
  selectedAthleteId = String(id || '');
}

export function initCoachPreview(hooks) {
  coachHooks = hooks;
  syncCoachPreviewChrome();
  if (bound) {
    openCoachPreviewIfRequested();
    return;
  }
  bound = true;

  document.addEventListener('click', (event) => {
    const athleteBtn = event.target.closest('[data-coach-athlete]');
    if (athleteBtn) setSelectedCoachAthlete(athleteBtn.dataset.coachAthlete);

    const filterBtn = event.target.closest('[data-coach-filter]');
    if (!filterBtn || !isLocalCoachPreviewHost()) return;
    event.preventDefault();
    rosterFilter = filterBtn.dataset.coachFilter || 'all';
    renderRoster();
  }, true);

  document.getElementById('coach-roster-search')?.addEventListener('input', (event) => {
    rosterQuery = event.currentTarget.value || '';
    renderRoster();
  });
  document.getElementById('coach-note-save-btn')?.addEventListener('click', saveOpenNote);
}
