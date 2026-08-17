import { PROGRAM } from './program.js';

const NOTES_KEY = 'ringReadyCoachPreviewNotes';
const COACH_SCREENS = new Set(['coach-dashboard', 'coach-athlete']);

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

function campWeeks(campLength) {
  return PROGRAM.slice(0, campLength === 4 ? 4 : PROGRAM.length);
}

function sessionKey(weekIndex, workoutIndex) {
  return `${weekIndex}:${workoutIndex}`;
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
      const session = {
        key,
        weekIndex,
        workoutIndex,
        weekLabel: week.label,
        weekTitle: week.title,
        day: workout.day,
        type: workout.type,
        targetZone: workout.targetZone || '',
        status,
        proof,
        flag,
        note: notes[key] || '',
        avgBpm: config.avgs?.[key] ?? null,
        maxBpm: config.maxes?.[key] ?? null,
        minutes: config.minutes?.[key] ?? null,
        distance: config.distances?.[key] ?? null,
        drop: config.drops?.[key] ?? null,
      };
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

  return {
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
  };
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
    sprintDrop: 38,
    sprintPeak: 184,
    missing: [],
    missingProofs: [],
    avgs: { '2:2': 164 },
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
    sprintDrop: 24,
    sprintPeak: 176,
    missing: ['0:3', '0:4', '1:3'],
    missingProofs: ['1:0'],
    sessionNotes: {
      '0:3': 'Said legs were heavy after sparring.',
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
    sprintDrop: 41,
    sprintPeak: 174,
    missing: [],
    missingProofs: [],
    flags: {
      '3:3': 'Easy-day HR sat in Tempo',
      '4:1': 'Benchmark avg 154 · Zone 2 is 106–123',
    },
    avgs: { '4:1': 154, '3:3': 148 },
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
    sprintDrop: null,
    sprintPeak: null,
    missing: ['0:1', '0:2', '0:3', '0:4'],
    missingProofs: [],
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
    sprintDrop: 36,
    sprintPeak: 182,
    missing: [],
    missingProofs: [],
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
      <p>${athlete.attention.length ? escapeHTML(athlete.attention.join(' · ')) : 'Camp work is current. No flags.'}</p>
      <div class="coach-roster-meta">
        <span>${athlete.logged}/${athlete.due} logged</span>
        <span>${escapeHTML(athlete.lastSession)}</span>
        <span>Fight ${escapeHTML(athlete.fightDate)}</span>
        <span class="coach-roster-open">Open</span>
      </div>
    </button>
  `).join('');
}

function renderAthlete() {
  const athlete = getAthlete(selectedAthleteId);
  selectedAthleteId = athlete.id;
  const notes = readNotes();
  const note = notes[athlete.id] || '';
  const currentWeek = athlete.weekRows[athlete.currentWeekIndex] || athlete.weekRows[0];
  const recent = athlete.sessions.filter((session) => session.status !== 'upcoming').slice(-8).reverse();
  const mileCopy = athlete.mileTests.map((test) => `${test.label} ${formatTime(test.minutes)}`).join(' · ');

  setText('coach-athlete-kicker', `Week ${athlete.currentWeekIndex + 1} · ${athlete.campLength} week camp`);
  setText('coach-athlete-name', athlete.name);
  setText('coach-athlete-sub', `${toneCopy(athlete.tone)} · Fight ${athlete.fightDate} · ${athlete.tenure}`);
  const chip = document.getElementById('coach-athlete-status');
  if (chip) {
    chip.textContent = toneCopy(athlete.tone);
    chip.className = `coach-status-chip is-${athlete.tone}`;
  }

  const stats = document.getElementById('coach-athlete-stats');
  if (stats) {
    stats.innerHTML = `
      <article class="dash-card dash-stat-card"><span>Camp</span><strong>${athlete.completionPct}%</strong><em>${athlete.logged}/${athlete.due} due sessions</em></article>
      <article class="dash-card dash-stat-card"><span>Max HR</span><strong>${formatNumber(athlete.maxHr)}</strong><em>${formatNumber(athlete.restingHr)} resting</em></article>
      <article class="dash-card dash-stat-card"><span>Mile</span><strong>${formatTime(athlete.mileTests.at(-1)?.minutes)}</strong><em>${escapeHTML(mileCopy)}</em></article>
      <article class="dash-card dash-stat-card"><span>Sprint Drop</span><strong>${formatNumber(athlete.sprintDrop)}</strong><em>${athlete.sprintPeak ? `${formatNumber(athlete.sprintPeak)} peak` : 'no sprint yet'}</em></article>
    `;
  }

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
