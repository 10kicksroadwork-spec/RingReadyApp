/** Deployment contract truth for athlete clients. Must stay secret-free. */

/** Must match src/build-info.js PROOF_CONTRACT_VERSION. */
const PROOF_CONTRACT_VERSION = 2;

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
  return String(process.env.VERCEL_ENV || process.env.NODE_ENV || 'development').trim();
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

function resolveSupabaseProjectRef() {
  const url = String(
    process.env.RING_READY_SUPABASE_URL
    || process.env.VITE_SUPABASE_URL
    || '',
  ).trim();
  if (!url) return null;
  return extractSupabaseProjectRef(url);
}

export default async function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  return res.status(200).json({
    ok: true,
    service: 'ringready',
    buildSha: resolveBuildSha(),
    proofContractVersion: PROOF_CONTRACT_VERSION,
    environment: resolveEnvironment(),
    supabaseProjectRef: resolveSupabaseProjectRef(),
  });
}
