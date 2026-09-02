/** Deployment contract truth for athlete clients. Must stay secret-free. */

import { PROOF_CONTRACT_VERSION } from '../src/proof-contract-version.js';

function resolveBuildSha() {
  const full = String(
    process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GITHUB_SHA
    || '',
  ).trim();
  if (!full) return 'dev';
  return full.slice(0, 7);
}

function resolveEnvironment() {
  return String(
    process.env.VERCEL_ENV
    || process.env.NODE_ENV
    || 'development',
  ).trim();
}

function extractSupabaseProjectRef(url) {
  try {
    const hostname = new URL(url).hostname;
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function resolveProjectRef(envName) {
  const url = String(process.env[envName] || '').trim();
  if (!url) return null;
  return extractSupabaseProjectRef(url);
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Athlete/browser bundle target — must match import.meta.env.VITE_SUPABASE_URL.
  const supabaseProjectRef = resolveProjectRef('VITE_SUPABASE_URL');
  // Server-side sync relay target — used by api/sync.js only.
  const syncRelaySupabaseProjectRef = resolveProjectRef('RING_READY_SUPABASE_URL');
  const supabaseRefsMatch = supabaseProjectRef && syncRelaySupabaseProjectRef
    ? supabaseProjectRef === syncRelaySupabaseProjectRef
    : null;

  return res.status(200).json({
    ok: true,
    service: 'ringready',
    buildSha: resolveBuildSha(),
    proofContractVersion: PROOF_CONTRACT_VERSION,
    environment: resolveEnvironment(),
    supabaseProjectRef,
    syncRelaySupabaseProjectRef,
    supabaseRefsMatch,
  });
}
