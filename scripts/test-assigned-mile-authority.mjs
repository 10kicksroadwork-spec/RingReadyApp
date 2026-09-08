#!/usr/bin/env node
/**
 * Real multi-context Assigned Mile authority races (staging RPC contract).
 *
 * Uses two authenticated Supabase clients for the SAME athlete.
 * Requires migrations 019 + 020 applied on the target database (staging only).
 *
 * Env:
 *   RING_READY_SUPABASE_URL / RING_READY_SUPABASE_ANON_KEY
 *   RING_READY_TEST_EMAIL / RING_READY_TEST_PASSWORD
 *   RING_READY_REQUIRE_PROOF_TESTS=1 (or RING_READY_REQUIRE_MILE_AUTHORITY_TESTS=1)
 *     to fail closed when missing creds/RPCs
 *
 * DO NOT apply 019/020 to production from this script.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.RING_READY_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey = process.env.RING_READY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const email = process.env.RING_READY_TEST_EMAIL || '';
const password = process.env.RING_READY_TEST_PASSWORD || '';
const requireTests = process.env.RING_READY_REQUIRE_PROOF_TESTS === '1'
  || process.env.RING_READY_REQUIRE_MILE_AUTHORITY_TESTS === '1';

const MAX_REAL_PROGRAM_WEEK_INDEX = 6;
const testSlotBase = 200000 + (Date.now() % 100000000);
let nextOffset = 0;

function allocSlot() {
  const weekIndex = testSlotBase + nextOffset;
  nextOffset += 1;
  if (weekIndex <= MAX_REAL_PROGRAM_WEEK_INDEX) {
    throw new Error('test week collided with real program domain');
  }
  return {
    weekIndex,
    workoutIndex: 0,
    completionKey: `${weekIndex}:0`,
    testKey: `program:7:${weekIndex}:0`,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function signIn(label) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label} sign-in failed: ${error.message}`);
  return { client, userId: data.user.id };
}

async function cleanupSlot(client, userId, slot) {
  await client.from('mile_tests').delete().eq('user_id', userId).eq('test_key', slot.testKey);
  await client.from('workout_completions').delete().eq('user_id', userId).eq('completion_key', slot.completionKey);
  await client.from('workout_completions').delete().eq('user_id', userId)
    .eq('week_index', slot.weekIndex).eq('workout_index', slot.workoutIndex);
}

async function readCanonical(client, userId, slot) {
  const [{ data: completion }, { data: mile }] = await Promise.all([
    client.from('workout_completions').select('*')
      .eq('user_id', userId).eq('completion_key', slot.completionKey).maybeSingle(),
    client.from('mile_tests').select('*')
      .eq('user_id', userId).eq('test_key', slot.testKey).maybeSingle(),
  ]);
  let status = null;
  if (!completion) status = null;
  else if (
    completion.record_json?.status === 'skipped'
    || completion.record_json?.workoutLog?.status === 'skipped'
    || completion.record_json?.type === 'daily-workout-skip'
  ) status = 'skipped';
  else status = 'completed';
  return { completion, mile, status };
}

function assertConsistentTruth(truth, label) {
  const { completion, mile, status } = truth;
  if (!completion && !mile) return; // cleared / absent
  assert(!!completion, `${label}: mile detail without canonical assignment is illegal`);
  if (status === 'skipped') {
    assert(!mile, `${label}: SKIPPED must not coexist with mile_tests detail`);
  } else {
    assert(status === 'completed', `${label}: unexpected status ${status}`);
    assert(!!mile, `${label}: completed assignment must have mile_tests detail`);
    assert(Number(mile.distance) > 0, `${label}: mile distance missing`);
  }
}

async function saveAssigned(client, slot, clientRecordId, values = {}) {
  const savedAt = values.savedAt || new Date().toISOString();
  const record = {
    id: clientRecordId,
    testKey: slot.testKey,
    status: 'completed',
    type: 'daily-workout-completion',
    completedAt: savedAt,
    workoutContext: {
      weekIndex: slot.weekIndex,
      workoutIndex: slot.workoutIndex,
      workoutType: 'Mile Re-Test',
    },
    cfg: {
      workoutContext: {
        weekIndex: slot.weekIndex,
        workoutIndex: slot.workoutIndex,
        workoutType: 'Mile Re-Test',
      },
    },
    workoutLog: {
      distance: values.distance ?? 1,
      totalMinutes: values.totalMinutes ?? 7.5,
      totalSeconds: values.totalSeconds ?? 450,
      avgBpm: values.avgBpm ?? 150,
      maxBpm: values.maxBpm ?? 170,
      completedAt: savedAt,
    },
  };
  return client.rpc('save_assigned_mile_result', {
    p_test_key: slot.testKey,
    p_week_index: slot.weekIndex,
    p_workout_index: slot.workoutIndex,
    p_client_record_id: clientRecordId,
    p_distance: values.distance ?? 1,
    p_total_minutes: values.totalMinutes ?? 7.5,
    p_total_seconds: values.totalSeconds ?? 450,
    p_avg_bpm: values.avgBpm ?? 150,
    p_max_bpm: values.maxBpm ?? 170,
    p_pace_min_per_mile: values.totalMinutes ?? 7.5,
    p_saved_at: savedAt,
    p_attachment_id: null,
    p_proof_policy_version: 1,
    p_result_json: {
      id: clientRecordId,
      testKey: slot.testKey,
      distance: values.distance ?? 1,
      totalMinutes: values.totalMinutes ?? 7.5,
      avgBpm: values.avgBpm ?? 150,
      maxBpm: values.maxBpm ?? 170,
      savedAt,
    },
    p_hr_info_json: null,
    p_test_context_json: {
      testKey: slot.testKey,
      weekIndex: slot.weekIndex,
      workoutIndex: slot.workoutIndex,
    },
    p_record_json: record,
    p_week_label: 'Week Test',
    p_week_title: 'Authority',
    p_day_of_week: 'Saturday/Sunday',
    p_workout_type: 'Mile Re-Test',
    p_description: 'Assigned mile authority race',
    p_warmup: '',
    p_target_zone: '95-100%',
    p_target_bpm: 178,
    p_modality: 'running',
    p_output_type: 'distance',
    p_output_value: values.distance ?? 1,
  });
}

async function skipAssigned(client, slot, clientRecordId) {
  const completedAt = new Date().toISOString();
  const record = {
    id: clientRecordId,
    status: 'skipped',
    type: 'daily-workout-skip',
    completedAt,
    workoutContext: { weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex },
    cfg: { workoutContext: { weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex } },
    workoutLog: {
      status: 'skipped',
      skipReason: 'injury',
      skipReasonLabel: 'Injury / medical',
      coachApproved: true,
      completedAt,
    },
  };
  return client.rpc('skip_assigned_mile', {
    p_test_key: slot.testKey,
    p_week_index: slot.weekIndex,
    p_workout_index: slot.workoutIndex,
    p_client_record_id: clientRecordId,
    p_record_json: record,
    p_week_label: 'Week Test',
    p_week_title: 'Authority',
    p_day_of_week: 'Saturday/Sunday',
    p_workout_type: 'Mile Re-Test',
    p_description: 'Assigned mile authority race',
    p_warmup: '',
    p_target_zone: '95-100%',
    p_target_bpm: 178,
    p_completed_at: completedAt,
  });
}

async function clearAssigned(client, slot) {
  return client.rpc('clear_assigned_mile_with_proof', {
    p_test_key: slot.testKey,
    p_week_index: slot.weekIndex,
    p_workout_index: slot.workoutIndex,
    p_attachment_id: null,
  });
}

async function assertFreshClientsAgree(a, b, third, slot, label) {
  const truthA = await readCanonical(a.client, a.userId, slot);
  const truthB = await readCanonical(b.client, b.userId, slot);
  const truthC = await readCanonical(third.client, third.userId, slot);
  assertConsistentTruth(truthA, `${label} A`);
  assertConsistentTruth(truthB, `${label} B`);
  assertConsistentTruth(truthC, `${label} C`);
  assert(truthA.status === truthB.status && truthA.status === truthC.status, `${label}: status divergence`);
  assert(!!truthA.mile === !!truthB.mile && !!truthA.mile === !!truthC.mile, `${label}: mile divergence`);
  return truthC;
}

async function main() {
  if (!url || !anonKey || !email || !password) {
    const msg = 'Missing RING_READY_* credentials for assigned mile authority races';
    if (requireTests) throw new Error(msg);
    console.log(`SKIP: ${msg}`);
    return;
  }

  const a = await signIn('client-A');
  const b = await signIn('client-B');
  assert(a.userId === b.userId, 'both clients must authenticate the same athlete');
  const third = await signIn('client-C');

  {
    const probeSlot = allocSlot();
    const { error } = await saveAssigned(a.client, probeSlot, randomUUID(), { distance: 1 });
    await cleanupSlot(a.client, a.userId, probeSlot).catch(() => {});
    if (error) {
      const missing = /Could not find the function|schema cache/i.test(error.message || '');
      if (missing) {
        const msg = 'Assigned Mile RPCs (019/020) not present on target DB — staging-only contract';
        if (requireTests) throw new Error(msg);
        console.log(`SKIP: ${msg}`);
        return;
      }
      throw error;
    }
  }

  for (const order of ['save-then-skip', 'skip-then-save']) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const saveId = randomUUID();
    const skipId = randomUUID();
    if (order === 'save-then-skip') {
      assert(!(await saveAssigned(a.client, slot, saveId)).error, 'save failed');
      assert(!(await skipAssigned(b.client, slot, skipId)).error, 'skip failed');
    } else {
      assert(!(await skipAssigned(b.client, slot, skipId)).error, 'skip failed');
      assert(!(await saveAssigned(a.client, slot, saveId)).error, 'save failed');
    }
    const truth = await assertFreshClientsAgree(a, b, third, slot, order);
    assert(truth.status === 'skipped' || truth.status === 'completed', `${order}: missing outcome`);
    console.log(`PASS Save/Skip ${order}: canonical=${truth.status}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (const order of ['clear-then-stale-save', 'stale-save-then-clear']) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const originalId = randomUUID();
    assert(!(await saveAssigned(a.client, slot, originalId, { totalMinutes: 8 })).error, 'seed save failed');
    if (order === 'clear-then-stale-save') {
      assert(!(await clearAssigned(b.client, slot)).error, 'clear failed');
      // Stale/lost-response save after clear: may recreate completed, but must stay consistent.
      assert(!(await saveAssigned(a.client, slot, originalId, { totalMinutes: 8.1 })).error, 'stale save failed');
      const truth = await assertFreshClientsAgree(a, b, third, slot, order);
      assertConsistentTruth(truth, order);
    } else {
      assert(!(await saveAssigned(a.client, slot, originalId, { totalMinutes: 8.2 })).error, 'stale save failed');
      assert(!(await clearAssigned(b.client, slot)).error, 'clear failed');
      const truth = await assertFreshClientsAgree(a, b, third, slot, order);
      assert(!truth.completion && !truth.mile, `${order}: clear must leave absent assignment+detail`);
    }
    console.log(`PASS Clear/Save ${order}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const id = randomUUID();
    assert(!(await saveAssigned(a.client, slot, id, { totalMinutes: 7.1 })).error, 'first save failed');
    assert(!(await saveAssigned(b.client, slot, id, { totalMinutes: 7.1 })).error, 'retry save failed');
    const truth = await assertFreshClientsAgree(a, b, third, slot, 'lost-response-retry');
    assert(truth.status === 'completed', 'retry must leave completed');
    const { data: miles, error: mileErr } = await third.client.from('mile_tests')
      .select('id,test_key,client_record_id')
      .eq('user_id', third.userId)
      .eq('test_key', slot.testKey);
    assert(!mileErr, mileErr?.message);
    assert(miles.length === 1, `retry must leave exactly one mile_tests row, got ${miles.length}`);
    const { data: completions, error: cErr } = await third.client.from('workout_completions')
      .select('id,completion_key,client_record_id')
      .eq('user_id', third.userId)
      .eq('completion_key', slot.completionKey);
    assert(!cErr, cErr?.message);
    assert(completions.length === 1, `retry must leave exactly one completion row, got ${completions.length}`);
    assert(completions[0].client_record_id === id, 'completion client_record_id must match retry identity');
    assert(miles[0].client_record_id === id, 'mile client_record_id must match retry identity');
    console.log('PASS lost-response Save retry → single logical completion');
    await cleanupSlot(a.client, a.userId, slot);
  }

  console.log('\nPASS: assigned mile multi-context authority races');
}

main().catch((error) => {
  console.error('FAIL:', error.message || error);
  process.exitCode = 1;
});
