/**
 * Cardio Output / modality continuity smoke checks.
 * Run: node scripts/modality-performance-smoke.mjs
 *
 * This is NOT the coach-facing composite Performance Index.
 * It verifies cross-modality Cardio Output continuity (watts inherit index).
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

const cardio = buildPerformanceContinuity(sessions);
assert(cardio.index != null, 'expected a cardio output index');
assert(cardio.modalityCount === 2, 'expected running + assault bike baselines');
assert(cardio.index > 108, `expected continuity well above 100 after bike improvement, got ${cardio.index}`);

// First bike session establishes baseline at inherited running level; second bike session may move.
const firstBike = cardio.points.find((row) => row.modality === MODALITY_ASSAULT_BIKE);
assert(firstBike?.establishingBaseline === true, 'first bike session should establish modality baseline');
assert(firstBike.index > 105, `new modality should inherit prior running index, got ${firstBike.index}`);

const bikeBaseline = cardio.baselines.find((row) => row.modality === MODALITY_ASSAULT_BIKE);
assert(bikeBaseline, 'missing assault bike baseline');
assert(bikeBaseline.baselinePerformanceIndex > 105, `bike baseline index should inherit running level, got ${bikeBaseline.baselinePerformanceIndex}`);
assert(bikeBaseline.baselineSessions === 1, 'first valid session establishes the modality baseline');

// Second session in a modality can move immediately (no two-session lock).
const early = buildPerformanceContinuity([
  { status: 'logged', type: 'Benchmark Run', modality: 'running', weekIndex: 0, workoutIndex: 1, minutes: 30, distance: 2.90, avgBpm: 137, targetBPM: 137 },
  { status: 'logged', type: 'Benchmark Run', modality: 'running', weekIndex: 1, workoutIndex: 1, minutes: 30, distance: 3.045, avgBpm: 137, targetBPM: 137 },
]);
assert(early.points[0].index === 100, 'first observation is baseline 100');
assert(early.points[1].index > 100, `second observation must move immediately, got ${early.points[1].index}`);

console.log('modality-performance-smoke: ok');
console.log(`cardioIndex=${cardio.index} modalities=${cardio.modalityCount} bikeBaselineIndex=${bikeBaseline.baselinePerformanceIndex}`);
