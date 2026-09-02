/**
 * Cardio modality + continuous Performance Index.
 * No fake cross-modality distance conversions — each modality keeps its own
 * baseline and anchors to the current camp index when first introduced.
 */

export const MODALITY_RUNNING = 'running';
export const MODALITY_ASSAULT_BIKE = 'assault_bike';
export const MODALITY_ROWER = 'rower';
export const MODALITY_STATIONARY_BIKE = 'stationary_bike';

export const MODALITIES = [
  {
    id: MODALITY_RUNNING,
    label: 'Running',
    outputType: 'distance',
    outputLabel: 'Distance (mi)',
    outputUnit: 'mi',
    outputInputMode: 'decimal',
  },
  {
    id: MODALITY_ASSAULT_BIKE,
    label: 'Assault Bike',
    outputType: 'watts',
    outputLabel: 'Average Watts',
    outputUnit: 'W',
    outputInputMode: 'decimal',
  },
  {
    id: MODALITY_ROWER,
    label: 'Rower',
    outputType: 'watts',
    outputLabel: 'Average Watts',
    outputUnit: 'W',
    outputInputMode: 'decimal',
  },
  {
    id: MODALITY_STATIONARY_BIKE,
    label: 'Stationary Bike',
    outputType: 'watts',
    outputLabel: 'Average Watts',
    outputUnit: 'W',
    outputInputMode: 'decimal',
  },
];

const HR_TARGET_TOLERANCE_BPM = 5;
const BASELINE_SESSION_TARGET = 2;

export function normalizeModality(value) {
  const id = String(value || '').trim().toLowerCase();
  return MODALITIES.some((row) => row.id === id) ? id : MODALITY_RUNNING;
}

/** Return modality id only when value is a recognized id; otherwise null. */
export function validModalityOrNull(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return MODALITIES.some((row) => row.id === candidate) ? candidate : null;
}

export function getModalityMeta(value) {
  const id = normalizeModality(value);
  return MODALITIES.find((row) => row.id === id) || MODALITIES[0];
}

export function modalityOutputType(value) {
  return getModalityMeta(value).outputType;
}

export function isMachineModality(value) {
  return modalityOutputType(value) === 'watts';
}

export function formatModalityLabel(value) {
  return getModalityMeta(value).label;
}

export function isHrValidForPerformance(avgBpm, targetBpm, tolerance = HR_TARGET_TOLERANCE_BPM) {
  const avg = Number(avgBpm);
  const tgt = Number(targetBpm);
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(tgt) || tgt <= 0) return false;
  return Math.abs(avg - tgt) <= tolerance;
}

function isSprintLike(type) {
  return /\bsprint\b/i.test(String(type || ''));
}

function isMileTestLike(type) {
  const text = String(type || '').toLowerCase();
  return /\bmile\b/.test(text) && /\b(test|re-?test|time trial)\b/.test(text);
}

/**
 * Comparable cardio sessions only. Sprints and mile tests stay out of the index.
 * Running continuity uses Benchmark sessions so easy/long paces do not dilute the score.
 * Machine modalities use any steady cardio session with watts + valid HR.
 */
export function isPerformanceComparableSession(session = {}) {
  if (session.status && session.status !== 'logged') return false;
  if (isSprintLike(session.type) || isMileTestLike(session.type)) return false;
  const modality = normalizeModality(session.modality);
  const output = Number(session.outputValue ?? (modality === MODALITY_RUNNING ? session.distance : session.avgWatts));
  const minutes = Number(session.minutes ?? session.totalMinutes);
  if (!Number.isFinite(output) || output <= 0) return false;
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  if (!isHrValidForPerformance(session.avgBpm, session.targetBPM ?? session.targetBpm)) return false;
  if (modality === MODALITY_RUNNING) return /benchmark/i.test(String(session.type || ''));
  return true;
}

/**
 * Higher is better for the index math.
 * Running uses distance / minutes (mi per min). Machines use watts.
 */
export function sessionPerformanceOutput(session = {}) {
  const modality = normalizeModality(session.modality);
  if (modality === MODALITY_RUNNING) {
    const distance = Number(session.outputValue ?? session.distance);
    const minutes = Number(session.minutes ?? session.totalMinutes);
    if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(minutes) || minutes <= 0) return null;
    return distance / minutes;
  }
  const watts = Number(session.outputValue ?? session.avgWatts);
  return Number.isFinite(watts) && watts > 0 ? watts : null;
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

/**
 * Walk sessions in camp order and build a continuous Performance Index.
 * New modalities inherit the current index; returning to an old modality resumes it.
 */
export function buildPerformanceContinuity(sessions = []) {
  const comparable = [...sessions]
    .filter(isPerformanceComparableSession)
    .map((session, order) => ({
      ...session,
      modality: normalizeModality(session.modality),
      order,
      sortKey: Number.isFinite(Number(session.weekIndex))
        ? Number(session.weekIndex) * 100 + (Number(session.workoutIndex) || 0)
        : order,
    }))
    .sort((a, b) => a.sortKey - b.sortKey || a.order - b.order);

  const modalityState = new Map();
  let currentIndex = null;
  const points = [];

  comparable.forEach((session) => {
    const output = sessionPerformanceOutput(session);
    if (!Number.isFinite(output) || output <= 0) return;

    let state = modalityState.get(session.modality);
    if (!state) {
      state = {
        modality: session.modality,
        baselineOutput: null,
        baselineIndex: null,
        baselineSamples: [],
        sessionCount: 0,
      };
      modalityState.set(session.modality, state);
    }

    state.sessionCount += 1;

    if (state.baselineOutput == null) {
      state.baselineSamples.push(output);
      const sampleCount = state.baselineSamples.length;
      const provisionalBaseline = average(state.baselineSamples);
      if (currentIndex == null) currentIndex = 100;
      state.baselineIndex = currentIndex;
      if (sampleCount >= BASELINE_SESSION_TARGET) {
        state.baselineOutput = provisionalBaseline;
      } else {
        // Temporary single-session baseline until a second valid session lands.
        state.baselineOutput = provisionalBaseline;
      }
      const index = state.baselineIndex;
      points.push({
        weekIndex: session.weekIndex,
        workoutIndex: session.workoutIndex,
        modality: session.modality,
        output,
        index,
        establishingBaseline: sampleCount < BASELINE_SESSION_TARGET,
      });
      currentIndex = index;
      return;
    }

    if (state.baselineSamples.length < BASELINE_SESSION_TARGET) {
      state.baselineSamples.push(output);
      state.baselineOutput = average(state.baselineSamples);
      const index = state.baselineIndex;
      points.push({
        weekIndex: session.weekIndex,
        workoutIndex: session.workoutIndex,
        modality: session.modality,
        output,
        index,
        establishingBaseline: state.baselineSamples.length < BASELINE_SESSION_TARGET,
      });
      currentIndex = index;
      return;
    }

    const index = state.baselineIndex * (output / state.baselineOutput);
    points.push({
      weekIndex: session.weekIndex,
      workoutIndex: session.workoutIndex,
      modality: session.modality,
      output,
      index,
      establishingBaseline: false,
    });
    currentIndex = index;
  });

  const baselines = [...modalityState.values()].map((state) => ({
    modality: state.modality,
    baselineOutput: state.baselineOutput,
    baselinePerformanceIndex: state.baselineIndex,
    baselineSessions: Math.min(state.baselineSamples.length, BASELINE_SESSION_TARGET),
    sessionCount: state.sessionCount,
  }));

  const latest = points[points.length - 1] || null;
  return {
    index: latest ? Number(latest.index.toFixed(1)) : null,
    points,
    baselines,
    modalityCount: baselines.length,
    latestModality: latest?.modality || null,
  };
}

export function formatPerformanceIndex(value) {
  if (!Number.isFinite(Number(value))) return '--';
  return String(Math.round(Number(value)));
}

export function buildWorkoutLogModalityFields(modality, outputValue) {
  const meta = getModalityMeta(modality);
  const value = Number(outputValue);
  const safeValue = Number.isFinite(value) && value > 0 ? value : null;
  return {
    modality: meta.id,
    outputType: meta.outputType,
    outputValue: safeValue,
    distance: meta.outputType === 'distance' ? safeValue : null,
    avgWatts: meta.outputType === 'watts' ? safeValue : null,
  };
}

export function readOutputFromWorkoutLog(log = {}) {
  const modality = normalizeModality(log.modality);
  const meta = getModalityMeta(modality);
  if (Number.isFinite(Number(log.outputValue)) && Number(log.outputValue) > 0) {
    return { modality, outputType: meta.outputType, outputValue: Number(log.outputValue) };
  }
  if (meta.outputType === 'watts' && Number.isFinite(Number(log.avgWatts)) && Number(log.avgWatts) > 0) {
    return { modality, outputType: 'watts', outputValue: Number(log.avgWatts) };
  }
  if (Number.isFinite(Number(log.distance)) && Number(log.distance) > 0) {
    return { modality: MODALITY_RUNNING, outputType: 'distance', outputValue: Number(log.distance) };
  }
  return { modality, outputType: meta.outputType, outputValue: null };
}
