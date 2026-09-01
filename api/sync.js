import { createClient } from '@supabase/supabase-js';

const FORMULA_PREFIX = /^[=+\-@]/;

function sanitizeSheetText(value) {
  const text = String(value ?? '');
  if (!text || !FORMULA_PREFIX.test(text)) return text;
  return `'${text}`;
}

function sanitizePayloadStrings(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (typeof payload.athleteName === 'string') {
    payload.athleteName = sanitizeSheetText(payload.athleteName);
  }
  const log = payload.workoutLog;
  if (log && typeof log === 'object') {
    ['skipReason', 'skipReasonLabel', 'skipDetail', 'note'].forEach((key) => {
      if (typeof log[key] === 'string') log[key] = sanitizeSheetText(log[key]);
    });
  }
  const context = payload.workoutContext;
  if (context && typeof context === 'object') {
    ['description', 'warmup', 'workoutType', 'dayOfWeek', 'weekTab'].forEach((key) => {
      if (typeof context[key] === 'string') context[key] = sanitizeSheetText(context[key]);
    });
  }
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = String(process.env.RING_READY_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(process.env.RING_READY_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const appsScriptUrl = String(process.env.RING_READY_APPS_SCRIPT_SYNC_URL || process.env.VITE_RING_READY_SYNC_URL || '').trim();
  const relaySecret = String(process.env.RING_READY_SYNC_RELAY_SECRET || '').trim();

  if (!supabaseUrl || !supabaseAnonKey || !appsScriptUrl) {
    res.status(503).json({ ok: false, error: 'Sync relay is not configured' });
    return;
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing access token' });
    return;
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    res.status(401).json({ ok: false, error: 'Invalid access token' });
    return;
  }

  payload.userId = user.id;
  if (relaySecret) payload._relaySecret = relaySecret;
  sanitizePayloadStrings(payload);

  const headers = { 'Content-Type': 'application/json' };
  if (relaySecret) headers['X-Ring-Ready-Relay-Secret'] = relaySecret;

  const upstream = await fetch(appsScriptUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const raw = await upstream.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : { ok: upstream.ok };
  } catch {
    body = { ok: upstream.ok, raw };
  }

  res.status(upstream.ok ? 200 : 502).json(body);
}
