#!/usr/bin/env node
/**
 * Live Supabase recovery check for unfinished Sprint sessions.
 *
 * Inserts a sprint_sessions row whose session_json lacks workoutContext,
 * then confirms client mapping still recovers it by relational week/workout.
 *
 * Required env:
 *   RING_READY_SUPABASE_URL
 *   RING_READY_SUPABASE_ANON_KEY
 *   RING_READY_TEST_EMAIL
 *   RING_READY_TEST_PASSWORD
 *
 * Set RING_READY_REQUIRE_PROOF_TESTS=1 to fail instead of skip when credentials are missing.
 */

import { createClient } from '@supabase/supabase-js';
import { mapCloudSprintSessionRow } from '../src/cloud-record-mapper.js';
import {
  getLatestSprintSessionForWorkout,
  sprintSessionMatchesWorkout,
} from '../src/sprint-session-access.js';

const url = process.env.RING_READY_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey = process.env.RING_READY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const email = process.env.RING_READY_TEST_EMAIL || '';
const password = process.env.RING_READY_TEST_PASSWORD || '';
const requireTests = process.env.RING_READY_REQUIRE_PROOF_TESTS === '1';

const MAX_REAL_PROGRAM_WEEK_INDEX = 6;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  if (!url || !anonKey || !email || !password) {
    const message = 'Missing RING_READY_SUPABASE_URL, RING_READY_SUPABASE_ANON_KEY, RING_READY_TEST_EMAIL, or RING_READY_TEST_PASSWORD';
    if (requireTests) {
      console.error(`FAIL: ${message}`);
      process.exit(1);
    }
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }

  const client = createClient(url, anonKey);
  const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Sign-in failed: ${authError.message}`);
  const user = authData?.user;
  assert(user?.id, 'Authenticated user required');

  const weekIndex = 100000 + (Date.now() % 100000);
  const workoutIndex = 0;
  assert(weekIndex > MAX_REAL_PROGRAM_WEEK_INDEX, `Test week ${weekIndex} must stay outside 0..${MAX_REAL_PROGRAM_WEEK_INDEX}`);
  const sessionId = `recovery-test:${Date.now()}`;
  const payload = {
    user_id: user.id,
    session_id: sessionId,
    session_at: new Date().toISOString(),
    week_index: weekIndex,
    workout_index: workoutIndex,
    workout_type: 'Sprint Intervals',
    intervals_completed: 1,
    avg_drop: 32,
    peak_hr: 176,
    session_json: {
      id: sessionId,
      data: [{ sprintHR: 176, restHR: 144, drop: 32, suspicious: false }],
    },
  };

  try {
    const { error: insertError } = await client.from('sprint_sessions').insert(payload);
    if (insertError) throw new Error(`sprint_sessions insert failed: ${insertError.message}`);

    const { data: rows, error: selectError } = await client
      .from('sprint_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('session_id', sessionId)
      .limit(1);
    if (selectError) throw new Error(`sprint_sessions select failed: ${selectError.message}`);

    const mapped = mapCloudSprintSessionRow(rows?.[0]);
    assert(mapped?.id === sessionId, 'Mapped session id must match the inserted row');
    assert((mapped.weekIndex ?? mapped.week_index) === weekIndex, 'Relational week_index must survive mapping');
    assert((mapped.workoutIndex ?? mapped.workout_index) === workoutIndex, 'Relational workout_index must survive mapping');
    assert(sprintSessionMatchesWorkout(mapped, weekIndex, workoutIndex), 'Mapped row must match its assigned workout');
    assert(
      getLatestSprintSessionForWorkout([mapped], weekIndex, workoutIndex)?.id === sessionId,
      'Hydrated history must recover the assigned Sprint',
    );
    assert(
      getLatestSprintSessionForWorkout([mapped], 0, 0) == null,
      'Week 4-or-test Sprint must never satisfy Week 1',
    );
    console.log('PASS: live sprint_sessions cloud-only recovery');
  } finally {
    const { error: deleteError } = await client
      .from('sprint_sessions')
      .delete()
      .eq('user_id', user.id)
      .eq('session_id', sessionId);
    if (deleteError) {
      throw new Error(`sprint_sessions cleanup failed: ${deleteError.message}`);
    }
  }
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
