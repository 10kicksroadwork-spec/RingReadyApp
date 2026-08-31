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

const url = process.env.RING_READY_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey = process.env.RING_READY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const email = process.env.RING_READY_TEST_EMAIL || '';
const password = process.env.RING_READY_TEST_PASSWORD || '';
const requireTests = process.env.RING_READY_REQUIRE_PROOF_TESTS === '1';

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

async function createProof(client, proofKey, storagePath, linkedRecordId = '') {
  return client.rpc('create_workout_proof_attachment', {
    p_proof_key: proofKey,
    p_linked_record_id: linkedRecordId,
    p_storage_path: storagePath,
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/webp',
    p_file_size: 1024,
  });
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

  const proofKey = `test-proof:${Date.now()}`;
  const storagePath = `${user.id}/${proofKey}/auth-test.webp`;
  const storagePathB = `${user.id}/${proofKey}/auth-test-b.webp`;

  const { error: anonRpcError } = await createClient(url, anonKey).rpc('create_workout_proof_attachment', {
    p_proof_key: proofKey,
    p_linked_record_id: 'test-record',
    p_storage_path: storagePath,
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/webp',
    p_file_size: 1024,
  });
  assert(!!anonRpcError, 'Anonymous RPC must be rejected');

  const { error: foreignPathError } = await client.rpc('create_workout_proof_attachment', {
    p_proof_key: proofKey,
    p_linked_record_id: 'test-record',
    p_storage_path: `00000000-0000-0000-0000-000000000099/${proofKey}/bad.webp`,
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/webp',
    p_file_size: 1024,
  });
  assert(!!foreignPathError, 'Foreign storage path must be rejected');

  const { error: forgedLinkError } = await client.rpc('create_workout_proof_attachment', {
    p_proof_key: proofKey,
    p_linked_record_id: '00000000-0000-0000-0000-000000000099',
    p_storage_path: storagePath,
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/webp',
    p_file_size: 1024,
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

  await uploadProofBlob(client, storagePath);

  const { data: created, error: createError } = await createProof(client, proofKey, storagePath);
  assert(!createError && created?.id, `RPC create failed: ${createError?.message || 'unknown'}`);
  assert(await countCurrentProofs(client, user.id, proofKey) === 1, 'Exactly one current proof expected');

  await uploadProofBlob(client, storagePathB);
  const { error: rollbackError } = await client.rpc('create_workout_proof_attachment', {
    p_proof_key: proofKey,
    p_linked_record_id: '',
    p_storage_path: storagePathB,
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/bmp',
    p_file_size: 1024,
  });
  assert(!!rollbackError, 'Invalid replacement RPC must fail');
  const { data: stillCurrent } = await client
    .from('workout_attachments')
    .select('id,is_current')
    .eq('user_id', user.id)
    .eq('proof_key', proofKey)
    .eq('is_current', true)
    .maybeSingle();
  assert(stillCurrent?.id === created.id, 'Old proof must remain current after failed replacement');

  const concurrentKey = `test-proof-concurrent:${Date.now()}`;
  const path1 = `${user.id}/${concurrentKey}/a.webp`;
  const path2 = `${user.id}/${concurrentKey}/b.webp`;
  await uploadProofBlob(client, path1);
  await uploadProofBlob(client, path2);
  const [first, second] = await Promise.all([
    createProof(client, concurrentKey, path1),
    createProof(client, concurrentKey, path2),
  ]);
  assert(!first.error || !second.error, 'At least one concurrent replacement should succeed');
  assert(await countCurrentProofs(client, user.id, concurrentKey) === 1, 'Concurrent replacements must leave one current proof');

  const ownedTestKey = `mile-test:auth:${Date.now()}`;
  const { data: mileRow, error: mileInsertError } = await client.from('mile_tests').insert({
    user_id: user.id,
    test_key: ownedTestKey,
  }).select('id').single();
  assert(!mileInsertError && mileRow?.id, `Could not seed owned mile test: ${mileInsertError?.message || 'unknown'}`);
  const ownedProofKey = `test-proof-owned:${Date.now()}`;
  const ownedPath = `${user.id}/${ownedProofKey}/owned.webp`;
  await uploadProofBlob(client, ownedPath);
  const { error: ownedLinkError } = await createProof(client, ownedProofKey, ownedPath, mileRow.id);
  assert(!ownedLinkError, `Owned linked_record_id must be accepted: ${ownedLinkError?.message || 'unknown'}`);

  await client.from('mile_tests').delete().eq('id', mileRow.id);
  await client.storage.from('workout-proof-staging').remove([storagePath, storagePathB, path1, path2, ownedPath]);
  console.log('PASS: proof authorization matrix');
  process.exit(0);
}

run().catch((error) => {
  console.error('FAIL:', error.message || error);
  process.exit(1);
});
