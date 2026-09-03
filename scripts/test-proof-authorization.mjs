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

const url = process.env.RING_READY_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey = process.env.RING_READY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const email = process.env.RING_READY_TEST_EMAIL || '';
const password = process.env.RING_READY_TEST_PASSWORD || '';
const requireTests = process.env.RING_READY_REQUIRE_PROOF_TESTS === '1';
const testPrefix = `auth-test:${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

    const workoutClientId = `${testPrefix}:workout-client-id`;
    const workoutProofKey = `${testPrefix}:program:7:1:2`;
    const { data: workoutRow, error: workoutInsertError } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: '1:2',
      client_record_id: workoutClientId,
      week_index: 1,
      workout_index: 2,
    }).select('id').single();
    assert(!workoutInsertError && workoutRow?.id, `Could not seed owned workout: ${workoutInsertError?.message || 'unknown'}`);
    createdWorkoutIds.push(workoutRow.id);

    const workoutPath = `${user.id}/${workoutProofKey}/workout.webp`;
    storagePaths.push(workoutPath);
    await uploadProofBlob(client, workoutPath);
    const { error: wrongWorkoutContextError } = await createProof(client, {
      p_proof_key: workoutProofKey,
      p_linked_record_id: workoutClientId,
      p_storage_path: workoutPath,
      p_week_index: 0,
      p_workout_index: 2,
    });
    assert(!!wrongWorkoutContextError, 'Owned workout with wrong week_index must be rejected');

    const { data: workoutProof, error: workoutProofError } = await createProof(client, {
      p_proof_key: workoutProofKey,
      p_linked_record_id: workoutClientId,
      p_storage_path: workoutPath,
      p_week_index: 1,
      p_workout_index: 2,
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

    const machineRecord = {
      id: `${testPrefix}:machine-client`,
      workoutContext: { weekIndex: 9, workoutIndex: 8, workoutType: 'Benchmark Run' },
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
    const { data: machineRow, error: machineUpsertError } = await client
      .from('workout_completions')
      .upsert(machinePayload, { onConflict: 'user_id,completion_key' })
      .select('id, modality, output_type, output_value, avg_watts, distance')
      .single();
    assert(
      !machineUpsertError && machineRow?.id,
      `Migration 014 machine upsert must succeed: ${machineUpsertError?.message || 'unknown'}`,
    );
    assert(machineRow.modality === 'assault_bike', 'Migration 014 must persist modality');
    assert(machineRow.output_type === 'watts', 'Migration 014 must persist output_type');
    assert(Number(machineRow.output_value) === 184, 'Migration 014 must persist output_value');
    assert(Number(machineRow.avg_watts) === 184, 'Migration 014 must persist avg_watts');
    assert(machineRow.distance === null, 'Migration 014 machine rows must keep distance null');
    createdWorkoutIds.push(machineRow.id);

    const legacyClientId = `${testPrefix}:legacy-distance`;
    const legacyWeek = 9;
    const legacyWorkout = 4;
    const { data: legacyRow, error: legacyInsertError } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${legacyWeek}:${legacyWorkout}`,
      client_record_id: legacyClientId,
      week_index: legacyWeek,
      workout_index: legacyWorkout,
      distance: 3.2,
      record_json: {
        id: legacyClientId,
        workoutContext: { weekIndex: legacyWeek, workoutIndex: legacyWorkout, workoutType: 'Benchmark Run' },
      },
    }).select('id, distance, modality, output_type, output_value').single();
    assert(!legacyInsertError && legacyRow?.id, `Could not seed legacy distance row: ${legacyInsertError?.message || 'unknown'}`);
    assert(Number(legacyRow.distance) === 3.2, 'Legacy SQL distance must remain intact on insert');
    createdWorkoutIds.push(legacyRow.id);
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

    const clearClientId = `${testPrefix}:clear-client`;
    const clearWeek = 9;
    const clearWorkout = 7;
    const clearProofKey = `${testPrefix}:program:7:${clearWeek}:${clearWorkout}`;
    const clearPath = `${user.id}/${clearProofKey}/clear.webp`;
    storagePaths.push(clearPath);
    const { data: clearCompletionRow, error: clearCompletionError } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${clearWeek}:${clearWorkout}`,
      client_record_id: clearClientId,
      week_index: clearWeek,
      workout_index: clearWorkout,
    }).select('id').single();
    assert(!clearCompletionError && clearCompletionRow?.id, `Could not seed clear-test completion: ${clearCompletionError?.message || 'unknown'}`);
    createdWorkoutIds.push(clearCompletionRow.id);
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

    const strandedClientId = `${testPrefix}:stranded-client`;
    const strandedWeek = 9;
    const strandedWorkout = 3;
    const strandedProofKey = `${testPrefix}:program:7:${strandedWeek}:${strandedWorkout}`;
    const strandedPath = `${user.id}/${strandedProofKey}/stranded.webp`;
    storagePaths.push(strandedPath);
    const { data: strandedCompletionRow, error: strandedCompletionError } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${strandedWeek}:${strandedWorkout}`,
      client_record_id: strandedClientId,
      week_index: strandedWeek,
      workout_index: strandedWorkout,
      attachment_id: null,
    }).select('id').single();
    assert(!strandedCompletionError && strandedCompletionRow?.id, `Could not seed stranded completion: ${strandedCompletionError?.message || 'unknown'}`);
    createdWorkoutIds.push(strandedCompletionRow.id);
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

    const mismatchClientA = `${testPrefix}:mismatch-a`;
    const mismatchClientB = `${testPrefix}:mismatch-b`;
    const mismatchWeekA = 9;
    const mismatchWorkoutA = 5;
    const mismatchWeekB = 9;
    const mismatchWorkoutB = 6;
    const mismatchProofKeyA = `${testPrefix}:program:7:${mismatchWeekA}:${mismatchWorkoutA}`;
    const mismatchProofKeyB = `${testPrefix}:program:7:${mismatchWeekB}:${mismatchWorkoutB}`;
    const mismatchPathA = `${user.id}/${mismatchProofKeyA}/a.webp`;
    const mismatchPathB = `${user.id}/${mismatchProofKeyB}/b.webp`;
    storagePaths.push(mismatchPathA, mismatchPathB);
    const { data: mismatchRowA } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${mismatchWeekA}:${mismatchWorkoutA}`,
      client_record_id: mismatchClientA,
      week_index: mismatchWeekA,
      workout_index: mismatchWorkoutA,
    }).select('id').single();
    const { data: mismatchRowB } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${mismatchWeekB}:${mismatchWorkoutB}`,
      client_record_id: mismatchClientB,
      week_index: mismatchWeekB,
      workout_index: mismatchWorkoutB,
    }).select('id').single();
    createdWorkoutIds.push(mismatchRowA.id, mismatchRowB.id);
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

    const conflictClientA = `${testPrefix}:valid-conflict-a`;
    const conflictClientB = `${testPrefix}:valid-conflict-b`;
    const conflictWeekA = 12;
    const conflictWorkoutA = 0;
    const conflictWeekB = 12;
    const conflictWorkoutB = 1;
    const conflictProofKeyA = `${testPrefix}:program:7:${conflictWeekA}:${conflictWorkoutA}`;
    const conflictProofKeyB = `${testPrefix}:program:7:${conflictWeekB}:${conflictWorkoutB}`;
    const sharedValidConflictPath = `${user.id}/${testPrefix}/shared-valid-conflict.webp`;
    storagePaths.push(sharedValidConflictPath);
    const { data: conflictRowA } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${conflictWeekA}:${conflictWorkoutA}`,
      client_record_id: conflictClientA,
      week_index: conflictWeekA,
      workout_index: conflictWorkoutA,
    }).select('id').single();
    const { data: conflictRowB } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${conflictWeekB}:${conflictWorkoutB}`,
      client_record_id: conflictClientB,
      week_index: conflictWeekB,
      workout_index: conflictWorkoutB,
    }).select('id').single();
    createdWorkoutIds.push(conflictRowA.id, conflictRowB.id);
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
    // Production must keep BOTH completion_key and positional uniqueness.
    const fingerprintWeek = 15;
    const fingerprintWorkout = 0;
    const fingerprintKey = `${fingerprintWeek}:${fingerprintWorkout}`;
    const fingerprintClientA = `${testPrefix}:fingerprint-client-a`;
    const fingerprintClientB = `${testPrefix}:fingerprint-client-b`;
    const { data: fingerprintRow, error: fingerprintInsertError } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: fingerprintKey,
      client_record_id: fingerprintClientA,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout,
      workout_type: 'Easy Run',
      proof_pending: false,
      record_json: { id: fingerprintClientA },
    }).select('id').single();
    assert(!fingerprintInsertError && fingerprintRow?.id, `Schema fingerprint seed failed: ${fingerprintInsertError?.message || 'unknown'}`);
    createdWorkoutIds.push(fingerprintRow.id);

    const { error: fingerprintKeyConflict } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: fingerprintKey,
      client_record_id: `${testPrefix}:fingerprint-key-conflict`,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout + 1,
      record_json: {},
    });
    assert(!!fingerprintKeyConflict, 'Schema fingerprint: completion_key uniqueness must reject duplicates');

    const { error: fingerprintPositionConflict } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${testPrefix}:fingerprint-position`,
      client_record_id: fingerprintClientB,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout,
      record_json: {},
    });
    assert(!!fingerprintPositionConflict, 'Schema fingerprint: week/workout uniqueness must reject duplicates');

    const { error: fingerprintClientConflict } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${testPrefix}:fingerprint-client-key`,
      client_record_id: fingerprintClientA,
      week_index: fingerprintWeek,
      workout_index: fingerprintWorkout + 2,
      record_json: {},
    });
    assert(!!fingerprintClientConflict, 'Schema fingerprint: non-empty client_record_id uniqueness must reject duplicates');

    // ── Cross-lifecycle database chaos (SoT §9 / next-day retry) ──
    // DAY A: provisional/staged row with legacy completion_key (hidden from athletes).
    // DAY B: fresh retry with canonical key must converge onto ONE finalized visible row.
    const identityWeek = 14;
    const identityWorkout = 2;
    const legacyIdentityKey = `${testPrefix}:stale-completion-key`;
    const identityClientId = `${testPrefix}:identity-client`;
    const { data: stagedIdentityRow, error: stagedIdentityError } = await client.from('workout_completions').insert({
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
    }).select('id, completion_key, proof_pending').single();
    assert(
      !stagedIdentityError && stagedIdentityRow?.id,
      `Could not seed legacy identity row: ${stagedIdentityError?.message || 'unknown'}`,
    );
    createdWorkoutIds.push(stagedIdentityRow.id);
    assert(stagedIdentityRow.proof_pending === true, 'Seeded legacy identity row must be proof_pending');
    assert(!isVisibleCompletionRow(stagedIdentityRow), 'proof_pending rows must stay hidden from athlete completion state');

    // DAY B hydrate simulation: completion_key lookup for canonical key misses.
    const { data: dayBKeyMiss, error: dayBKeyMissError } = await client
      .from('workout_completions')
      .select('id')
      .eq('user_id', user.id)
      .eq('completion_key', `${identityWeek}:${identityWorkout}`)
      .maybeSingle();
    assert(!dayBKeyMissError, `Day B key lookup failed: ${dayBKeyMissError?.message || 'unknown'}`);
    assert(!dayBKeyMiss, 'Day B canonical completion_key must miss against the legacy staged key');

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
    const canonicalIdentityKey = getCompletionKeyFromRecord(retryIdentityRecord);
    assert(
      canonicalIdentityKey === `${identityWeek}:${identityWorkout}`,
      'Valid week/workout context must produce the canonical completion key',
    );
    const reconcilePayload = buildWorkoutCloudPayload(retryIdentityRecord, user.id);
    assert(reconcilePayload.completion_key === canonicalIdentityKey, 'Cloud payload must use canonical completion key');

    const { error: naiveIdentityError } = await client
      .from('workout_completions')
      .upsert(reconcilePayload, { onConflict: 'user_id,completion_key' });
    assert(!!naiveIdentityError, 'Naive completion_key upsert must collide with positional uniqueness');
    assert(
      /duplicate key|week_index|unique constraint/i.test(String(naiveIdentityError.message || '')),
      `Expected positional unique collision, got: ${naiveIdentityError.message || 'unknown'}`,
    );

    const { data: positionalIdentity, error: positionalIdentityError } = await client
      .from('workout_completions')
      .select('id, completion_key, proof_pending, attachment_id')
      .eq('user_id', user.id)
      .eq('week_index', identityWeek)
      .eq('workout_index', identityWorkout)
      .maybeSingle();
    assert(
      !positionalIdentityError && positionalIdentity?.id === stagedIdentityRow.id,
      `Positional lookup must reuse the legacy row: ${positionalIdentityError?.message || 'missing'}`,
    );

    const { data: reconciledIdentity, error: reconcileIdentityError } = await client
      .from('workout_completions')
      .update(reconcilePayload)
      .eq('id', positionalIdentity.id)
      .select('id, completion_key, proof_pending, completed_at, week_index, workout_index')
      .single();
    assert(
      !reconcileIdentityError && reconciledIdentity?.id,
      `Legacy identity reconcile update must succeed: ${reconcileIdentityError?.message || 'unknown'}`,
    );
    assert(reconciledIdentity.completion_key === canonicalIdentityKey, 'Reconcile must repair completion_key');
    assert(reconciledIdentity.proof_pending === false, 'Reconcile must finalize proof_pending');
    assert(isVisibleCompletionRow(reconciledIdentity), 'Finalized row must be athlete-visible');
    assert(Number(reconciledIdentity.week_index) === identityWeek, 'Reconcile must keep week_index');
    assert(Number(reconciledIdentity.workout_index) === identityWorkout, 'Reconcile must keep workout_index');

    // Idempotent second complete (Complete x2) must update the same row, not insert.
    const secondCompletePayload = buildWorkoutCloudPayload({
      ...retryIdentityRecord,
      id: identityClientId,
      workoutLog: {
        ...retryIdentityRecord.workoutLog,
        totalMinutes: 41,
        completedAt: new Date().toISOString(),
      },
    }, user.id);
    const { data: secondCompleteRow, error: secondCompleteError } = await client
      .from('workout_completions')
      .update(secondCompletePayload)
      .eq('id', reconciledIdentity.id)
      .select('id, completion_key, total_minutes, proof_pending')
      .single();
    assert(!secondCompleteError && secondCompleteRow?.id === reconciledIdentity.id, 'Second complete must update same row');
    assert(Number(secondCompleteRow.total_minutes) === 41, 'Second complete must overwrite metrics on same identity');
    assert(secondCompleteRow.proof_pending === false, 'Second complete must remain finalized');

    const { count: identityCount, error: identityCountError } = await client
      .from('workout_completions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('week_index', identityWeek)
      .eq('workout_index', identityWorkout);
    assert(!identityCountError, `Could not count reconciled identity rows: ${identityCountError?.message || 'unknown'}`);
    assert(identityCount === 1, `Retry must converge on one row, got ${identityCount}`);

    const { error: secondPositionalInsertError } = await client.from('workout_completions').insert({
      user_id: user.id,
      completion_key: `${testPrefix}:second-positional`,
      client_record_id: `${testPrefix}:second-positional-client`,
      week_index: identityWeek,
      workout_index: identityWorkout,
      workout_type: 'Threshold Run',
      record_json: {},
    });
    assert(
      !!secondPositionalInsertError,
      'Migration 017 positional unique constraint must reject a second row for the same week/workout',
    );

    console.log('PASS: proof authorization matrix');
  } finally {
    cleanupErrors = await runCleanup(client, {
      attachmentIds: createdAttachmentIds,
      mileTestIds: createdMileTestIds,
      workoutIds: createdWorkoutIds,
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
