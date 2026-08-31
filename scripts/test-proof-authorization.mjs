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
 * Optional second account for foreign-path tests:
 *   RING_READY_TEST_EMAIL_B
 *   RING_READY_TEST_PASSWORD_B
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.RING_READY_SUPABASE_URL || process.env.SUPABASE_URL || '';
const anonKey = process.env.RING_READY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const email = process.env.RING_READY_TEST_EMAIL || '';
const password = process.env.RING_READY_TEST_PASSWORD || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function signIn(client, userEmail, userPassword) {
  const { data, error } = await client.auth.signInWithPassword({ email: userEmail, password: userPassword });
  if (error) throw error;
  return data.user;
}

async function run() {
  if (!url || !anonKey || !email || !password) {
    console.log('SKIP: set RING_READY_SUPABASE_URL, RING_READY_SUPABASE_ANON_KEY, RING_READY_TEST_EMAIL, RING_READY_TEST_PASSWORD');
    process.exit(0);
  }

  const client = createClient(url, anonKey);
  const user = await signIn(client, email, password);
  assert(user?.id, 'Authenticated user required');

  const proofKey = `test-proof:${Date.now()}`;
  const storagePath = `${user.id}/${proofKey}/auth-test.webp`;

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

  const { error: directInsertError } = await client.from('workout_attachments').insert({
    user_id: user.id,
    proof_key: proofKey,
    storage_path: storagePath,
    file_size: 1024,
    mime_type: 'image/webp',
  });
  assert(!!directInsertError, 'Direct INSERT must be rejected');

  const blob = new Blob([new Uint8Array(1024)], { type: 'image/webp' });
  await client.storage.from('workout-proof-staging').upload(storagePath, blob, { upsert: true });

  const { data: created, error: createError } = await client.rpc('create_workout_proof_attachment', {
    p_proof_key: proofKey,
    p_linked_record_id: 'test-record',
    p_storage_path: storagePath,
    p_original_filename: 'auth-test.webp',
    p_mime_type: 'image/webp',
    p_file_size: 1024,
  });
  assert(!createError && created?.id, `RPC create failed: ${createError?.message || 'unknown'}`);

  const { count: currentCount } = await client
    .from('workout_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('proof_key', proofKey)
    .eq('is_current', true);
  assert(currentCount === 1, 'Exactly one current proof expected');

  await client.storage.from('workout-proof-staging').remove([storagePath]);
  console.log('PASS: proof authorization matrix');
  process.exit(0);
}

run().catch((error) => {
  console.error('FAIL:', error.message || error);
  process.exit(1);
});
