import { createClient } from '@supabase/supabase-js';

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

function sanitizeSheetText(value) {
  const text = String(value ?? '');
  if (!text || !FORMULA_PREFIX.test(text)) return text;
  return `'${text}`;
}

function sanitizeForSheets(value) {
  if (typeof value === 'string') {
    return sanitizeSheetText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForSheets);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeForSheets(child)]),
    );
  }
  return value;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    });
  }

  const supabaseUrl = String(process.env.RING_READY_SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(process.env.RING_READY_SUPABASE_ANON_KEY || '').trim();
  const appsScriptUrl = String(process.env.RING_READY_APPS_SCRIPT_SYNC_URL || '').trim();
  const relaySecret = String(process.env.RING_READY_SYNC_RELAY_SECRET || '').trim();

  if (!supabaseUrl || !supabaseAnonKey || !appsScriptUrl || !relaySecret) {
    return res.status(503).json({
      ok: false,
      error: 'Sync relay is not configured',
    });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'Missing access token',
    });
  }

  let incoming;
  try {
    incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({
      ok: false,
      error: 'Invalid JSON payload',
    });
  }

  if (
    !incoming
    || typeof incoming !== 'object'
    || Array.isArray(incoming)
    || !String(incoming.eventType || '').trim()
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid sync payload',
    });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid access token',
    });
  }

  const payload = sanitizeForSheets({
    ...incoming,
    userId: data.user.id,
  });
  payload._relaySecret = relaySecret;

  let upstream;
  try {
    upstream = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return res.status(502).json({
      ok: false,
      error: 'Sheets receiver unavailable',
    });
  }

  const raw = await upstream.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return res.status(502).json({
      ok: false,
      error: 'Invalid response from Sheets receiver',
    });
  }

  if (!upstream.ok || body?.ok !== true) {
    return res.status(502).json({
      ok: false,
      error: String(body?.error || 'Sheets receiver rejected sync'),
    });
  }

  return res.status(200).json(body);
}
