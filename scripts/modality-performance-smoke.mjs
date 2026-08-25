/**
 * Quick sanity checks for modality performance continuity.
 * Run: node scripts/modality-performance-smoke.mjs
 */

import {
  buildPerformanceContinuity,
  buildWorkoutLogModalityFields,
  MODALITY_ASSAULT_BIKE,
  MODALITY_RUNNING,
  readOutputFromWorkoutLog,
} from '../src/modality.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runningLog = buildWorkoutLogModalityFields(MODALITY_RUNNING, 3.35);
assert(runningLog.distance === 3.35, 'running should store distance');
assert(runningLog.avgWatts == null, 'running should not store watts');

const bikeLog = buildWorkoutLogModalityFields(MODALITY_ASSAULT_BIKE, 184);
assert(bikeLog.avgWatts === 184, 'bike should store watts');
assert(bikeLog.distance == null, 'bike should not store fake miles');

const legacy = readOutputFromWorkoutLog({ distance: 3.1 });
assert(legacy.modality === MODALITY_RUNNING, 'legacy distance logs default to running');

const sessions = [
  { status: 'logged', type: 'Benchmark Run', modality: 'running', weekIndex: 0, workoutIndex: 1, minutes: 30, distance: 2.85, avgBpm: 137, targetBPM: 137 },
  { status: 'logged', type: 'Benchmark Run', modality: 'running', weekIndex: 1, workoutIndex: 1, minutes: 30, distance: 2.98, avgBpm: 136, targetBPM: 137 },
  { status: 'logged', type: 'Benchmark Run', modality: 'running', weekIndex: 2, workoutIndex: 1, minutes: 30, distance: 3.10, avgBpm: 137, targetBPM: 137 },
  { status: 'logged', type: 'Benchmark Run', modality: 'assault_bike', weekIndex: 3, workoutIndex: 1, minutes: 30, outputValue: 179, avgWatts: 179, avgBpm: 137, targetBPM: 137 },
  { status: 'logged', type: 'Easy Run', modality: 'assault_bike', weekIndex: 3, workoutIndex: 3, minutes: 20, outputValue: 185, avgWatts: 185, avgBpm: 138, targetBPM: 137 },
  { status: 'logged', type: 'Benchmark Run', modality: 'assault_bike', weekIndex: 4, workoutIndex: 1, minutes: 30, outputValue: 191, avgWatts: 191, avgBpm: 136, targetBPM: 137 },
];

const performance = buildPerformanceContinuity(sessions);
assert(performance.index != null, 'expected a performance index');
assert(performance.modalityCount === 2, 'expected running + assault bike baselines');
assert(performance.index > 108, `expected continuity well above 100 after bike improvement, got ${performance.index}`);

const bikeBaseline = performance.baselines.find((row) => row.modality === MODALITY_ASSAULT_BIKE);
assert(bikeBaseline, 'missing assault bike baseline');
assert(bikeBaseline.baselinePerformanceIndex > 105, `new modality should inherit prior running index, got ${bikeBaseline.baselinePerformanceIndex}`);

console.log('modality-performance-smoke: ok');
console.log(`index=${performance.index} modalities=${performance.modalityCount} bikeBaselineIndex=${bikeBaseline.baselinePerformanceIndex}`);
