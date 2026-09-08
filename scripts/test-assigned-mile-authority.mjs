#!/usr/bin/env node
/**
 * Real multi-context Assigned Mile authority races (staging RPC contract).
 *
 * Uses independently authenticated Supabase clients for the SAME athlete and
 * launches overlapping Save/Skip/Clear mutations concurrently.
 * Requires migrations 019 + 020 + 021 applied on the target database (staging only).
 *
 * Env:
 *   RING_READY_SUPABASE_URL / RING_READY_SUPABASE_ANON_KEY
 *   RING_READY_TEST_EMAIL / RING_READY_TEST_PASSWORD
 *   RING_READY_REQUIRE_PROOF_TESTS=1 (or RING_READY_REQUIRE_MILE_AUTHORITY_TESTS=1)
 *     to fail closed when missing creds/RPCs
 *
 * DO NOT apply 019/020/021 to production from this script.
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
const CONCURRENT_ROUNDS = Number(process.env.RING_READY_MILE_RACE_ROUNDS || 8);
const testSlotBase = 300000 + (Date.now() % 100000000);
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
  const [{ data: byKey }, { data: byPosition }, { data: mile }] = await Promise.all([
    client.from('workout_completions').select('*')
      .eq('user_id', userId).eq('completion_key', slot.completionKey).maybeSingle(),
    client.from('workout_completions').select('*')
      .eq('user_id', userId)
      .eq('week_index', slot.weekIndex).eq('workout_index', slot.workoutIndex).maybeSingle(),
    client.from('mile_tests').select('*')
      .eq('user_id', userId).eq('test_key', slot.testKey).maybeSingle(),
  ]);
  if (byKey && byPosition && byKey.id !== byPosition.id) {
    throw new Error('dual WC identity rows for same assignment');
  }
  const completion = byKey || byPosition;
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
    assert(!completion.attachment_id, `${label}: SKIPPED must retire attachment_id`);
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

// Stale/legacy client path: generic clear must join the same assignment authority.
async function clearGeneric(client, slot) {
  return client.rpc('clear_workout_completion_with_proof', {
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

async function runConcurrentPair(label, launchA, launchB, a, b, third, slot) {
  const settled = await Promise.allSettled([launchA(), launchB()]);
  const failures = settled.filter((entry) => entry.status === 'rejected'
    || (entry.status === 'fulfilled' && entry.value?.error));
  // Serialized valid transitions must both fulfill; a rejected request is an athlete error.
  if (failures.length > 0) {
    const reason = failures[0].status === 'rejected'
      ? failures[0].reason?.message
      : failures[0].value?.error?.message;
    throw new Error(`${label}: concurrent mutation failed (${reason || 'unknown'})`);
  }
  return assertFreshClientsAgree(a, b, third, slot, label);
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
        const msg = 'Assigned Mile RPCs (019/020/021) not present on target DB — staging-only contract';
        if (requireTests) throw new Error(msg);
        console.log(`SKIP: ${msg}`);
        return;
      }
      throw error;
    }
  }

  for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const saveId = randomUUID();
    const skipId = randomUUID();
    const truth = await runConcurrentPair(
      `Save||Skip#${round}`,
      () => saveAssigned(a.client, slot, saveId, { totalMinutes: 7 + (round % 3) * 0.1 }),
      () => skipAssigned(b.client, slot, skipId),
      a,
      b,
      third,
      slot,
    );
    assert(truth.status === 'skipped' || truth.status === 'completed', `Save||Skip#${round}: missing outcome`);
    console.log(`PASS concurrent Save||Skip#${round}: canonical=${truth.status}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const saveId = randomUUID();
    assert(!(await saveAssigned(a.client, slot, saveId, { totalMinutes: 8 })).error, 'seed save failed');
    const truth = await runConcurrentPair(
      `Save||Clear#${round}`,
      () => saveAssigned(a.client, slot, saveId, { totalMinutes: 8.1 + round * 0.01 }),
      () => clearAssigned(b.client, slot),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `Save||Clear#${round}`);
    console.log(`PASS concurrent Save||Clear#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const saveId = randomUUID();
    assert(!(await saveAssigned(a.client, slot, saveId, { totalMinutes: 8 })).error, 'seed save failed');
    const truth = await runConcurrentPair(
      `Save||genericClear#${round}`,
      () => saveAssigned(a.client, slot, saveId, { totalMinutes: 8.3 + round * 0.01 }),
      () => clearGeneric(b.client, slot),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `Save||genericClear#${round}`);
    console.log(`PASS concurrent Save||genericClear#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < Math.max(4, Math.floor(CONCURRENT_ROUNDS / 2)); round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const skipId = randomUUID();
    assert(!(await skipAssigned(a.client, slot, skipId)).error, 'seed skip failed');
    const truth = await runConcurrentPair(
      `Skip||genericClear#${round}`,
      () => skipAssigned(a.client, slot, skipId),
      () => clearGeneric(b.client, slot),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `Skip||genericClear#${round}`);
    console.log(`PASS concurrent Skip||genericClear#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < Math.max(4, Math.floor(CONCURRENT_ROUNDS / 2)); round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const skipId = randomUUID();
    const saveId = randomUUID();
    assert(!(await skipAssigned(a.client, slot, skipId)).error, 'seed skip failed');
    const truth = await runConcurrentPair(
      `Save||genericClearFromSkipped#${round}`,
      () => saveAssigned(a.client, slot, saveId, { totalMinutes: 8.5 }),
      () => clearGeneric(b.client, slot),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `Save||genericClearFromSkipped#${round}`);
    console.log(`PASS concurrent Save||genericClearFromSkipped#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < CONCURRENT_ROUNDS; round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const originalId = randomUUID();
    assert(!(await saveAssigned(a.client, slot, originalId, { totalMinutes: 8 })).error, 'seed save failed');
    const truth = await runConcurrentPair(
      `Clear||staleSave#${round}`,
      () => clearAssigned(b.client, slot),
      () => saveAssigned(a.client, slot, originalId, { totalMinutes: 8.2 }),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `Clear||staleSave#${round}`);
    console.log(`PASS concurrent Clear||staleSave#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < Math.max(4, Math.floor(CONCURRENT_ROUNDS / 2)); round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const idA = randomUUID();
    const idB = randomUUID();
    const truth = await runConcurrentPair(
      `Save||staleSave#${round}`,
      () => saveAssigned(a.client, slot, idA, { totalMinutes: 7.1, avgBpm: 140 }),
      () => saveAssigned(b.client, slot, idB, { totalMinutes: 7.4, avgBpm: 155 }),
      a,
      b,
      third,
      slot,
    );
    assert(truth.status === 'completed', `Save||staleSave#${round}: must complete`);
    assert(!!truth.mile, `Save||staleSave#${round}: mile required`);
    console.log(`PASS concurrent Save||staleSave#${round}`);
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

  for (const op of ['save', 'skip']) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const legacyId = randomUUID();
    const { error: seedErr } = await a.client.from('workout_completions').insert({
      user_id: a.userId,
      client_record_id: legacyId,
      completion_key: `legacy-stale-${legacyId}`,
      week_index: slot.weekIndex,
      workout_index: slot.workoutIndex,
      week_label: 'Legacy',
      week_title: 'Stale key',
      day_of_week: 'Saturday/Sunday',
      workout_type: 'Mile Re-Test',
      description: 'legacy position row',
      completed_at: new Date().toISOString(),
      record_json: {
        id: legacyId,
        status: 'completed',
        type: 'daily-workout-completion',
        workoutContext: { weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex },
      },
    });
    assert(!seedErr, `legacy seed failed: ${seedErr?.message}`);

    if (op === 'save') {
      const saveId = randomUUID();
      const { error } = await saveAssigned(a.client, slot, saveId, { totalMinutes: 6.9 });
      assert(!error, `legacy Save failed: ${error?.message}`);
      const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-save');
      assert(truth.status === 'completed', 'legacy Save must complete');
      assert(truth.completion.completion_key === slot.completionKey, 'legacy Save must rewrite completion_key');
      assert(!!truth.mile, 'legacy Save must write mile detail');
      const { count, error: countErr } = await third.client.from('workout_completions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', third.userId)
        .eq('week_index', slot.weekIndex)
        .eq('workout_index', slot.workoutIndex);
      assert(!countErr, countErr?.message);
      assert(count === 1, `legacy Save must leave one position row, got ${count}`);
      console.log('PASS legacy-position Save');
    } else {
      const skipId = randomUUID();
      const { error } = await skipAssigned(a.client, slot, skipId);
      assert(!error, `legacy Skip failed: ${error?.message}`);
      const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-skip');
      assert(truth.status === 'skipped', 'legacy Skip must skip');
      assert(truth.completion.completion_key === slot.completionKey, 'legacy Skip must rewrite completion_key');
      assert(!truth.mile, 'legacy Skip must remove mile detail');
      console.log('PASS legacy-position Skip');
    }
    await cleanupSlot(a.client, a.userId, slot);
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const idA = randomUUID();
    const idB = randomUUID();
    const wrongWeek = slot.weekIndex - 1;
    const savedAt = new Date().toISOString();
    const mileRecord = {
      user_id: a.userId,
      test_key: slot.testKey,
      client_record_id: idB,
      distance: 1,
      total_minutes: 7.5,
      total_seconds: 450,
      avg_bpm: 150,
      max_bpm: 170,
      saved_at: savedAt,
      result_json: { testKey: slot.testKey, distance: 1, totalMinutes: 7.5 },
      test_context_json: { testKey: slot.testKey, weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex },
    };
    const completionBase = {
      user_id: a.userId,
      week_label: 'Week Test',
      week_title: 'Authority',
      day_of_week: 'Saturday/Sunday',
      workout_type: 'Mile Re-Test',
      description: 'dual identity contract',
      completed_at: savedAt,
      distance: 1,
      total_minutes: 7.5,
      total_seconds: 450,
      avg_bpm: 150,
      max_bpm: 170,
      modality: 'running',
      output_type: 'distance',
      output_value: 1,
      record_json: {
        status: 'completed',
        type: 'daily-workout-completion',
        workoutContext: { weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex },
      },
    };
    const { error: seedAErr } = await a.client.from('workout_completions').insert({
      ...completionBase,
      client_record_id: idA,
      completion_key: slot.completionKey,
      week_index: wrongWeek,
      workout_index: slot.workoutIndex,
      record_json: {
        ...completionBase.record_json,
        id: idA,
        workoutContext: { weekIndex: wrongWeek, workoutIndex: slot.workoutIndex },
      },
    });
    assert(!seedAErr, `dual-identity row A seed failed: ${seedAErr?.message}`);
    const { error: seedBErr } = await a.client.from('workout_completions').insert({
      ...completionBase,
      client_record_id: idB,
      completion_key: `legacy-stale-${idB}`,
      week_index: slot.weekIndex,
      workout_index: slot.workoutIndex,
      record_json: { ...completionBase.record_json, id: idB },
    });
    assert(!seedBErr, `dual-identity row B seed failed: ${seedBErr?.message}`);
    const { error: seedMileErr } = await a.client.from('mile_tests').insert(mileRecord);
    assert(!seedMileErr, `dual-identity mile seed failed: ${seedMileErr?.message}`);

    const { data: rowBBefore, error: rowBBeforeErr } = await a.client.from('workout_completions')
      .select('id,completion_key,week_index,workout_index')
      .eq('user_id', a.userId)
      .eq('week_index', slot.weekIndex)
      .eq('workout_index', slot.workoutIndex)
      .maybeSingle();
    assert(!rowBBeforeErr, rowBBeforeErr?.message);
    assert(rowBBefore?.id, 'row B must exist at target position before generic clear');
    const { data: mileBefore, error: mileBeforeErr } = await a.client.from('mile_tests')
      .select('id,test_key')
      .eq('user_id', a.userId)
      .eq('test_key', slot.testKey)
      .maybeSingle();
    assert(!mileBeforeErr, mileBeforeErr?.message);
    assert(mileBefore?.id, 'mile detail must exist before generic clear');

    const { error: clearErr } = await clearGeneric(a.client, slot);
    assert(clearErr, 'generic clear must fail closed on dual semantic identity');
    assert(/identity conflict/i.test(clearErr.message || ''), `expected identity conflict, got: ${clearErr.message}`);

    const { data: rowBAfter, error: rowBAfterErr } = await a.client.from('workout_completions')
      .select('id,completion_key,week_index,workout_index')
      .eq('user_id', a.userId)
      .eq('week_index', slot.weekIndex)
      .eq('workout_index', slot.workoutIndex)
      .maybeSingle();
    assert(!rowBAfterErr, rowBAfterErr?.message);
    assert(rowBAfter?.id === rowBBefore.id, 'positional completion must survive failed generic clear');
    const { data: mileAfter, error: mileAfterErr } = await a.client.from('mile_tests')
      .select('id,test_key')
      .eq('user_id', a.userId)
      .eq('test_key', slot.testKey)
      .maybeSingle();
    assert(!mileAfterErr, mileAfterErr?.message);
    assert(mileAfter?.id === mileBefore.id, 'mile detail must survive failed generic clear');
    const { count: rowCount, error: countErr } = await third.client.from('workout_completions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', third.userId)
      .or(`completion_key.eq.${slot.completionKey},and(week_index.eq.${slot.weekIndex},workout_index.eq.${slot.workoutIndex})`);
    assert(!countErr, countErr?.message);
    assert(rowCount === 2, `both conflicting WC rows must remain, got ${rowCount}`);
    console.log('PASS cross-identity generic clear fails closed');

    const ordinarySlot = allocSlot();
    await cleanupSlot(a.client, a.userId, ordinarySlot);
    const ordinaryId = randomUUID();
    assert(!(await saveAssigned(a.client, ordinarySlot, ordinaryId, { totalMinutes: 7.2 })).error, 'ordinary save seed failed');
    assert(!(await clearGeneric(b.client, ordinarySlot)).error, 'ordinary generic clear must still succeed');
    const cleared = await readCanonical(third.client, third.userId, ordinarySlot);
    assert(!cleared.completion && !cleared.mile, 'ordinary generic clear must remove canonical state');
    console.log('PASS ordinary generic clear still succeeds after identity contract');
    await cleanupSlot(a.client, a.userId, ordinarySlot);
    await cleanupSlot(a.client, a.userId, slot);
  }

  console.log('\nPASS: assigned mile concurrent multi-context authority races');
}

main().catch((error) => {
  console.error('FAIL:', error.message || error);
  process.exitCode = 1;
});
