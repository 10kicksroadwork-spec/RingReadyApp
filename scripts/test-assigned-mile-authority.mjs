#!/usr/bin/env node
/**
 * Real multi-context Assigned Mile authority races (staging RPC contract).
 *
 * Uses independently authenticated Supabase clients for the SAME athlete and
 * launches overlapping Save/Skip/Clear mutations concurrently.
 * Requires migrations 019 + 020 + 021 + 022 + 023 applied on the target database
 * (staging only).
 *
 * Covers three layers:
 *   1. new-client RPC races (Save / Skip / assigned Clear / generic Clear)
 *   2. assignment identity conflicts, which must fail closed and mutate nothing
 *   3. cross-version convergence: direct table writes issued by the exact
 *      production client (e85e98985709320adcb9d133dd5a6c457c86f9cc), which never
 *      calls the new RPCs, must still land in a legal committed state
 *
 * Env:
 *   RING_READY_SUPABASE_URL / RING_READY_SUPABASE_ANON_KEY
 *   RING_READY_TEST_EMAIL / RING_READY_TEST_PASSWORD
 *   RING_READY_REQUIRE_PROOF_TESTS=1 (or RING_READY_REQUIRE_MILE_AUTHORITY_TESTS=1)
 *     to fail closed when missing creds/RPCs
 *
 * DO NOT apply 019/020/021/022/023 to production from this script.
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
    p_attachment_id: values.attachmentId ?? null,
    p_proof_policy_version: values.proofPolicyVersion ?? 1,
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

/**
 * Exact production (e85e989) assigned-Mile final save: buildMileTestCloudPayload +
 * saveCloudMileTest. It writes mile_tests directly and never touches
 * workout_completions, so the server must supply the canonical completion.
 */
async function legacySaveMileDetail(client, userId, slot, values = {}) {
  const savedAt = values.savedAt || new Date().toISOString();
  const clientRecordId = values.clientRecordId || randomUUID();
  const distance = values.distance ?? 1;
  const totalMinutes = values.totalMinutes ?? 7.5;
  const totalSeconds = values.totalSeconds ?? Math.round(totalMinutes * 60);
  const result = {
    id: clientRecordId,
    testKey: slot.testKey,
    distance,
    totalMinutes,
    totalSeconds,
    avgBpm: values.avgBpm ?? 150,
    maxBpm: values.maxBpm ?? 170,
    paceMinPerMile: totalMinutes / distance,
    savedAt,
  };
  if (values.attachmentId) {
    result.attachment = values.attachment || { id: values.attachmentId };
    result.proofPolicyVersion = values.proofPolicyVersion ?? 1;
  } else if (Object.prototype.hasOwnProperty.call(values, 'attachmentId') && values.attachmentId === null) {
    // Explicit null means "no attachment in the stale payload".
  }
  return client.from('mile_tests').upsert({
    user_id: userId,
    client_record_id: clientRecordId,
    test_key: slot.testKey,
    saved_at: savedAt,
    distance,
    total_minutes: totalMinutes,
    total_seconds: totalSeconds,
    pace_min_per_mile: result.paceMinPerMile,
    avg_bpm: result.avgBpm,
    max_bpm: result.maxBpm,
    proof_policy_version: values.proofPolicyVersion ?? (values.attachmentId ? 1 : null),
    attachment_id: values.attachmentId ?? null,
    proof_pending: false,
    result_json: result,
    hr_info_json: null,
    test_context_json: {
      testKey: slot.testKey,
      weekIndex: slot.weekIndex,
      workoutIndex: slot.workoutIndex,
      weekLabel: 'Week Test',
      weekTitle: 'Authority',
      dayOfWeek: 'Saturday/Sunday',
      workoutType: 'Mile Re-Test',
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,test_key' });
}

/**
 * Exact production (e85e989) Workout Detail skip: buildWorkoutCloudPayload upserted
 * straight into workout_completions with no knowledge of skip_assigned_mile().
 */
async function legacySkipWorkout(client, userId, slot, clientRecordId) {
  const completedAt = new Date().toISOString();
  const context = {
    weekIndex: slot.weekIndex,
    workoutIndex: slot.workoutIndex,
    weekLabel: 'Week Test',
    weekTitle: 'Authority',
    dayOfWeek: 'Saturday/Sunday',
    workoutType: 'Mile Re-Test',
    description: 'legacy client skip',
  };
  const record = {
    id: clientRecordId,
    status: 'skipped',
    type: 'daily-workout-skip',
    completedAt,
    workoutContext: context,
    cfg: { workoutContext: context },
    workoutLog: {
      status: 'skipped',
      skipReason: 'injury',
      skipReasonLabel: 'Injury / medical',
      coachApproved: true,
      completedAt,
    },
  };
  return client.from('workout_completions').upsert({
    user_id: userId,
    client_record_id: clientRecordId,
    completion_key: slot.completionKey,
    week_index: slot.weekIndex,
    workout_index: slot.workoutIndex,
    week_label: context.weekLabel,
    week_title: context.weekTitle,
    day_of_week: context.dayOfWeek,
    workout_type: context.workoutType,
    description: context.description,
    warmup: '',
    target_zone: '',
    target_bpm: null,
    total_minutes: null,
    total_seconds: null,
    avg_bpm: null,
    max_bpm: null,
    distance: null,
    completed_at: completedAt,
    proof_policy_version: null,
    attachment_id: null,
    proof_pending: false,
    record_json: record,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,completion_key' });
}

async function readPositionRow(client, userId, weekIndex, workoutIndex) {
  const { data, error } = await client.from('workout_completions')
    .select('id,completion_key,week_index,workout_index,attachment_id,record_json')
    .eq('user_id', userId)
    .eq('week_index', weekIndex)
    .eq('workout_index', workoutIndex)
    .maybeSingle();
  if (error) throw new Error(`position read failed: ${error.message}`);
  return data;
}

async function readKeyRow(client, userId, completionKey) {
  const { data, error } = await client.from('workout_completions')
    .select('id,completion_key,week_index,workout_index,attachment_id')
    .eq('user_id', userId)
    .eq('completion_key', completionKey)
    .maybeSingle();
  if (error) throw new Error(`key read failed: ${error.message}`);
  return data;
}

async function readMileRow(client, userId, slot) {
  const { data, error } = await client.from('mile_tests')
    .select('id,test_key,client_record_id,attachment_id,total_minutes,avg_bpm,proof_policy_version,result_json')
    .eq('user_id', userId)
    .eq('test_key', slot.testKey)
    .maybeSingle();
  if (error) throw new Error(`mile read failed: ${error.message}`);
  return data;
}

async function uploadProofBlob(client, storagePath) {
  const blob = new Blob([new Uint8Array(1024)], { type: 'image/webp' });
  const { error } = await client.storage.from('workout-proof-staging').upload(storagePath, blob, { upsert: true });
  if (error) throw new Error(`proof storage upload failed: ${error.message}`);
}

async function createAssignedMileProof(client, userId, slot, linkedRecordId, label) {
  const storagePath = `${userId}/${slot.testKey}/${label}-${randomUUID()}.webp`;
  await uploadProofBlob(client, storagePath);
  const { data, error } = await client.rpc('create_workout_proof_attachment', {
    p_proof_key: slot.testKey,
    p_linked_record_id: linkedRecordId,
    p_storage_path: storagePath,
    p_original_filename: `${label}.webp`,
    p_mime_type: 'image/webp',
    p_file_size: 1024,
    p_width: 64,
    p_height: 64,
    p_camp_length: 7,
    p_week_index: slot.weekIndex,
    p_workout_index: slot.workoutIndex,
    p_workout_type: 'Mile Re-Test',
    p_day_of_week: 'Saturday/Sunday',
  });
  if (error) throw new Error(`create proof ${label} failed: ${error.message}`);
  return { proof: data, storagePath };
}

async function cleanupProofArtifacts(client, attachmentIds = [], storagePaths = []) {
  if (attachmentIds.length) {
    await client.rpc('cleanup_test_workout_proof_attachments', {
      p_attachment_ids: [...new Set(attachmentIds)],
    });
  }
  if (storagePaths.length) {
    await client.storage.from('workout-proof-staging').remove([...new Set(storagePaths)]);
  }
}

function assertProofMirrorsAgree(truth, expectedAttachmentId, label) {
  assert(!!truth.completion, `${label}: missing completion`);
  assert(!!truth.mile, `${label}: missing mile detail`);
  assert(
    truth.completion.attachment_id === expectedAttachmentId,
    `${label}: WC attachment_id expected ${expectedAttachmentId}, got ${truth.completion.attachment_id}`,
  );
  assert(
    truth.mile.attachment_id === expectedAttachmentId,
    `${label}: Mile attachment_id expected ${expectedAttachmentId}, got ${truth.mile.attachment_id}`,
  );
  const wcJsonId = truth.completion.record_json?.attachment?.id || null;
  const mileJsonId = truth.mile.result_json?.attachment?.id || null;
  assert(wcJsonId === expectedAttachmentId, `${label}: WC record_json.attachment must be ${expectedAttachmentId}`);
  assert(mileJsonId === expectedAttachmentId, `${label}: Mile result_json.attachment must be ${expectedAttachmentId}`);
  assert(
    truth.completion.proof_policy_version === truth.mile.proof_policy_version,
    `${label}: proof_policy_version must agree across WC/Mile`,
  );
  assert(
    Number(truth.completion.record_json?.proofPolicyVersion) === Number(truth.completion.proof_policy_version),
    `${label}: WC record_json.proofPolicyVersion must match relational`,
  );
  assert(
    Number(truth.mile.result_json?.proofPolicyVersion) === Number(truth.mile.proof_policy_version),
    `${label}: Mile result_json.proofPolicyVersion must match relational`,
  );
}

async function assertFinalAssignedProofInvariants(client, userId, slot, label) {
  const truth = await readCanonical(client, userId, slot);
  if (!truth.completion && !truth.mile) return truth;
  assertConsistentTruth(truth, label);
  if (truth.status === 'completed') {
    assert(
      truth.completion.attachment_id === truth.mile.attachment_id,
      `${label}: WC/Mile attachment disagreement`,
    );
    const wcJsonId = truth.completion.record_json?.attachment?.id || null;
    const mileJsonId = truth.mile.result_json?.attachment?.id || null;
    assert(
      (wcJsonId || null) === (truth.completion.attachment_id || null),
      `${label}: WC relational / record_json proof disagreement`,
    );
    assert(
      (mileJsonId || null) === (truth.mile.attachment_id || null),
      `${label}: Mile relational / result_json proof disagreement`,
    );
    if (truth.completion.attachment_id) {
      const { data: proof, error } = await client.from('workout_attachments')
        .select('id,is_current,completion_cleared')
        .eq('user_id', userId)
        .eq('id', truth.completion.attachment_id)
        .maybeSingle();
      assert(!error, `${label}: proof read failed: ${error?.message}`);
      assert(proof?.is_current === true, `${label}: final assigned Mile references non-current proof`);
      assert(proof?.completion_cleared === false, `${label}: final assigned Mile references completion_cleared proof`);
    }
  }
  return truth;
}

const WRONG_WORKOUT_INDEX = 7;

/**
 * Seed a completion_key row whose stored assignment position is a DIFFERENT valid
 * assignment, using only legal writes: a legacy Mile save (server supplies the
 * canonical completion) followed by positional drift on that row.
 */
async function seedKeyRowAtWrongPosition(client, userId, slot) {
  const legacyId = randomUUID();
  const { error: mileErr } = await legacySaveMileDetail(client, userId, slot, {
    clientRecordId: legacyId,
    totalMinutes: 7.5,
  });
  assert(!mileErr, `key-position seed mile write failed: ${mileErr?.message}`);

  const seeded = await readPositionRow(client, userId, slot.weekIndex, slot.workoutIndex);
  assert(seeded?.id, 'key-position seed expected a server-converged completion');
  assert(seeded.completion_key === slot.completionKey, 'key-position seed expected canonical key');

  const { error: driftErr } = await client.from('workout_completions')
    .update({ workout_index: WRONG_WORKOUT_INDEX, updated_at: new Date().toISOString() })
    .eq('id', seeded.id)
    .eq('user_id', userId);
  assert(!driftErr, `key-position seed drift failed: ${driftErr?.message}`);
  return { keyRowId: seeded.id, legacyId };
}

async function cleanupWrongPosition(client, userId, slot) {
  await client.from('workout_completions').delete().eq('user_id', userId)
    .eq('week_index', slot.weekIndex).eq('workout_index', WRONG_WORKOUT_INDEX);
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

  // Single key row stored at a different valid assignment, with NO row at the
  // requested position. Every shared transition must fail closed.
  for (const op of ['save', 'skip', 'genericClear', 'assignedClear']) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    await cleanupWrongPosition(a.client, a.userId, slot);
    const { keyRowId } = await seedKeyRowAtWrongPosition(a.client, a.userId, slot);

    const keyBefore = await readKeyRow(third.client, third.userId, slot.completionKey);
    const mileBefore = await readMileRow(third.client, third.userId, slot);
    assert(keyBefore?.id === keyRowId, 'key row must exist before the mismatched transition');
    assert(keyBefore.workout_index === WRONG_WORKOUT_INDEX, 'key row must be stored at the wrong position');
    assert(mileBefore?.id, 'mile detail must exist before the mismatched transition');
    assert(
      !(await readPositionRow(third.client, third.userId, slot.weekIndex, slot.workoutIndex)),
      'no completion may exist at the requested position for this case',
    );

    let outcome;
    if (op === 'save') outcome = await saveAssigned(b.client, slot, randomUUID(), { totalMinutes: 6.4 });
    else if (op === 'skip') outcome = await skipAssigned(b.client, slot, randomUUID());
    else if (op === 'genericClear') outcome = await clearGeneric(b.client, slot);
    else outcome = await clearAssigned(b.client, slot);

    assert(outcome.error, `${op}: mismatched key identity must fail closed`);
    assert(
      /identity conflict/i.test(outcome.error.message || ''),
      `${op}: expected identity conflict, got: ${outcome.error.message}`,
    );

    const keyAfter = await readKeyRow(third.client, third.userId, slot.completionKey);
    const mileAfter = await readMileRow(third.client, third.userId, slot);
    assert(keyAfter?.id === keyBefore.id, `${op}: key row must be untouched`);
    assert(keyAfter.workout_index === WRONG_WORKOUT_INDEX, `${op}: key row must not be moved`);
    assert(keyAfter.attachment_id === keyBefore.attachment_id, `${op}: proof linkage must be untouched`);
    assert(mileAfter?.id === mileBefore.id, `${op}: mile detail must be untouched`);
    assert(
      !(await readPositionRow(third.client, third.userId, slot.weekIndex, slot.workoutIndex)),
      `${op}: no row may be created at the requested position`,
    );
    console.log(`PASS key-position mismatch fails closed: ${op}`);

    await cleanupWrongPosition(a.client, a.userId, slot);
    await cleanupSlot(a.client, a.userId, slot);
  }

  // Two different rows claim the same assignment (dual-row conflict).
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    await cleanupWrongPosition(a.client, a.userId, slot);
    const { keyRowId } = await seedKeyRowAtWrongPosition(a.client, a.userId, slot);

    const staleId = randomUUID();
    const { error: seedBErr } = await a.client.from('workout_completions').insert({
      user_id: a.userId,
      client_record_id: staleId,
      completion_key: `legacy-stale-${staleId}`,
      week_index: slot.weekIndex,
      workout_index: slot.workoutIndex,
      week_label: 'Legacy',
      week_title: 'Stale key',
      day_of_week: 'Saturday/Sunday',
      workout_type: 'Mile Re-Test',
      description: 'dual identity contract',
      completed_at: new Date().toISOString(),
      record_json: {
        id: staleId,
        status: 'completed',
        type: 'daily-workout-completion',
        workoutContext: { weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex },
      },
    });
    assert(!seedBErr, `dual-identity position row seed failed: ${seedBErr?.message}`);

    const positionBefore = await readPositionRow(third.client, third.userId, slot.weekIndex, slot.workoutIndex);
    const mileBefore = await readMileRow(third.client, third.userId, slot);
    assert(positionBefore?.id, 'position row must exist before generic clear');
    assert(mileBefore?.id, 'mile detail must exist before generic clear');

    const { error: clearErr } = await clearGeneric(a.client, slot);
    assert(clearErr, 'generic clear must fail closed on dual semantic identity');
    assert(/identity conflict/i.test(clearErr.message || ''), `expected identity conflict, got: ${clearErr.message}`);

    const positionAfter = await readPositionRow(third.client, third.userId, slot.weekIndex, slot.workoutIndex);
    const keyAfter = await readKeyRow(third.client, third.userId, slot.completionKey);
    const mileAfter = await readMileRow(third.client, third.userId, slot);
    assert(positionAfter?.id === positionBefore.id, 'positional completion must survive failed generic clear');
    assert(keyAfter?.id === keyRowId, 'key completion must survive failed generic clear');
    assert(mileAfter?.id === mileBefore.id, 'mile detail must survive failed generic clear');
    console.log('PASS dual-row identity generic clear fails closed');

    await cleanupWrongPosition(a.client, a.userId, slot);
    await cleanupSlot(a.client, a.userId, slot);
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    assert(!(await saveAssigned(a.client, slot, randomUUID(), { totalMinutes: 7.2 })).error, 'ordinary save seed failed');
    assert(!(await clearGeneric(b.client, slot)).error, 'ordinary generic clear must still succeed');
    const cleared = await readCanonical(third.client, third.userId, slot);
    assert(!cleared.completion && !cleared.mile, 'ordinary generic clear must remove canonical state');
    console.log('PASS ordinary generic clear still succeeds after identity contract');
    await cleanupSlot(a.client, a.userId, slot);
  }

  // Standalone baseline Mile is never assignment-scoped and must stay outside the
  // perimeter: no canonical completion is invented for it.
  {
    const baselineKey = 'mile-test:baseline';
    await a.client.from('mile_tests').delete().eq('user_id', a.userId).eq('test_key', baselineKey);
    const baselineId = randomUUID();
    const savedAt = new Date().toISOString();
    const { error } = await a.client.from('mile_tests').upsert({
      user_id: a.userId,
      client_record_id: baselineId,
      test_key: baselineKey,
      saved_at: savedAt,
      distance: 1,
      total_minutes: 7.9,
      total_seconds: 474,
      pace_min_per_mile: 7.9,
      avg_bpm: 148,
      max_bpm: 168,
      proof_pending: false,
      result_json: { id: baselineId, testKey: baselineKey, distance: 1, totalMinutes: 7.9, savedAt },
      test_context_json: { testKey: baselineKey },
      updated_at: savedAt,
    }, { onConflict: 'user_id,test_key' });
    assert(!error, `baseline Mile save failed: ${error?.message}`);

    const { data: baselineRow, error: readErr } = await third.client.from('mile_tests')
      .select('id,test_key,total_minutes')
      .eq('user_id', third.userId)
      .eq('test_key', baselineKey)
      .maybeSingle();
    assert(!readErr, readErr?.message);
    assert(baselineRow?.id, 'baseline Mile row must survive');
    assert(Number(baselineRow.total_minutes) === 7.9, 'baseline Mile metrics must survive');
    const { count: inventedCount, error: countErr } = await third.client.from('workout_completions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', third.userId)
      .is('week_index', null);
    assert(!countErr, countErr?.message);
    assert(inventedCount === 0, 'baseline Mile must not invent a canonical completion');
    console.log('PASS standalone baseline Mile stays outside the assignment perimeter');
    await a.client.from('mile_tests').delete().eq('user_id', a.userId).eq('test_key', baselineKey);
  }

  // proof_pending identity staging must remain a no-op for the state machine, and
  // its rollback delete must still work.
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const stagingId = randomUUID();
    const { error: stageErr } = await a.client.from('mile_tests').insert({
      user_id: a.userId,
      client_record_id: stagingId,
      test_key: slot.testKey,
      saved_at: null,
      distance: null,
      total_minutes: null,
      proof_pending: true,
      result_json: { id: stagingId, testKey: slot.testKey, status: 'pending_proof' },
      test_context_json: { testKey: slot.testKey, weekIndex: slot.weekIndex, workoutIndex: slot.workoutIndex },
      updated_at: new Date().toISOString(),
    });
    assert(!stageErr, `provisional staging insert failed: ${stageErr?.message}`);
    assert(
      !(await readPositionRow(third.client, third.userId, slot.weekIndex, slot.workoutIndex)),
      'provisional staging must not invent a canonical completion',
    );

    const { error: rollbackErr } = await a.client.from('mile_tests')
      .delete()
      .eq('user_id', a.userId)
      .eq('test_key', slot.testKey)
      .eq('proof_pending', true);
    assert(!rollbackErr, `provisional staging rollback failed: ${rollbackErr?.message}`);
    assert(!(await readMileRow(third.client, third.userId, slot)), 'provisional rollback must remove the row');
    console.log('PASS proof_pending identity staging stays outside the assignment perimeter');
    await cleanupSlot(a.client, a.userId, slot);
  }

  // First-time assigned Mile with proof, then a stale-client Skip: the proof must be
  // retired rather than left current against a skipped assignment.
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const recordId = randomUUID();
    const attachmentId = randomUUID();
    const { error: proofErr } = await a.client.from('workout_attachments').insert({
      id: attachmentId,
      user_id: a.userId,
      linked_record_id: recordId,
      is_current: true,
      completion_cleared: false,
    });
    if (proofErr) {
      console.log(`SKIP proof retirement contract (cannot seed attachment: ${proofErr.message})`);
    } else {
      const { error: saveErr } = await saveAssigned(a.client, slot, recordId, {
        totalMinutes: 7.05,
        attachmentId,
        proofPolicyVersion: 1,
      });
      assert(!saveErr, `assigned Save with proof failed: ${saveErr?.message}`);
      const saved = await readCanonical(third.client, third.userId, slot);
      assert(saved.status === 'completed', 'assigned Save with proof must complete');
      assert(saved.completion.attachment_id === attachmentId, 'completion must link the proof');
      assert(saved.mile.attachment_id === attachmentId, 'mile detail must link the same proof');

      const { error: skipErr } = await legacySkipWorkout(b.client, b.userId, slot, randomUUID());
      assert(!skipErr, `legacy-client Skip with proof failed: ${skipErr?.message}`);
      const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-skip-retires-proof');
      assert(truth.status === 'skipped', 'legacy-client Skip must converge to SKIPPED');
      assert(!truth.mile, 'legacy-client Skip must remove Mile detail');

      const { data: proofRow, error: proofReadErr } = await third.client.from('workout_attachments')
        .select('id,completion_cleared')
        .eq('user_id', third.userId)
        .eq('id', attachmentId)
        .maybeSingle();
      assert(!proofReadErr, proofReadErr?.message);
      assert(proofRow?.completion_cleared === true, 'stale-client Skip must retire the assigned Mile proof');
      console.log('PASS first-time assigned Mile proof is retired by a stale-client Skip');
      await a.client.from('workout_attachments').delete().eq('user_id', a.userId).eq('id', attachmentId);
    }
    await cleanupSlot(a.client, a.userId, slot);
  }

  // Cross-version: the exact production client writes tables directly and must
  // still converge to a legal committed state.
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const legacyId = randomUUID();
    const { error } = await legacySaveMileDetail(a.client, a.userId, slot, {
      clientRecordId: legacyId,
      totalMinutes: 7.25,
      avgBpm: 152,
    });
    assert(!error, `legacy-client Save failed: ${error?.message}`);
    const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-client-save');
    assert(truth.status === 'completed', 'legacy-client Save must converge to COMPLETED');
    assert(!!truth.completion, 'legacy-client Save must produce a canonical completion');
    assert(truth.completion.completion_key === slot.completionKey, 'converged completion must use canonical key');
    assert(Number(truth.completion.total_minutes) === 7.25, 'canonical completion must carry saved metrics');
    assert(Number(truth.completion.avg_bpm) === 152, 'canonical completion must carry saved HR');
    assert(truth.completion.modality === 'running', 'canonical completion must carry Mile modality');
    assert(truth.completion.output_type === 'distance', 'canonical completion must carry Mile output type');
    assert(truth.completion.client_record_id === legacyId, 'canonical completion must adopt the client record id');
    console.log('PASS legacy-client Save converges to legal COMPLETED');
    await cleanupSlot(a.client, a.userId, slot);
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    assert(!(await saveAssigned(a.client, slot, randomUUID(), { totalMinutes: 7.3 })).error, 'seed save failed');
    const { error } = await legacySkipWorkout(b.client, b.userId, slot, randomUUID());
    assert(!error, `legacy-client Skip failed: ${error?.message}`);
    const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-client-skip');
    assert(truth.status === 'skipped', 'legacy-client Skip must converge to SKIPPED');
    assert(!truth.mile, 'legacy-client Skip must not leave Mile detail behind');
    assert(!truth.completion.attachment_id, 'legacy-client Skip must retire proof linkage');
    console.log('PASS legacy-client Skip from COMPLETED converges to legal SKIPPED');
    await cleanupSlot(a.client, a.userId, slot);
  }

  // Stale-client identity staging (ensureCloudMileTestIdentity 'patch-client-id')
  // rewrites only mile_tests.client_record_id. Proof linkage resolves through that
  // id, so the canonical completion must follow it.
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    assert(!(await saveAssigned(a.client, slot, randomUUID(), { totalMinutes: 7.35 })).error, 'seed save failed');
    const patchedId = randomUUID();
    const { error } = await a.client.from('mile_tests')
      .update({ client_record_id: patchedId, updated_at: new Date().toISOString() })
      .eq('user_id', a.userId)
      .eq('test_key', slot.testKey);
    assert(!error, `legacy identity patch failed: ${error?.message}`);
    const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-identity-patch');
    assert(truth.status === 'completed', 'identity patch must stay COMPLETED');
    assert(truth.mile.client_record_id === patchedId, 'mile detail must carry the patched identity');
    assert(
      truth.completion.client_record_id === patchedId,
      'canonical completion must follow the patched identity',
    );
    console.log('PASS legacy identity patch keeps completion and detail on one record id');
    await cleanupSlot(a.client, a.userId, slot);
  }

  // Stale-client resave over a completed assignment: canonical metrics and proof
  // linkage must follow the athlete's new save instead of silently disagreeing.
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const recordId = randomUUID();
    const attachmentId = randomUUID();
    const { error: proofErr } = await a.client.from('workout_attachments').insert({
      id: attachmentId,
      user_id: a.userId,
      linked_record_id: recordId,
      is_current: true,
      completion_cleared: false,
    });
    const proofAvailable = !proofErr;
    assert(!(await saveAssigned(a.client, slot, recordId, {
      totalMinutes: 7.5,
      attachmentId: proofAvailable ? attachmentId : null,
      proofPolicyVersion: proofAvailable ? 1 : null,
    })).error, 'seed save failed');

    const { error } = await legacySaveMileDetail(a.client, a.userId, slot, {
      totalMinutes: 6.72,
      avgBpm: 161,
      maxBpm: 179,
    });
    assert(!error, `legacy-client resave failed: ${error?.message}`);
    const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-client-resave-over-completed');
    assert(truth.status === 'completed', 'legacy-client resave must stay COMPLETED');
    assert(Number(truth.completion.total_minutes) === 6.72, 'canonical completion must adopt resaved time');
    assert(Number(truth.completion.avg_bpm) === 161, 'canonical completion must adopt resaved avg HR');
    assert(Number(truth.completion.max_bpm) === 179, 'canonical completion must adopt resaved max HR');
    assert(Number(truth.mile.total_minutes) === 6.72, 'mile detail must carry resaved time');
    assert(
      truth.completion.attachment_id === truth.mile.attachment_id,
      'canonical completion and mile detail must agree on proof linkage',
    );
    if (proofAvailable) {
      assert(truth.completion.attachment_id === attachmentId, 'resave must not erase existing proof');
    }
    console.log('PASS legacy-client resave over COMPLETED keeps one agreed truth');
    await cleanupSlot(a.client, a.userId, slot);
    if (proofAvailable) {
      await a.client.from('workout_attachments').delete().eq('user_id', a.userId).eq('id', attachmentId);
    }
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    assert(!(await saveAssigned(a.client, slot, randomUUID(), { totalMinutes: 7.4 })).error, 'seed save failed');
    assert(!(await clearAssigned(b.client, slot)).error, 'seed clear failed');
    const { error } = await legacySaveMileDetail(a.client, a.userId, slot, { totalMinutes: 6.8 });
    assert(!error, `legacy-client resave failed: ${error?.message}`);
    const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-client-resave');
    assert(truth.status === 'completed', 'legacy-client resave after Clear must converge to COMPLETED');
    assert(!!truth.completion && !!truth.mile, 'Mile-only state is illegal after legacy resave');
    console.log('PASS legacy-client Save after new Clear never leaves Mile-only state');
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < Math.max(4, Math.floor(CONCURRENT_ROUNDS / 2)); round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const truth = await runConcurrentPair(
      `legacySave||newClear#${round}`,
      () => legacySaveMileDetail(a.client, a.userId, slot, { totalMinutes: 7.05 }),
      () => clearAssigned(b.client, slot),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `legacySave||newClear#${round}`);
    console.log(`PASS cross-version legacySave||newClear#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < Math.max(4, Math.floor(CONCURRENT_ROUNDS / 2)); round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    assert(!(await saveAssigned(a.client, slot, randomUUID(), { totalMinutes: 7.6 })).error, 'seed save failed');
    const truth = await runConcurrentPair(
      `legacySkip||newSave#${round}`,
      () => legacySkipWorkout(a.client, a.userId, slot, randomUUID()),
      () => saveAssigned(b.client, slot, randomUUID(), { totalMinutes: 6.95 }),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `legacySkip||newSave#${round}`);
    console.log(`PASS cross-version legacySkip||newSave#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  for (let round = 0; round < Math.max(4, Math.floor(CONCURRENT_ROUNDS / 2)); round += 1) {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const truth = await runConcurrentPair(
      `legacySave||newSkip#${round}`,
      () => legacySaveMileDetail(a.client, a.userId, slot, { totalMinutes: 7.15 }),
      () => skipAssigned(b.client, slot, randomUUID()),
      a,
      b,
      third,
      slot,
    );
    assertConsistentTruth(truth, `legacySave||newSkip#${round}`);
    console.log(`PASS cross-version legacySave||newSkip#${round}: canonical=${truth.status || 'cleared'}`);
    await cleanupSlot(a.client, a.userId, slot);
  }

  // --- B6 / Review B6: stale proof freshness authority ---
  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const recordId = randomUUID();
    const storagePaths = [];
    const attachmentIds = [];
    try {
      assert(!(await saveAssigned(a.client, slot, recordId, { totalMinutes: 7.11 })).error, 'seed save failed');

      const proofA = await createAssignedMileProof(a.client, a.userId, slot, recordId, 'stale-a');
      storagePaths.push(proofA.storagePath);
      attachmentIds.push(proofA.proof.id);
      assert(!(await saveAssigned(a.client, slot, recordId, {
        totalMinutes: 7.11,
        attachmentId: proofA.proof.id,
        proofPolicyVersion: 1,
      })).error, 'link proof A failed');

      const proofB = await createAssignedMileProof(a.client, a.userId, slot, recordId, 'current-b');
      storagePaths.push(proofB.storagePath);
      attachmentIds.push(proofB.proof.id);
      assert(!(await saveAssigned(a.client, slot, recordId, {
        totalMinutes: 7.11,
        attachmentId: proofB.proof.id,
        proofPolicyVersion: 1,
      })).error, 'link proof B failed');

      const seeded = await assertFinalAssignedProofInvariants(third.client, third.userId, slot, 'seed-current-b');
      assertProofMirrorsAgree(seeded, proofB.proof.id, 'seed-current-b');

      const { data: retiredA, error: retiredErr } = await third.client.from('workout_attachments')
        .select('id,is_current,completion_cleared')
        .eq('user_id', third.userId)
        .eq('id', proofA.proof.id)
        .maybeSingle();
      assert(!retiredErr, retiredErr?.message);
      assert(retiredA?.is_current === false, 'proof A must be non-current after replacement');

      // Exact e85-shaped legacy resave still carries retired attachment A.
      const { error: staleErr } = await legacySaveMileDetail(a.client, a.userId, slot, {
        clientRecordId: recordId,
        totalMinutes: 6.91,
        avgBpm: 158,
        attachmentId: proofA.proof.id,
        proofPolicyVersion: 1,
        attachment: { id: proofA.proof.id },
      });
      assert(!staleErr, `stale-proof legacy resave failed: ${staleErr?.message}`);

      const truth = await assertFreshClientsAgree(a, b, third, slot, 'stale-proof-cannot-resurrect');
      assert(truth.status === 'completed', 'stale-proof resave must remain COMPLETED');
      assert(Number(truth.completion.total_minutes) === 6.91, 'metrics from stale resave must still apply');
      assertProofMirrorsAgree(truth, proofB.proof.id, 'stale-proof-cannot-resurrect');
      await assertFinalAssignedProofInvariants(third.client, third.userId, slot, 'stale-proof-cannot-resurrect');

      const { data: stillRetired, error: stillErr } = await third.client.from('workout_attachments')
        .select('is_current')
        .eq('user_id', third.userId)
        .eq('id', proofA.proof.id)
        .maybeSingle();
      assert(!stillErr, stillErr?.message);
      assert(stillRetired?.is_current === false, 'proof A must stay retired');
      console.log('PASS stale retired proof cannot resurrect over current canonical proof');
    } finally {
      await cleanupSlot(a.client, a.userId, slot);
      await cleanupProofArtifacts(a.client, attachmentIds, storagePaths);
    }
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const recordId = randomUUID();
    const storagePaths = [];
    const attachmentIds = [];
    try {
      assert(!(await saveAssigned(a.client, slot, recordId, { totalMinutes: 7.22 })).error, 'seed save failed');
      const proofB = await createAssignedMileProof(a.client, a.userId, slot, recordId, 'old-b');
      storagePaths.push(proofB.storagePath);
      attachmentIds.push(proofB.proof.id);
      assert(!(await saveAssigned(a.client, slot, recordId, {
        totalMinutes: 7.22,
        attachmentId: proofB.proof.id,
        proofPolicyVersion: 1,
      })).error, 'link proof B failed');

      const proofC = await createAssignedMileProof(a.client, a.userId, slot, recordId, 'new-c');
      storagePaths.push(proofC.storagePath);
      attachmentIds.push(proofC.proof.id);
      // Replacement RPC already made B non-current; WC/Mile still point at B until the save.
      const mid = await readCanonical(third.client, third.userId, slot);
      assert(mid.completion.attachment_id === proofB.proof.id, 'pre-replacement WC still points at B');

      const { error: replaceErr } = await legacySaveMileDetail(a.client, a.userId, slot, {
        clientRecordId: recordId,
        totalMinutes: 6.84,
        avgBpm: 163,
        attachmentId: proofC.proof.id,
        proofPolicyVersion: 1,
        attachment: { id: proofC.proof.id },
      });
      assert(!replaceErr, `legacy proof replacement failed: ${replaceErr?.message}`);

      const truth = await assertFreshClientsAgree(a, b, third, slot, 'legacy-proof-replacement');
      assert(truth.status === 'completed', 'legacy proof replacement must stay COMPLETED');
      assert(Number(truth.completion.total_minutes) === 6.84, 'replacement must apply new metrics');
      assertProofMirrorsAgree(truth, proofC.proof.id, 'legacy-proof-replacement');
      await assertFinalAssignedProofInvariants(third.client, third.userId, slot, 'legacy-proof-replacement');
      console.log('PASS legitimate old-client current proof replacement is accepted');
    } finally {
      await cleanupSlot(a.client, a.userId, slot);
      await cleanupProofArtifacts(a.client, attachmentIds, storagePaths);
    }
  }

  {
    const slot = allocSlot();
    await cleanupSlot(a.client, a.userId, slot);
    const recordId = randomUUID();
    const storagePaths = [];
    const attachmentIds = [];
    try {
      assert(!(await saveAssigned(a.client, slot, recordId, { totalMinutes: 7.33 })).error, 'seed save failed');
      const proofA = await createAssignedMileProof(a.client, a.userId, slot, recordId, 'race-a');
      storagePaths.push(proofA.storagePath);
      attachmentIds.push(proofA.proof.id);
      const proofB = await createAssignedMileProof(a.client, a.userId, slot, recordId, 'race-b');
      storagePaths.push(proofB.storagePath);
      attachmentIds.push(proofB.proof.id);
      assert(!(await saveAssigned(a.client, slot, recordId, {
        totalMinutes: 7.33,
        attachmentId: proofB.proof.id,
        proofPolicyVersion: 1,
      })).error, 'link proof B failed');

      const settled = await Promise.allSettled([
        legacySaveMileDetail(a.client, a.userId, slot, {
          clientRecordId: recordId,
          totalMinutes: 6.77,
          attachmentId: proofA.proof.id,
          proofPolicyVersion: 1,
          attachment: { id: proofA.proof.id },
        }),
        clearAssigned(b.client, slot),
      ]);
      // One side may lose to serialization/deadlock; authoritative end state must still be legal.
      const truth = await assertFreshClientsAgree(a, b, third, slot, 'staleA||newClear');
      if (truth.status === 'cleared' || (!truth.completion && !truth.mile)) {
        assert(!truth.completion && !truth.mile, 'cleared race must leave no WC/Mile');
      } else {
        assert(truth.status === 'completed', 'non-cleared race winner must be COMPLETED');
        await assertFinalAssignedProofInvariants(third.client, third.userId, slot, 'staleA||newClear');
        assert(
          truth.completion.attachment_id === proofB.proof.id,
          'COMPLETED race winner must keep current proof B, never retired A',
        );
        assertProofMirrorsAgree(truth, proofB.proof.id, 'staleA||newClear');
      }
      const failed = settled.filter((entry) => entry.status === 'rejected'
        || (entry.status === 'fulfilled' && entry.value?.error));
      console.log(
        `PASS concurrent stale-A legacy resave || new Clear → ${truth.status || 'cleared'}`
        + (failed.length ? ` (${failed.length} request error tolerated)` : ''),
      );
    } finally {
      await cleanupSlot(a.client, a.userId, slot);
      await cleanupProofArtifacts(a.client, attachmentIds, storagePaths);
    }
  }

  // P2: quantify the documented same-row lock inversion. One transaction may abort with
  // 40P01; nothing partial may commit; a retry must land in a legal state.
  {
    let sawDeadlock = false;
    let sawSuccessPair = false;
    for (let round = 0; round < 12; round += 1) {
      const slot = allocSlot();
      await cleanupSlot(a.client, a.userId, slot);
      const recordId = randomUUID();
      assert(!(await saveAssigned(a.client, slot, recordId, { totalMinutes: 7.41 })).error, 'deadlock seed failed');

      const settled = await Promise.allSettled([
        legacySaveMileDetail(a.client, a.userId, slot, {
          clientRecordId: recordId,
          totalMinutes: 6.66,
        }),
        clearAssigned(b.client, slot),
      ]);
      const errors = settled
        .map((entry) => {
          if (entry.status === 'rejected') return String(entry.reason?.message || entry.reason || '');
          if (entry.value?.error) return String(entry.value.error.message || entry.value.error);
          return '';
        })
        .filter(Boolean);
      if (errors.some((message) => /40P01|deadlock detected/i.test(message))) {
        sawDeadlock = true;
      }
      if (errors.length === 0) sawSuccessPair = true;

      const truth = await assertFreshClientsAgree(a, b, third, slot, `deadlock-quant#${round}`);
      assertConsistentTruth(truth, `deadlock-quant#${round}`);
      assert(
        truth.status === 'completed' || truth.status === 'skipped' || (!truth.completion && !truth.mile),
        `deadlock-quant#${round}: illegal status ${truth.status}`,
      );

      // Retry the failed side (or a no-op clear) and confirm recovery.
      if (errors.length) {
        const { error: retryErr } = await clearAssigned(b.client, slot);
        assert(!retryErr, `deadlock retry clear failed: ${retryErr?.message}`);
        const retried = await assertFreshClientsAgree(a, b, third, slot, `deadlock-retry#${round}`);
        assert(!retried.completion && !retried.mile, 'deadlock retry clear must leave CLEARED');
      }
      await cleanupSlot(a.client, a.userId, slot);
    }
    console.log(
      `PASS documented legacy-upsert||clear deadlock quantification`
      + ` (observedDeadlock=${sawDeadlock}, observedCleanPair=${sawSuccessPair})`,
    );
  }

  console.log('\nPASS: assigned mile concurrent multi-context authority races');
}

main().catch((error) => {
  console.error('FAIL:', error.message || error);
  process.exitCode = 1;
});
