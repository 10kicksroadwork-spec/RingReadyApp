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
import { buildProvisionalMileTestCloudPayload } from '../src/cloud-record-mapper.js';

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
  if (uniqueAttachmentIds.length) {
    const { data: deletedCount, error: cleanupError } = await client.rpc('cleanup_test_workout_proof_attachments', {
      p_attachment_ids: uniqueAttachmentIds,
    });
    if (cleanupError) cleanupErrors.push(`Attachment cleanup failed: ${cleanupError.message}`);
    else if (deletedCount !== uniqueAttachmentIds.length) {
      cleanupErrors.push(`Expected ${uniqueAttachmentIds.length} attachment rows deleted, got ${deletedCount}`);
    }
  }
  if (mileTestIds.length) {
    const { error: mileCleanupError } = await client.from('mile_tests').delete().in('id', mileTestIds);
    if (mileCleanupError) cleanupErrors.push(`Mile test cleanup failed: ${mileCleanupError.message}`);
  }
  if (workoutIds.length) {
    const { error: workoutCleanupError } = await client.from('workout_completions').delete().in('id', workoutIds);
    if (workoutCleanupError) cleanupErrors.push(`Workout cleanup failed: ${workoutCleanupError.message}`);
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
