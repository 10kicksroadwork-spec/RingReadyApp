#!/usr/bin/env node
/**
 * Real Supabase authorization tests for workout proof RPC hardening.
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
import { buildProvisionalMileTestCloudPayload, buildWorkoutCloudPayload, getCompletionKeyFromRecord } from '../src/cloud-record-mapper.js';
import { isVisibleCompletionRow } from '../src/proof-staging.js';
import {
  classifyUniqueViolation,
  UNIQUE_CONFLICT,
} from '../src/workout-completion-identity.js';
import {
  ensureWorkoutIdentityReconciled,
  findWorkoutCompletionIdentity,
  rollbackWorkoutIdentityIfOwned,
  saveWorkoutCompletionReconciled,
} from '../src/workout-completion-reconcile.js';

const url = process.env.RING_READY_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey = process.env.RING_READY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const email = process.env.RING_READY_TEST_EMAIL || '';
const password = process.env.RING_READY_TEST_PASSWORD || '';
const requireTests = process.env.RING_READY_REQUIRE_PROOF_TESTS === '1';
const testPrefix = `auth-test:${Date.now()}`;

/** Real RingReady camps use week indices 0..6. Layer C must never seed those slots. */
const MAX_REAL_PROGRAM_WEEK_INDEX = 6;
const testSlotBase = 100000 + (Date.now() % 100000000);
let nextTestSlotOffset = 0;

function allocTestSlot(workoutIndex = 0) {
  const weekIndex = testSlotBase + nextTestSlotOffset;
  nextTestSlotOffset += 1;
  assert(
    weekIndex > MAX_REAL_PROGRAM_WEEK_INDEX,
    `Layer C test week ${weekIndex} must be outside real program domain 0..${MAX_REAL_PROGRAM_WEEK_INDEX}`,
  );
  return {
    weekIndex,
    workoutIndex: Number(workoutIndex),
    completionKey: `${weekIndex}:${Number(workoutIndex)}`,
  };
}

function assertOutsideRealProgram(weekIndex, label) {
  assert(
    Number(weekIndex) > MAX_REAL_PROGRAM_WEEK_INDEX,
    `${label}: week_index ${weekIndex} must be outside real program domain 0..${MAX_REAL_PROGRAM_WEEK_INDEX}`,
  );
}

/**
 * Insert a Layer C workout row. On unique collision with a pre-existing row:
 * FAIL CLOSED — never delete the existing athlete/test row to unblock CI.
 */
async function insertWorkoutOrFailClosed(client, row, createdWorkoutIds, label, select = 'id') {
  assertOutsideRealProgram(row.week_index, label);
  const { data, error } = await client
    .from('workout_completions')
    .insert(row)
    .select(select)
    .single();
  if (error) {
    const code = String(error.code || error.error_code || '').toUpperCase();
    if (code === '23505') {
      throw new Error(
        `${label}: unique collision with a pre-existing row. FAIL CLOSED — did not delete the existing row. ${error.message}`,
      );
    }
    throw new Error(`${label}: ${error.message || 'insert failed'}`);
  }
  assert(data?.id, `${label}: insert returned no id`);
  createdWorkoutIds.push(data.id);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertUniqueViolation(error, expectedKind, label) {
  assert(!!error, `${label}: expected a database error`);
  const code = String(error.code || error.error_code || '').toUpperCase();
  assert(
    code === '23505',
    `${label}: expected literal SQLSTATE 23505, got code=${code || 'none'} message=${error.message || 'unknown'}`,
  );
  if (expectedKind) {
    assert(
      classifyUniqueViolation(error) === expectedKind,
      `${label}: expected ${expectedKind}, got ${classifyUniqueViolation(error)}`,
    );
  }
}

async function signIn(client, userEmail, userPassword) {
  const { data, error } = await client.auth.signInWithPassword({ email: userEmail, password: userPassword });
  if (error) throw error;
  return data.user;
}

async function uploadProofBlob(client, storagePath) {
  const blob = new Blob([new Uint8Array(1024)], { type: 'image/webp' });
  const { error } = await client.storage.from('workout-proof-staging').upload(storagePath, blob, { upsert: true });
  if (error) throw error;
}

async function createProof(client, params) {
  return client.rpc('create_workout_proof_attachment', {
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/webp',
    p_file_size: 1024,
    ...params,
  });
}

async function runCleanup(client, {
  attachmentIds = [],
  mileTestIds = [],
  workoutIds = [],
  storagePaths = [],
} = {}) {
  const cleanupErrors = [];
  const uniqueAttachmentIds = [...new Set(attachmentIds)];
  const uniqueWorkoutIds = [...new Set(workoutIds)];
  const uniqueMileTestIds = [...new Set(mileTestIds)];

  // Delete completions first so workout_completions.attachment_id FK does not
  // block attachment cleanup.
  if (uniqueWorkoutIds.length) {
    const { error: workoutCleanupError } = await client.from('workout_completions').delete().in('id', uniqueWorkoutIds);
    if (workoutCleanupError) cleanupErrors.push(`Workout cleanup failed: ${workoutCleanupError.message}`);
  }
  if (uniqueAttachmentIds.length) {
    const { data: deletedCount, error: cleanupError } = await client.rpc('cleanup_test_workout_proof_attachments', {
      p_attachment_ids: uniqueAttachmentIds,
    });
    if (cleanupError) cleanupErrors.push(`Attachment cleanup failed: ${cleanupError.message}`);
    else if (deletedCount !== uniqueAttachmentIds.length) {
      cleanupErrors.push(`Expected ${uniqueAttachmentIds.length} attachment rows deleted, got ${deletedCount}`);
    }
  }
  if (uniqueMileTestIds.length) {
    const { error: mileCleanupError } = await client.from('mile_tests').delete().in('id', uniqueMileTestIds);
    if (mileCleanupError) cleanupErrors.push(`Mile test cleanup failed: ${mileCleanupError.message}`);
  }
  if (storagePaths.length) {
    const { error: storageCleanupError } = await client.storage.from('workout-proof-staging').remove([...new Set(storagePaths)]);
    if (storageCleanupError) cleanupErrors.push(`Storage cleanup failed: ${storageCleanupError.message}`);
  }
  return cleanupErrors;
}

async function countCurrentProofs(client, userId, proofKey) {
  const { count, error } = await client
    .from('workout_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('proof_key', proofKey)
    .eq('is_current', true);
  if (error) throw error;
  return count || 0;
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
  const user = await signIn(client, email, password);
  assert(user?.id, 'Authenticated user required');

  const createdAttachmentIds = [];
  const createdMileTestIds = [];
  const createdWorkoutIds = [];
  const storagePaths = [];
  const canaryCleanupIds = [];
  let canaryCreatedByThisRun = false;
  let canaryId = null;
  let cleanupErrors = [];

  try {
    const proofKey = `${testPrefix}:basic`;
    const storagePath = `${user.id}/${proofKey}/auth-test.webp`;
    const storagePathB = `${user.id}/${proofKey}/auth-test-b.webp`;
    storagePaths.push(storagePath, storagePathB);

    const { error: anonRpcError } = await createClient(url, anonKey).rpc('create_workout_proof_attachment', {
      p_proof_key: proofKey,
      p_linked_record_id: 'test-record',
      p_storage_path: storagePath,
      p_original_filename: 'auth-test.webp',
      p_mime_type: 'image/webp',
      p_file_size: 1024,
    });
    assert(!!anonRpcError, 'Anonymous RPC must be rejected');

    const { error: foreignPathError } = await createProof(client, {
      p_proof_key: proofKey,
      p_linked_record_id: 'test-record',
      p_storage_path: `00000000-0000-0000-0000-000000000099/${proofKey}/bad.webp`,
    });
    assert(!!foreignPathError, 'Foreign storage path must be rejected');

    const { error: forgedLinkError } = await createProof(client, {
      p_proof_key: proofKey,
      p_linked_record_id: '00000000-0000-0000-0000-000000000099',
      p_storage_path: storagePath,
    });
    assert(!!forgedLinkError, 'Forged linked_record_id must be rejected');

    const { error: directInsertError } = await client.from('workout_attachments').insert({
      user_id: user.id,
      proof_key: proofKey,
      storage_path: storagePath,
      file_size: 1024,
      mime_type: 'image/webp',
    });
    assert(!!directInsertError, 'Direct INSERT must be rejected');

    const { error: proofClearRpcError } = await client.rpc('set_workout_proof_cleared', {
      attachment_id: '00000000-0000-0000-0000-000000000099',
      cleared: true,
    });
    assert(!!proofClearRpcError, 'set_workout_proof_cleared RPC must exist and reject foreign attachment');

    const provisionalMileKey = `${testPrefix}:provisional-mile`;
    const provisionalClientId = `${testPrefix}:provisional-mile-client`;
    const provisionalPayload = buildProvisionalMileTestCloudPayload(
      { id: provisionalClientId, testKey: provisionalMileKey },
      { testKey: provisionalMileKey },
      user.id,
    );
    assert(provisionalPayload.saved_at === null, 'Provisional mile payload must use saved_at = null');
    assert(provisionalPayload.distance === null, 'Provisional mile payload must use distance = null');
    assert(provisionalPayload.total_minutes === null, 'Provisional mile payload must use total_minutes = null');
    assert(provisionalPayload.proof_pending === true, 'Provisional mile payload must set proof_pending = true');

    const { data: provisionalMileRow, error: provisionalMileError } = await client
      .from('mile_tests')
      .insert(provisionalPayload)
      .select('id, proof_pending, saved_at, distance, total_minutes')
      .single();
    assert(
      !provisionalMileError && provisionalMileRow?.id,
      `Provisional mile staging insert must succeed: ${provisionalMileError?.message || 'unknown'}`,
    );
    createdMileTestIds.push(provisionalMileRow.id);

    const clientRecordId = `${testPrefix}:mile-client-id`;
    const ownedTestKey = `${testPrefix}:mile`;
    const { data: mileRow, error: mileInsertError } = await client.from('mile_tests').insert({
      user_id: user.id,
      test_key: ownedTestKey,
      client_record_id: clientRecordId,
    }).select('id').single();
    assert(!mileInsertError && mileRow?.id, `Could not seed owned mile test: ${mileInsertError?.message || 'unknown'}`);
    createdMileTestIds.push(mileRow.id);

    const ownedProofKey = `${testPrefix}:owned`;
    const ownedPath = `${user.id}/${ownedProofKey}/owned.webp`;
    storagePaths.push(ownedPath);
    await uploadProofBlob(client, ownedPath);
    const { data: ownedProof, error: ownedLinkError } = await createProof(client, {
      p_proof_key: ownedTestKey,
      p_linked_record_id: clientRecordId,
      p_storage_path: ownedPath,
    });
    assert(!ownedLinkError && ownedProof?.id, `Owned client_record_id must be accepted: ${ownedLinkError?.message || 'unknown'}`);
    createdAttachmentIds.push(ownedProof.id);

    const { error: clearProofError } = await client.rpc('set_workout_proof_cleared', {
      attachment_id: ownedProof.id,
      cleared: true,
    });
    assert(!clearProofError, `set_workout_proof_cleared must succeed: ${clearProofError?.message || 'unknown'}`);
    const { data: clearedRow, error: clearedRowError } = await client
      .from('workout_attachments')
      .select('completion_cleared')
      .eq('id', ownedProof.id)
      .single();
    assert(!clearedRowError && clearedRow?.completion_cleared === true, 'Proof clear RPC must set completion_cleared = true');

    const wrongContextPath = `${user.id}/${testPrefix}:wrong-context/owned.webp`;
    storagePaths.push(wrongContextPath);
    await uploadProofBlob(client, wrongContextPath);
    const { error: wrongContextError } = await createProof(client, {
      p_proof_key: `${testPrefix}:different-mile-key`,
      p_linked_record_id: clientRecordId,
      p_storage_path: wrongContextPath,
    });
    assert(!!wrongContextError, 'Owned record with wrong test_key must be rejected');

    // Isolation canary: a legitimate real-program slot (1:2) must remain untouched by Layer C.
    const REAL_CANARY_KEY = '1:2';
    const REAL_CANARY_WEEK = 1;
    const REAL_CANARY_WORKOUT = 2;
    let canarySnapshot = null;

    {
      const { data: existingCanary, error: canaryLookupError } = await client
        .from('workout_completions')
        .select('id, completion_key, week_index, workout_index, client_record_id, attachment_id, total_minutes, proof_pending, updated_at')
        .eq('user_id', user.id)
        .eq('completion_key', REAL_CANARY_KEY)
        .maybeSingle();
      assert(!canaryLookupError, `Isolation canary lookup failed: ${canaryLookupError?.message || 'unknown'}`);
      if (existingCanary?.id) {
        canarySnapshot = existingCanary;
        canaryId = existingCanary.id;
      } else {
        const canaryClientId = `${testPrefix}:isolation-canary`;
        const { data: seededCanary, error: canarySeedError } = await client
          .from('workout_completions')
          .insert({
            user_id: user.id,
            completion_key: REAL_CANARY_KEY,
            client_record_id: canaryClientId,
            week_index: REAL_CANARY_WEEK,
            workout_index: REAL_CANARY_WORKOUT,
            workout_type: 'Threshold Run',
            proof_pending: false,
            total_minutes: 33,
            record_json: { id: canaryClientId, isolationCanary: true },
          })
          .select('id, completion_key, week_index, workout_index, client_record_id, attachment_id, total_minutes, proof_pending, updated_at')
          .single();
        if (canarySeedError) {
          const code = String(canarySeedError.code || canarySeedError.error_code || '').toUpperCase();
          if (code === '23505') {
            throw new Error(
              'Isolation canary: unique collision seeding 1:2. FAIL CLOSED — did not delete the existing row.',
            );
          }
          throw new Error(`Isolation canary seed failed: ${canarySeedError.message || 'unknown'}`);
        }
        assert(seededCanary?.id, 'Isolation canary seed returned no id');
        canaryCreatedByThisRun = true;
        canarySnapshot = seededCanary;
        canaryId = seededCanary.id;
        // Do NOT push into createdWorkoutIds: cleanup must never delete a pre-existing athlete row,
        // and the canary is verified before any optional canary-only cleanup.
      }
    }

    const ownedSlot = allocTestSlot(2);
    const workoutClientId = `${testPrefix}:workout-client-id`;
    const workoutProofKey = `${testPrefix}:program:7:${ownedSlot.weekIndex}:${ownedSlot.workoutIndex}`;
    const workoutRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: ownedSlot.completionKey,
        client_record_id: workoutClientId,
        week_index: ownedSlot.weekIndex,
        workout_index: ownedSlot.workoutIndex,
      },
      createdWorkoutIds,
      'Owned workout seed',
    );

    const workoutPath = `${user.id}/${workoutProofKey}/workout.webp`;
    storagePaths.push(workoutPath);
    await uploadProofBlob(client, workoutPath);
    const { error: wrongWorkoutContextError } = await createProof(client, {
      p_proof_key: workoutProofKey,
      p_linked_record_id: workoutClientId,
      p_storage_path: workoutPath,
      p_week_index: ownedSlot.weekIndex - 1,
      p_workout_index: ownedSlot.workoutIndex,
    });
    assert(!!wrongWorkoutContextError, 'Owned workout with wrong week_index must be rejected');

    const { data: workoutProof, error: workoutProofError } = await createProof(client, {
      p_proof_key: workoutProofKey,
      p_linked_record_id: workoutClientId,
      p_storage_path: workoutPath,
      p_week_index: ownedSlot.weekIndex,
      p_workout_index: ownedSlot.workoutIndex,
    });
    assert(!workoutProofError && workoutProof?.id, `Owned workout with matching context must be accepted: ${workoutProofError?.message || 'unknown'}`);
    createdAttachmentIds.push(workoutProof.id);

    await uploadProofBlob(client, storagePathB);
    const replacementFailPath = `${user.id}/${ownedTestKey}/replacement-fail.webp`;
    storagePaths.push(replacementFailPath);
    await uploadProofBlob(client, replacementFailPath);
    const { error: replacementError } = await createProof(client, {
      p_proof_key: ownedTestKey,
      p_linked_record_id: clientRecordId,
      p_storage_path: replacementFailPath,
      p_mime_type: 'image/bmp',
    });
    assert(!!replacementError, 'Invalid replacement RPC for existing proof key must fail');
    const { data: stillCurrent } = await client
      .from('workout_attachments')
      .select('id,is_current')
      .eq('user_id', user.id)
      .eq('proof_key', ownedTestKey)
      .eq('is_current', true)
      .maybeSingle();
    assert(stillCurrent?.id === ownedProof.id, 'Existing current proof must remain after failed replacement on same proof key');

    const concurrentMileKey = `${testPrefix}:concurrent-mile`;
    const concurrentClientId = `${testPrefix}:concurrent-client-id`;
    const { data: concurrentMileRow, error: concurrentMileError } = await client.from('mile_tests').insert({
      user_id: user.id,
      test_key: concurrentMileKey,
      client_record_id: concurrentClientId,
    }).select('id').single();
    assert(!concurrentMileError && concurrentMileRow?.id, `Could not seed concurrent mile test: ${concurrentMileError?.message || 'unknown'}`);
    createdMileTestIds.push(concurrentMileRow.id);

    const path1 = `${user.id}/${concurrentMileKey}/a.webp`;
    const path2 = `${user.id}/${concurrentMileKey}/b.webp`;
    storagePaths.push(path1, path2);
    await uploadProofBlob(client, path1);
    await uploadProofBlob(client, path2);
    const [first, second] = await Promise.all([
      createProof(client, {
        p_proof_key: concurrentMileKey,
        p_linked_record_id: concurrentClientId,
        p_storage_path: path1,
      }),
      createProof(client, {
        p_proof_key: concurrentMileKey,
        p_linked_record_id: concurrentClientId,
        p_storage_path: path2,
      }),
    ]);
    assert(!first.error || !second.error, 'At least one concurrent replacement should succeed');
    assert(await countCurrentProofs(client, user.id, concurrentMileKey) === 1, 'Concurrent replacements must leave one current proof');
    if (first.data?.id) createdAttachmentIds.push(first.data.id);
    if (second.data?.id) createdAttachmentIds.push(second.data.id);

    const machineSlot = allocTestSlot(8);
    const machineRecord = {
      id: `${testPrefix}:machine-client`,
      workoutContext: { weekIndex: machineSlot.weekIndex, workoutIndex: machineSlot.workoutIndex, workoutType: 'Benchmark Run' },
      workoutLog: {
        modality: 'assault_bike',
        outputType: 'watts',
        outputValue: 184,
        avgWatts: 184,
        totalMinutes: 30,
        avgBpm: 137,
        maxBpm: 165,
        completedAt: new Date().toISOString(),
      },
      completedAt: new Date().toISOString(),
    };
    const machinePayload = buildWorkoutCloudPayload(machineRecord, user.id);
    assertOutsideRealProgram(machinePayload.week_index, 'Machine payload');
    const machineRow = await insertWorkoutOrFailClosed(
      client,
      machinePayload,
      createdWorkoutIds,
      'Migration 014 machine insert',
      'id, modality, output_type, output_value, avg_watts, distance',
    );
    assert(machineRow.modality === 'assault_bike', 'Migration 014 must persist modality');
    assert(machineRow.output_type === 'watts', 'Migration 014 must persist output_type');
    assert(Number(machineRow.output_value) === 184, 'Migration 014 must persist output_value');
    assert(Number(machineRow.avg_watts) === 184, 'Migration 014 must persist avg_watts');
    assert(machineRow.distance === null, 'Migration 014 machine rows must keep distance null');

    const legacySlot = allocTestSlot(4);
    const legacyClientId = `${testPrefix}:legacy-distance`;
    const legacyWeek = legacySlot.weekIndex;
    const legacyWorkout = legacySlot.workoutIndex;
    const legacyRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: legacySlot.completionKey,
        client_record_id: legacyClientId,
        week_index: legacyWeek,
        workout_index: legacyWorkout,
        distance: 3.2,
        record_json: {
          id: legacyClientId,
          workoutContext: { weekIndex: legacyWeek, workoutIndex: legacyWorkout, workoutType: 'Benchmark Run' },
        },
      },
      createdWorkoutIds,
      'Legacy distance seed',
      'id, distance, modality, output_type, output_value',
    );
    assert(Number(legacyRow.distance) === 3.2, 'Legacy SQL distance must remain intact on insert');
    const { data: legacyReadback, error: legacyReadbackError } = await client
      .from('workout_completions')
      .select('distance, modality, output_type, output_value')
      .eq('id', legacyRow.id)
      .single();
    assert(!legacyReadbackError, `Could not read legacy distance row: ${legacyReadbackError?.message || 'unknown'}`);
    assert(Number(legacyReadback.distance) === 3.2, 'Migration 014 must preserve existing SQL distance for legacy rows');
    if (legacyReadback.output_type === 'distance' && legacyReadback.output_value != null) {
      assert(Number(legacyReadback.output_value) === 3.2, 'Migration 014 must backfill output_value from SQL distance');
    }

    const clearSlot = allocTestSlot(7);
    const clearClientId = `${testPrefix}:clear-client`;
    const clearWeek = clearSlot.weekIndex;
    const clearWorkout = clearSlot.workoutIndex;
    const clearProofKey = `${testPrefix}:program:7:${clearWeek}:${clearWorkout}`;
    const clearPath = `${user.id}/${clearProofKey}/clear.webp`;
    storagePaths.push(clearPath);
    const clearCompletionRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: clearSlot.completionKey,
        client_record_id: clearClientId,
        week_index: clearWeek,
        workout_index: clearWorkout,
      },
      createdWorkoutIds,
      'Clear-test completion seed',
    );
    await uploadProofBlob(client, clearPath);
    const { data: clearProof, error: seedClearProofError } = await createProof(client, {
      p_proof_key: clearProofKey,
      p_linked_record_id: clearClientId,
      p_storage_path: clearPath,
      p_week_index: clearWeek,
      p_workout_index: clearWorkout,
    });
    assert(!seedClearProofError && clearProof?.id, `Could not seed clear-test proof: ${seedClearProofError?.message || 'unknown'}`);
    createdAttachmentIds.push(clearProof.id);
    const { error: linkClearProofError } = await client
      .from('workout_completions')
      .update({ attachment_id: clearProof.id })
      .eq('id', clearCompletionRow.id);
    assert(!linkClearProofError, `Could not link clear-test proof: ${linkClearProofError?.message || 'unknown'}`);

    const { error: transactionalClearError } = await client.rpc('clear_workout_completion_with_proof', {
      p_week_index: clearWeek,
      p_workout_index: clearWorkout,
      p_attachment_id: null,
    });
    assert(!transactionalClearError, `Migration 015 clear RPC must succeed: ${transactionalClearError?.message || 'unknown'}`);
    const { data: clearedCompletion } = await client
      .from('workout_completions')
      .select('id')
      .eq('id', clearCompletionRow.id)
      .maybeSingle();
    assert(!clearedCompletion, 'Migration 015 must delete the completion row');
    const { data: clearedAttachment, error: clearedAttachmentError } = await client
      .from('workout_attachments')
      .select('completion_cleared')
      .eq('id', clearProof.id)
      .single();
    assert(!clearedAttachmentError && clearedAttachment?.completion_cleared === true, 'Migration 015 must mark proof completion_cleared = true');
    const clearedIndex = createdWorkoutIds.indexOf(clearCompletionRow.id);
    if (clearedIndex >= 0) createdWorkoutIds.splice(clearedIndex, 1);

    const strandedSlot = allocTestSlot(3);
    const strandedClientId = `${testPrefix}:stranded-client`;
    const strandedWeek = strandedSlot.weekIndex;
    const strandedWorkout = strandedSlot.workoutIndex;
    const strandedProofKey = `${testPrefix}:program:7:${strandedWeek}:${strandedWorkout}`;
    const strandedPath = `${user.id}/${strandedProofKey}/stranded.webp`;
    storagePaths.push(strandedPath);
    const strandedCompletionRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: strandedSlot.completionKey,
        client_record_id: strandedClientId,
        week_index: strandedWeek,
        workout_index: strandedWorkout,
        attachment_id: null,
      },
      createdWorkoutIds,
      'Stranded completion seed',
    );
    await uploadProofBlob(client, strandedPath);
    const { data: strandedProof, error: strandedProofError } = await createProof(client, {
      p_proof_key: strandedProofKey,
      p_linked_record_id: strandedClientId,
      p_storage_path: strandedPath,
      p_week_index: strandedWeek,
      p_workout_index: strandedWorkout,
    });
    assert(!strandedProofError && strandedProof?.id, `Could not seed stranded proof: ${strandedProofError?.message || 'unknown'}`);
    createdAttachmentIds.push(strandedProof.id);

    const { error: strandedClearError } = await client.rpc('clear_workout_completion_with_proof', {
      p_week_index: strandedWeek,
      p_workout_index: strandedWorkout,
      p_attachment_id: null,
    });
    assert(!strandedClearError, `Migration 015 must clear stranded proof by linked_record_id: ${strandedClearError?.message || 'unknown'}`);
    const { data: strandedCompletionAfter } = await client
      .from('workout_completions')
      .select('id')
      .eq('id', strandedCompletionRow.id)
      .maybeSingle();
    assert(!strandedCompletionAfter, 'Stranded clear must delete the completion row');
    const { data: strandedAttachmentAfter, error: strandedAttachmentAfterError } = await client
      .from('workout_attachments')
      .select('completion_cleared')
      .eq('id', strandedProof.id)
      .single();
    assert(
      !strandedAttachmentAfterError && strandedAttachmentAfter?.completion_cleared === true,
      'Stranded clear must mark linked current proof completion_cleared = true',
    );
    const strandedIndex = createdWorkoutIds.indexOf(strandedCompletionRow.id);
    if (strandedIndex >= 0) createdWorkoutIds.splice(strandedIndex, 1);

    const mismatchSlotA = allocTestSlot(5);
    const mismatchSlotB = allocTestSlot(6);
    const mismatchClientA = `${testPrefix}:mismatch-a`;
    const mismatchClientB = `${testPrefix}:mismatch-b`;
    const mismatchWeekA = mismatchSlotA.weekIndex;
    const mismatchWorkoutA = mismatchSlotA.workoutIndex;
    const mismatchWeekB = mismatchSlotB.weekIndex;
    const mismatchWorkoutB = mismatchSlotB.workoutIndex;
    const mismatchProofKeyA = `${testPrefix}:program:7:${mismatchWeekA}:${mismatchWorkoutA}`;
    const mismatchProofKeyB = `${testPrefix}:program:7:${mismatchWeekB}:${mismatchWorkoutB}`;
    const mismatchPathA = `${user.id}/${mismatchProofKeyA}/a.webp`;
    const mismatchPathB = `${user.id}/${mismatchProofKeyB}/b.webp`;
    storagePaths.push(mismatchPathA, mismatchPathB);
    const mismatchRowA = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: mismatchSlotA.completionKey,
        client_record_id: mismatchClientA,
        week_index: mismatchWeekA,
        workout_index: mismatchWorkoutA,
      },
      createdWorkoutIds,
      'Mismatch clear seed A',
    );
    const mismatchRowB = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: mismatchSlotB.completionKey,
        client_record_id: mismatchClientB,
        week_index: mismatchWeekB,
        workout_index: mismatchWorkoutB,
      },
      createdWorkoutIds,
      'Mismatch clear seed B',
    );
    await uploadProofBlob(client, mismatchPathA);
    await uploadProofBlob(client, mismatchPathB);
    const { data: mismatchProofA } = await createProof(client, {
      p_proof_key: mismatchProofKeyA,
      p_linked_record_id: mismatchClientA,
      p_storage_path: mismatchPathA,
      p_week_index: mismatchWeekA,
      p_workout_index: mismatchWorkoutA,
    });
    const { data: mismatchProofB } = await createProof(client, {
      p_proof_key: mismatchProofKeyB,
      p_linked_record_id: mismatchClientB,
      p_storage_path: mismatchPathB,
      p_week_index: mismatchWeekB,
      p_workout_index: mismatchWorkoutB,
    });
    createdAttachmentIds.push(mismatchProofA.id, mismatchProofB.id);
    await client.from('workout_completions').update({ attachment_id: mismatchProofA.id }).eq('id', mismatchRowA.id);
    await client.from('workout_completions').update({ attachment_id: mismatchProofB.id }).eq('id', mismatchRowB.id);

    const { error: mismatchClearError } = await client.rpc('clear_workout_completion_with_proof', {
      p_week_index: mismatchWeekA,
      p_workout_index: mismatchWorkoutA,
      p_attachment_id: mismatchProofB.id,
    });
    assert(!!mismatchClearError, 'Migration 015 must reject mismatched attachment/workout pairing');
    const { data: stillThereA } = await client.from('workout_completions').select('id').eq('id', mismatchRowA.id).maybeSingle();
    const { data: stillThereB } = await client.from('workout_completions').select('id').eq('id', mismatchRowB.id).maybeSingle();
    assert(stillThereA && stillThereB, 'Mismatched clear attempt must leave both completions intact');

    const idempotentMileKey = `${testPrefix}:idempotent-mile`;
    const idempotentClientId = `${testPrefix}:idempotent-client-id`;
    const { data: idempotentMileRow, error: idempotentMileError } = await client.from('mile_tests').insert({
      user_id: user.id,
      test_key: idempotentMileKey,
      client_record_id: idempotentClientId,
    }).select('id').single();
    assert(!idempotentMileError && idempotentMileRow?.id, `Could not seed idempotent mile test: ${idempotentMileError?.message || 'unknown'}`);
    createdMileTestIds.push(idempotentMileRow.id);

    const idempotentPath = `${user.id}/${idempotentMileKey}/retry.webp`;
    storagePaths.push(idempotentPath);
    await uploadProofBlob(client, idempotentPath);
    const idempotentParams = {
      p_proof_key: idempotentMileKey,
      p_linked_record_id: idempotentClientId,
      p_storage_path: idempotentPath,
    };
    const firstIdempotent = await createProof(client, idempotentParams);
    assert(!firstIdempotent.error && firstIdempotent.data?.id, `First idempotent RPC must succeed: ${firstIdempotent.error?.message || 'unknown'}`);
    createdAttachmentIds.push(firstIdempotent.data.id);

    const secondIdempotent = await createProof(client, idempotentParams);
    assert(!secondIdempotent.error && secondIdempotent.data?.id === firstIdempotent.data.id, 'Repeated same-path RPC must return the same attachment id');

    const freshConcurrentKey = `${testPrefix}:fresh-concurrent-mile`;
    const freshConcurrentClientId = `${testPrefix}:fresh-concurrent-client`;
    const { data: freshConcurrentMileRow, error: freshConcurrentMileError } = await client.from('mile_tests').insert({
      user_id: user.id,
      test_key: freshConcurrentKey,
      client_record_id: freshConcurrentClientId,
    }).select('id').single();
    assert(!freshConcurrentMileError && freshConcurrentMileRow?.id, `Could not seed fresh concurrent mile test: ${freshConcurrentMileError?.message || 'unknown'}`);
    createdMileTestIds.push(freshConcurrentMileRow.id);

    const freshConcurrentPath = `${user.id}/${freshConcurrentKey}/fresh-concurrent.webp`;
    storagePaths.push(freshConcurrentPath);
    await uploadProofBlob(client, freshConcurrentPath);
    const freshConcurrentParams = {
      p_proof_key: freshConcurrentKey,
      p_linked_record_id: freshConcurrentClientId,
      p_storage_path: freshConcurrentPath,
    };
    const [freshConcurrentA, freshConcurrentB] = await Promise.all([
      createProof(client, freshConcurrentParams),
      createProof(client, freshConcurrentParams),
    ]);
    assert(!freshConcurrentA.error && freshConcurrentA.data?.id, `Fresh concurrent RPC A must succeed: ${freshConcurrentA.error?.message || 'unknown'}`);
    assert(!freshConcurrentB.error && freshConcurrentB.data?.id, `Fresh concurrent RPC B must succeed: ${freshConcurrentB.error?.message || 'unknown'}`);
    assert(freshConcurrentA.data.id === freshConcurrentB.data.id, 'Fresh concurrent same-path RPC must converge on one attachment id');
    createdAttachmentIds.push(freshConcurrentA.data.id);
    const { count: freshConcurrentCount, error: freshConcurrentCountError } = await client
      .from('workout_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('storage_path', freshConcurrentPath);
    assert(!freshConcurrentCountError, `Could not count fresh concurrent attachments: ${freshConcurrentCountError?.message || 'unknown'}`);
    assert(freshConcurrentCount === 1, `Fresh concurrent path must create exactly one attachment row, got ${freshConcurrentCount}`);
    const { data: freshConcurrentRow, error: freshConcurrentRowError } = await client
      .from('workout_attachments')
      .select('is_current')
      .eq('id', freshConcurrentA.data.id)
      .single();
    assert(!freshConcurrentRowError && freshConcurrentRow?.is_current === true, 'Fresh concurrent attachment must remain current');

    const replayMileKey = `${testPrefix}:replay-mile`;
    const replayClientId = `${testPrefix}:replay-client`;
    const { data: replayMileRow, error: replayMileError } = await client.from('mile_tests').insert({
      user_id: user.id,
      test_key: replayMileKey,
      client_record_id: replayClientId,
    }).select('id').single();
    assert(!replayMileError && replayMileRow?.id, `Could not seed replay mile test: ${replayMileError?.message || 'unknown'}`);
    createdMileTestIds.push(replayMileRow.id);
    const replayPathA = `${user.id}/${replayMileKey}/a.webp`;
    const replayPathB = `${user.id}/${replayMileKey}/b.webp`;
    storagePaths.push(replayPathA, replayPathB);
    await uploadProofBlob(client, replayPathA);
    await uploadProofBlob(client, replayPathB);
    const replayBaseParams = {
      p_proof_key: replayMileKey,
      p_linked_record_id: replayClientId,
    };
    const replayProofA = await createProof(client, { ...replayBaseParams, p_storage_path: replayPathA });
    assert(!replayProofA.error && replayProofA.data?.id, `Replay path A must succeed: ${replayProofA.error?.message || 'unknown'}`);
    createdAttachmentIds.push(replayProofA.data.id);
    const replayProofB = await createProof(client, { ...replayBaseParams, p_storage_path: replayPathB });
    assert(!replayProofB.error && replayProofB.data?.id, `Replay path B must succeed: ${replayProofB.error?.message || 'unknown'}`);
    assert(replayProofB.data.id !== replayProofA.data.id, 'Replacement proof must create a new attachment');
    createdAttachmentIds.push(replayProofB.data.id);
    const replayStale = await createProof(client, { ...replayBaseParams, p_storage_path: replayPathA });
    assert(!replayStale.error && replayStale.data?.id === replayProofB.data.id, 'Stale replay of superseded path must return the current replacement attachment');
    assert(replayStale.data.id !== replayProofA.data.id, 'Stale replay must not return the superseded non-current attachment');

    const conflictSlotA = allocTestSlot(0);
    const conflictSlotB = allocTestSlot(1);
    const conflictClientA = `${testPrefix}:valid-conflict-a`;
    const conflictClientB = `${testPrefix}:valid-conflict-b`;
    const conflictWeekA = conflictSlotA.weekIndex;
    const conflictWorkoutA = conflictSlotA.workoutIndex;
    const conflictWeekB = conflictSlotB.weekIndex;
    const conflictWorkoutB = conflictSlotB.workoutIndex;
    const conflictProofKeyA = `${testPrefix}:program:7:${conflictWeekA}:${conflictWorkoutA}`;
    const conflictProofKeyB = `${testPrefix}:program:7:${conflictWeekB}:${conflictWorkoutB}`;
    const sharedValidConflictPath = `${user.id}/${testPrefix}/shared-valid-conflict.webp`;
    storagePaths.push(sharedValidConflictPath);
    const conflictRowA = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: conflictSlotA.completionKey,
        client_record_id: conflictClientA,
        week_index: conflictWeekA,
        workout_index: conflictWorkoutA,
      },
      createdWorkoutIds,
      'Valid conflict seed A',
    );
    const conflictRowB = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: conflictSlotB.completionKey,
        client_record_id: conflictClientB,
        week_index: conflictWeekB,
        workout_index: conflictWorkoutB,
      },
      createdWorkoutIds,
      'Valid conflict seed B',
    );
    await uploadProofBlob(client, sharedValidConflictPath);
    const conflictProofA = await createProof(client, {
      p_proof_key: conflictProofKeyA,
      p_linked_record_id: conflictClientA,
      p_storage_path: sharedValidConflictPath,
      p_week_index: conflictWeekA,
      p_workout_index: conflictWorkoutA,
    });
    assert(!conflictProofA.error && conflictProofA.data?.id, `Valid conflict seed A must succeed: ${conflictProofA.error?.message || 'unknown'}`);
    createdAttachmentIds.push(conflictProofA.data.id);
    const { error: validConflictError } = await createProof(client, {
      p_proof_key: conflictProofKeyB,
      p_linked_record_id: conflictClientB,
      p_storage_path: sharedValidConflictPath,
      p_week_index: conflictWeekB,
      p_workout_index: conflictWorkoutB,
    });
    assert(!!validConflictError, 'Same storage path with a second valid logical identity must be rejected');
    assert(String(validConflictError.message || '').includes('idempotency key conflict'), `Expected idempotency conflict, got: ${validConflictError.message || 'unknown'}`);

    const replaceMileKey = `${testPrefix}:replace-concurrent-mile`;
    const replaceClientId = `${testPrefix}:replace-concurrent-client`;
    const { data: replaceMileRow, error: replaceMileError } = await client.from('mile_tests').insert({
      user_id: user.id,
      test_key: replaceMileKey,
      client_record_id: replaceClientId,
    }).select('id').single();
    assert(!replaceMileError && replaceMileRow?.id, `Could not seed replace concurrent mile test: ${replaceMileError?.message || 'unknown'}`);
    createdMileTestIds.push(replaceMileRow.id);
    const replaceOldPath = `${user.id}/${replaceMileKey}/old-current.webp`;
    const replaceNewPath = `${user.id}/${replaceMileKey}/new-replacement.webp`;
    storagePaths.push(replaceOldPath, replaceNewPath);
    await uploadProofBlob(client, replaceOldPath);
    await uploadProofBlob(client, replaceNewPath);
    const replaceBaseParams = {
      p_proof_key: replaceMileKey,
      p_linked_record_id: replaceClientId,
    };
    const replaceOldProof = await createProof(client, { ...replaceBaseParams, p_storage_path: replaceOldPath });
    assert(!replaceOldProof.error && replaceOldProof.data?.id, `Old current proof must succeed: ${replaceOldProof.error?.message || 'unknown'}`);
    createdAttachmentIds.push(replaceOldProof.data.id);
    const [replaceConcurrentA, replaceConcurrentB] = await Promise.all([
      createProof(client, { ...replaceBaseParams, p_storage_path: replaceNewPath }),
      createProof(client, { ...replaceBaseParams, p_storage_path: replaceNewPath }),
    ]);
    assert(!replaceConcurrentA.error && replaceConcurrentA.data?.id, `Replace concurrent A must succeed: ${replaceConcurrentA.error?.message || 'unknown'}`);
    assert(!replaceConcurrentB.error && replaceConcurrentB.data?.id, `Replace concurrent B must succeed: ${replaceConcurrentB.error?.message || 'unknown'}`);
    assert(replaceConcurrentA.data.id === replaceConcurrentB.data.id, 'Concurrent replacement path must converge on one attachment id');
    if (replaceConcurrentB.data.id !== replaceOldProof.data.id) {
      createdAttachmentIds.push(replaceConcurrentB.data.id);
    }
    const { data: oldAfterReplace } = await client
      .from('workout_attachments')
      .select('is_current')
      .eq('id', replaceOldProof.data.id)
      .single();
    const { data: newAfterReplace } = await client
      .from('workout_attachments')
      .select('is_current')
      .eq('id', replaceConcurrentA.data.id)
      .single();
    assert(oldAfterReplace?.is_current === false, 'Old current proof must become non-current after replacement');
    assert(newAfterReplace?.is_current === true, 'Concurrent replacement proof must remain current');
    const { count: replaceNewCount } = await client
      .from('workout_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('storage_path', replaceNewPath);
    assert(replaceNewCount === 1, `Replacement path must create exactly one row, got ${replaceNewCount}`);

    // ── Layer C schema fingerprint: workout_completions uniqueness contract ──
    const fingerprintSlot = allocTestSlot(0);
    const fingerprintWeek = fingerprintSlot.weekIndex;
    const fingerprintWorkout = fingerprintSlot.workoutIndex;
    const fingerprintKey = fingerprintSlot.completionKey;
    const fingerprintClientA = `${testPrefix}:fingerprint-client-a`;
    const fingerprintClientB = `${testPrefix}:fingerprint-client-b`;
    const fingerprintRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: fingerprintKey,
        client_record_id: fingerprintClientA,
        week_index: fingerprintWeek,
        workout_index: fingerprintWorkout,
        workout_type: 'Easy Run',
        proof_pending: false,
        record_json: { id: fingerprintClientA },
      },
      createdWorkoutIds,
      'Schema fingerprint seed',
    );

    const { error: fingerprintKeyConflict } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: fingerprintKey,
      client_record_id: `${testPrefix}:fingerprint-key-conflict`,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout + 1,
      workout_type: 'Easy Run',
      record_json: {},
    });
    assertUniqueViolation(fingerprintKeyConflict, UNIQUE_CONFLICT.COMPLETION_KEY, 'Schema fingerprint completion_key');

    const { error: fingerprintPositionConflict } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${testPrefix}:fingerprint-position`,
      client_record_id: fingerprintClientB,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout,
      workout_type: 'Easy Run',
      record_json: {},
    });
    assertUniqueViolation(fingerprintPositionConflict, UNIQUE_CONFLICT.POSITION, 'Schema fingerprint week/workout');

    const { error: fingerprintClientConflict } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${testPrefix}:fingerprint-client-key`,
      client_record_id: fingerprintClientA,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout + 2,
      workout_type: 'Easy Run',
      record_json: {},
    });
    assertUniqueViolation(fingerprintClientConflict, UNIQUE_CONFLICT.CLIENT_RECORD_ID, 'Schema fingerprint client_record_id');

    // ── Shared-algorithm next-day chaos (SoT §9) — uses production reconcile path ──
    const identitySlot = allocTestSlot(2);
    const identityWeek = identitySlot.weekIndex;
    const identityWorkout = identitySlot.workoutIndex;
    const legacyIdentityKey = `${testPrefix}:stale-completion-key`;
    const identityClientId = `${testPrefix}:identity-client`;
    const stagedIdentityRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: legacyIdentityKey,
        client_record_id: identityClientId,
        week_index: identityWeek,
        workout_index: identityWorkout,
        workout_type: 'Threshold Run',
        proof_pending: true,
        completed_at: null,
        record_json: {
          id: identityClientId,
          status: 'pending_proof',
          workoutContext: { weekIndex: identityWeek, workoutIndex: identityWorkout, workoutType: 'Threshold Run' },
        },
      },
      createdWorkoutIds,
      'Legacy identity seed',
      'id, completion_key, proof_pending, client_record_id',
    );
    assert(!isVisibleCompletionRow(stagedIdentityRow), 'proof_pending rows must stay hidden');

    const retryIdentityRecord = {
      id: `${testPrefix}:retry-client`,
      completionKey: legacyIdentityKey,
      workoutContext: {
        weekIndex: identityWeek,
        workoutIndex: identityWorkout,
        workoutType: 'Threshold Run',
      },
      workoutLog: {
        totalMinutes: 40,
        avgBpm: 150,
        maxBpm: 165,
        completedAt: new Date().toISOString(),
      },
      completedAt: new Date().toISOString(),
    };
    assert(getCompletionKeyFromRecord(retryIdentityRecord) === `${identityWeek}:${identityWorkout}`, 'canonical key required');

    const dayBEnsure = await ensureWorkoutIdentityReconciled(client, user.id, retryIdentityRecord);
    assert(dayBEnsure.reused === true, 'Day B ensure must reuse the existing provisional row');
    assert(dayBEnsure.rollbackOwned === false, 'Reused provisional must not be rollback-owned');
    assert(dayBEnsure.clientRecordId === identityClientId, 'Ensure must keep Day A client_record_id');

    const rolledBack = await rollbackWorkoutIdentityIfOwned(client, user.id, retryIdentityRecord, dayBEnsure);
    assert(rolledBack === false, 'Deterministic-failure rollback must NOT delete reused Day A row');
    const { data: afterFailedRollback } = await client
      .from('workout_completions')
      .select('id, client_record_id, proof_pending')
      .eq('id', stagedIdentityRow.id)
      .maybeSingle();
    assert(afterFailedRollback?.id === stagedIdentityRow.id, 'Day A provisional row must still exist after non-owned rollback');
    assert(afterFailedRollback.client_record_id === identityClientId, 'Day A client_record_id must be preserved');

    const saveResult = await saveWorkoutCompletionReconciled(client, user.id, retryIdentityRecord);
    assert(saveResult?.rowId === stagedIdentityRow.id, 'Production save path must update the positional Day A row');
    const { data: finalizedIdentity } = await client
      .from('workout_completions')
      .select('id, completion_key, proof_pending, total_minutes, avg_bpm, week_index, workout_index, client_record_id')
      .eq('id', stagedIdentityRow.id)
      .single();
    assert(finalizedIdentity.completion_key === `${identityWeek}:${identityWorkout}`, 'Save must repair completion_key');
    assert(finalizedIdentity.proof_pending === false, 'Save must finalize proof_pending');
    assert(isVisibleCompletionRow(finalizedIdentity), 'Finalized row must be visible');
    assert(Number(finalizedIdentity.total_minutes) === 40, 'Save must persist requested minutes');

    const secondSave = await saveWorkoutCompletionReconciled(client, user.id, {
      ...retryIdentityRecord,
      id: identityClientId,
      workoutLog: {
        ...retryIdentityRecord.workoutLog,
        totalMinutes: 41,
        completedAt: new Date().toISOString(),
      },
    });
    assert(secondSave?.rowId === stagedIdentityRow.id, 'Complete x2 must converge on the same row id');
    const { data: secondRead } = await client
      .from('workout_completions')
      .select('id, total_minutes, proof_pending')
      .eq('id', stagedIdentityRow.id)
      .single();
    assert(Number(secondRead.total_minutes) === 41, 'Second complete must overwrite metrics on same identity');

    const { count: identityCount } = await client
      .from('workout_completions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('week_index', identityWeek)
      .eq('workout_index', identityWorkout);
    assert(identityCount === 1, `Retry must converge on one row, got ${identityCount}`);

    // ── Golden finalize lifecycle: provisional → proof RPC → finalize → fresh visible SELECT ──
    const goldenSlot = allocTestSlot(4);
    const goldenWeek = goldenSlot.weekIndex;
    const goldenWorkout = goldenSlot.workoutIndex;
    const goldenClientId = `${testPrefix}:golden-long-run`;
    const goldenProofKey = `${testPrefix}:golden-long-run-proof`;
    const goldenPath = `${user.id}/${goldenProofKey}/finalize.webp`;
    const goldenProvisional = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: goldenSlot.completionKey,
        client_record_id: goldenClientId,
        week_index: goldenWeek,
        workout_index: goldenWorkout,
        workout_type: 'Long Run + S&C',
        proof_pending: true,
        completed_at: null,
        record_json: {
          id: goldenClientId,
          status: 'pending_proof',
          workoutContext: { weekIndex: goldenWeek, workoutIndex: goldenWorkout, workoutType: 'Long Run + S&C' },
        },
      },
      createdWorkoutIds,
      'Golden provisional seed',
      'id, completion_key, proof_pending, week_index, workout_index',
    );
    assert(!isVisibleCompletionRow(goldenProvisional), 'Golden provisional must stay hidden from cloud hydration');

    await uploadProofBlob(client, goldenPath);
    storagePaths.push(goldenPath);
    const { data: goldenProof, error: goldenProofError } = await createProof(client, {
      p_proof_key: goldenProofKey,
      p_linked_record_id: goldenClientId,
      p_storage_path: goldenPath,
      p_week_index: goldenWeek,
      p_workout_index: goldenWorkout,
      p_workout_type: 'Long Run + S&C',
    });
    assert(!goldenProofError && goldenProof?.id, `Golden proof RPC failed: ${goldenProofError?.message || 'unknown'}`);
    createdAttachmentIds.push(goldenProof.id);

    const goldenRecord = {
      id: goldenClientId,
      workoutContext: {
        weekIndex: goldenWeek,
        workoutIndex: goldenWorkout,
        workoutType: 'Long Run + S&C',
      },
      workoutLog: {
        totalMinutes: 45,
        avgBpm: 142,
        maxBpm: 168,
        distance: 3.5,
        completedAt: new Date().toISOString(),
      },
      completedAt: new Date().toISOString(),
      attachment: { id: goldenProof.id },
      proofPolicyVersion: 1,
    };
    const goldenSave = await saveWorkoutCompletionReconciled(client, user.id, goldenRecord);
    assert(goldenSave?.rowId === goldenProvisional.id, 'Golden finalize must update the provisional row');
    assert(goldenSave?.verified?.proof_pending === false, 'Golden finalize must verify proof_pending=false');
    assert(!!goldenSave?.verified?.completed_at, 'Golden finalize must verify completed_at');
    assert(String(goldenSave?.verified?.attachment_id) === String(goldenProof.id), 'Golden finalize must verify attachment_id');

    const { data: goldenFreshRows, error: goldenFreshError } = await client
      .from('workout_completions')
      .select('id, completion_key, proof_pending, week_index, workout_index, completed_at, attachment_id, total_minutes')
      .eq('user_id', user.id)
      .eq('week_index', goldenWeek)
      .eq('workout_index', goldenWorkout);
    assert(!goldenFreshError, `Golden fresh SELECT failed: ${goldenFreshError?.message || 'unknown'}`);
    const goldenVisible = (goldenFreshRows || []).filter(isVisibleCompletionRow);
    assert(goldenVisible.length === 1, `Fresh client must see exactly one visible Long Run completion, got ${goldenVisible.length}`);
    assert(goldenVisible[0].id === goldenProvisional.id, 'Fresh visible row must be the finalized provisional identity');
    assert(goldenVisible[0].proof_pending === false, 'Fresh visible row must not be proof_pending');
    assert(!!goldenVisible[0].completed_at, 'Fresh visible row must have completed_at');
    assert(String(goldenVisible[0].attachment_id) === String(goldenProof.id), 'Fresh visible row must keep attachment');
    assert(Number(goldenVisible[0].total_minutes) === 45, 'Fresh visible row must keep finalized metrics');

    // Dual mismatched rows: position must win / explicit conflict when keys disagree.
    const dualSlot = allocTestSlot(1);
    const dualWrongSlot = allocTestSlot(0);
    const dualWeek = dualSlot.weekIndex;
    const dualWorkout = dualSlot.workoutIndex;
    const dualKeyRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: dualSlot.completionKey,
        client_record_id: `${testPrefix}:dual-key-row`,
        week_index: dualWrongSlot.weekIndex,
        workout_index: dualWrongSlot.workoutIndex,
        workout_type: 'Easy Run',
        record_json: {},
      },
      createdWorkoutIds,
      'Dual-key seed',
    );
    const dualPosRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: `${testPrefix}:dual-legacy-pos`,
        client_record_id: `${testPrefix}:dual-pos-row`,
        week_index: dualWeek,
        workout_index: dualWorkout,
        workout_type: 'Threshold Run',
        record_json: {},
      },
      createdWorkoutIds,
      'Dual-position seed',
    );

    let dualError = null;
    try {
      await findWorkoutCompletionIdentity(client, user.id, {
        id: `${testPrefix}:dual-retry`,
        workoutContext: { weekIndex: dualWeek, workoutIndex: dualWorkout },
      });
    } catch (error) {
      dualError = error;
    }
    assert(dualError?.workoutIdentityConflict === 'dual_row', 'Mismatched key/position rows must raise explicit dual-row conflict');

    // Key-only wrong-position disagreement: key exists, correct position absent.
    const keyMismatchSlot = allocTestSlot(1);
    const wrongStoredSlot = allocTestSlot(0);
    const mismatchWeek = keyMismatchSlot.weekIndex;
    const mismatchWorkout = keyMismatchSlot.workoutIndex;
    const wrongPosKeyRow = await insertWorkoutOrFailClosed(
      client,
      {
        user_id: user.id,
        completion_key: keyMismatchSlot.completionKey,
        client_record_id: `${testPrefix}:wrong-pos-key`,
        week_index: wrongStoredSlot.weekIndex,
        workout_index: wrongStoredSlot.workoutIndex,
        workout_type: 'Easy Run',
        total_minutes: 30,
        avg_bpm: 140,
        proof_pending: false,
        record_json: { id: `${testPrefix}:wrong-pos-key` },
      },
      createdWorkoutIds,
      'Wrong-position key seed',
      'id, completion_key, week_index, workout_index, total_minutes',
    );

    let keyMismatchError = null;
    try {
      await findWorkoutCompletionIdentity(client, user.id, {
        id: `${testPrefix}:wrong-pos-retry`,
        workoutContext: { weekIndex: mismatchWeek, workoutIndex: mismatchWorkout },
        workoutLog: { totalMinutes: 40, avgBpm: 150, maxBpm: 165 },
      });
    } catch (error) {
      keyMismatchError = error;
    }
    assert(
      keyMismatchError?.workoutIdentityConflict === 'key_position_mismatch',
      'Key row at wrong position must raise explicit key_position_mismatch',
    );

    let saveMismatchError = null;
    try {
      await saveWorkoutCompletionReconciled(client, user.id, {
        id: `${testPrefix}:wrong-pos-retry`,
        workoutContext: { weekIndex: mismatchWeek, workoutIndex: mismatchWorkout },
        workoutLog: { totalMinutes: 40, avgBpm: 150, maxBpm: 165, completedAt: new Date().toISOString() },
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      saveMismatchError = error;
    }
    assert(
      saveMismatchError?.workoutIdentityConflict === 'key_position_mismatch',
      'Save must not silently mutate a key row that points at another position',
    );

    const { data: unchangedWrongPos } = await client
      .from('workout_completions')
      .select('id, week_index, workout_index, total_minutes, completion_key')
      .eq('id', wrongPosKeyRow.id)
      .single();
    assert(Number(unchangedWrongPos.week_index) === wrongStoredSlot.weekIndex, 'Wrong-position key row week must remain unchanged');
    assert(Number(unchangedWrongPos.workout_index) === wrongStoredSlot.workoutIndex, 'Wrong-position key row workout must remain unchanged');
    assert(Number(unchangedWrongPos.total_minutes) === 30, 'Wrong-position key row metrics must remain unchanged');
    assert(unchangedWrongPos.completion_key === keyMismatchSlot.completionKey, 'Wrong-position key must remain unchanged');

    const { count: mismatchPosCount } = await client
      .from('workout_completions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('week_index', mismatchWeek)
      .eq('workout_index', mismatchWorkout);
    assert(mismatchPosCount === 0, 'No new row may be created at the requested position after key-position conflict');

    assert(
      testSlotBase > MAX_REAL_PROGRAM_WEEK_INDEX,
      `Layer C test namespace ${testSlotBase} must be outside real program domain 0..${MAX_REAL_PROGRAM_WEEK_INDEX}`,
    );
    assert(nextTestSlotOffset > 0, 'Layer C must allocate isolated workout positions');
    assert(ownedSlot.completionKey === `${ownedSlot.weekIndex}:${ownedSlot.workoutIndex}`, 'Generated completion key must match generated position');
    assert(Number(ownedSlot.weekIndex) > MAX_REAL_PROGRAM_WEEK_INDEX, 'Owned workout seed must stay outside real program domain');

    assert(canaryId && canarySnapshot, 'Isolation canary must be present for Layer C regression');
    assert(!createdWorkoutIds.includes(canaryId), 'Isolation canary must never enter createdWorkoutIds cleanup list');
    const { data: canaryAfter, error: canaryAfterError } = await client
      .from('workout_completions')
      .select('id, completion_key, week_index, workout_index, client_record_id, attachment_id, total_minutes, proof_pending, updated_at')
      .eq('id', canaryId)
      .maybeSingle();
    assert(!canaryAfterError, `Isolation canary post-check failed: ${canaryAfterError?.message || 'unknown'}`);
    assert(canaryAfter?.id === canarySnapshot.id, 'Real 1:2 canary row ID must remain unchanged');
    assert(canaryAfter.completion_key === REAL_CANARY_KEY, 'Real 1:2 completion_key must remain unchanged');
    assert(Number(canaryAfter.week_index) === REAL_CANARY_WEEK, 'Real 1:2 week_index must remain unchanged');
    assert(Number(canaryAfter.workout_index) === REAL_CANARY_WORKOUT, 'Real 1:2 workout_index must remain unchanged');
    assert(canaryAfter.client_record_id === canarySnapshot.client_record_id, 'Real 1:2 client_record_id must remain unchanged');
    assert(
      String(canaryAfter.attachment_id || '') === String(canarySnapshot.attachment_id || ''),
      'Real 1:2 attachment_id must remain unchanged',
    );
    assert(
      Number(canaryAfter.total_minutes ?? NaN) === Number(canarySnapshot.total_minutes ?? NaN)
        || (canaryAfter.total_minutes == null && canarySnapshot.total_minutes == null),
      'Real 1:2 total_minutes must remain unchanged',
    );
    if (canaryCreatedByThisRun) {
      canaryCleanupIds.push(canaryId);
    }

    console.log('PASS: proof authorization matrix');
  } finally {
    // Cleanup only IDs created by this run. Never delete a pre-existing real-slot row.
    const safeWorkoutCleanupIds = createdWorkoutIds.filter(
      (id) => !(canaryId && id === canaryId && !canaryCreatedByThisRun),
    );
    if (canaryCreatedByThisRun && canaryId && !canaryCleanupIds.includes(canaryId)) {
      canaryCleanupIds.push(canaryId);
    }
    cleanupErrors = await runCleanup(client, {
      attachmentIds: createdAttachmentIds,
      mileTestIds: createdMileTestIds,
      workoutIds: [...safeWorkoutCleanupIds, ...canaryCleanupIds],
      storagePaths,
    });
  }

  if (cleanupErrors.length) {
    throw new Error(cleanupErrors.join('; '));
  }
}

run().catch((error) => {
  console.error('FAIL:', error.message || error);
  process.exit(1);
});
