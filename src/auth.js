import { isCoachEmail } from './coach-access.js';
import {
  buildMileTestCloudPayload,
  buildMileTestIdentityResult,
  buildWorkoutCloudPayload,
  buildWorkoutIdentityRecord,
  getCompletionKeyFromRecord,
  getRecordContext,
} from './cloud-record-mapper.js';
import { MODALITY_RUNNING, normalizeModality } from './modality.js';
import { isSupabaseConfigured, supabase } from './supabase-client.js';

let currentSession = null;
let authSubscription = null;

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured for this build.');
  }
  return supabase;
}

function normalizeCampLength(value) {
  return String(value) === '4' ? 4 : 7;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed);
}

function textOrEmpty(value) {
  return String(value || '').trim();
}

function safeJSON(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeISODate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapCloudProfile(row) {
  if (!row) return null;
  return {
    athleteName: row.athlete_name || '',
    age: row.age ? String(row.age) : '',
    gender: row.gender || '',
    genderDetail: row.gender_detail || '',
    trainingTenure: row.training_tenure || '',
    primaryDiscipline: '',
    weightClass: '',
    fightDate: row.fight_date || '',
    campLength: String(normalizeCampLength(row.camp_length)),
    defaultModality: normalizeModality(row.default_modality || MODALITY_RUNNING),
    campResetAt: row.camp_reset_at || '',
    updatedAt: row.updated_at || row.created_at || '',
  };
}

function toCloudProfile(profile, userId) {
  return {
    user_id: userId,
    athlete_name: textOrEmpty(profile.athleteName),
    age: profile.age ? Number(profile.age) : null,
    gender: textOrEmpty(profile.gender),
    gender_detail: textOrEmpty(profile.genderDetail),
    training_tenure: textOrEmpty(profile.trainingTenure),
    fight_date: profile.fightDate || null,
    camp_length: normalizeCampLength(profile.campLength),
    default_modality: normalizeModality(profile.defaultModality || MODALITY_RUNNING),
    updated_at: new Date().toISOString(),
  };
}

function mapCloudHRInfo(row) {
  if (!row) return null;
  return {
    goalWeight: row.goal_weight ?? '',
    targetDate: row.target_date || '',
    maxHr: row.max_hr ?? '',
    restingHr: row.resting_hr ?? '',
    updatedAt: row.updated_at || row.created_at || '',
  };
}

function toCloudHRInfo(hrInfo, userId) {
  return {
    user_id: userId,
    goal_weight: numberOrNull(hrInfo.goalWeight),
    target_date: hrInfo.targetDate || null,
    max_hr: integerOrNull(hrInfo.maxHr),
    resting_hr: integerOrNull(hrInfo.restingHr),
    updated_at: new Date().toISOString(),
  };
}

function mapCloudWorkoutCompletion(row) {
  if (!row) return null;
  const record = safeJSON(row.record_json, {});
  const context = getRecordContext(record);
  const fallbackContext = {
    weekIndex: row.week_index,
    workoutIndex: row.workout_index,
    weekLabel: row.week_label || '',
    weekTitle: row.week_title || '',
    dayOfWeek: row.day_of_week || '',
    workoutType: row.workout_type || '',
    description: row.description || '',
    warmup: row.warmup || '',
    targetZone: row.target_zone || '',
    targetBPM: row.target_bpm || null,
  };
  const nextContext = Object.keys(context).length ? context : fallbackContext;
  const workoutLog = record.workoutLog || (row.total_minutes ? {
    totalMinutes: row.total_minutes,
    totalSeconds: row.total_seconds,
    totalTimeDisplay: record.workoutLog?.totalTimeDisplay || '',
    avgBpm: row.avg_bpm,
    maxBpm: row.max_bpm,
    distance: row.distance,
    completedAt: row.completed_at,
  } : null);

  return {
    ...record,
    id: record.id || row.client_record_id || row.id,
    completionKey: row.completion_key || record.completionKey || getCompletionKeyFromRecord({ ...record, workoutContext: nextContext }),
    completedAt: row.completed_at || record.completedAt || row.updated_at || row.created_at,
    updatedAt: row.updated_at || row.completed_at || record.completedAt || row.created_at,
    workoutContext: record.workoutContext || nextContext,
    cfg: record.cfg || { workoutContext: nextContext },
    workoutLog,
  };
}

function mapCloudSprintSession(row) {
  if (!row) return null;
  const record = safeJSON(row.session_json, {});
  return {
    ...record,
    id: record.id || row.session_id || row.id,
    date: row.session_at || record.date || row.created_at,
    avgDrop: record.avgDrop ?? row.avg_drop ?? null,
    peakHR: record.peakHR ?? row.peak_hr ?? null,
  };
}

function toCloudSprintSession(record, userId) {
  const context = getRecordContext(record);
  const data = Array.isArray(record.data) ? record.data : [];
  return {
    user_id: userId,
    session_id: String(record.id || crypto.randomUUID?.() || Date.now()),
    session_at: normalizeISODate(record.date || record.completedAt),
    week_index: integerOrNull(context.weekIndex),
    workout_index: integerOrNull(context.workoutIndex),
    workout_type: textOrEmpty(context.workoutType || 'Sprint Intervals'),
    hr_source: textOrEmpty(record.hrSource || record.cfg?.hrSource || ''),
    reps_planned: integerOrNull(record.cfg?.reps || context.reps),
    rest_seconds: integerOrNull(record.cfg?.rest || context.restSeconds),
    max_hr: integerOrNull(record.cfg?.maxHR),
    target_pct: numberOrNull(record.cfg?.targetPct || context.targetPct),
    target_bpm: integerOrNull(context.targetBPM),
    intervals_completed: data.length,
    avg_drop: numberOrNull(record.avgDrop),
    peak_hr: integerOrNull(record.peakHR),
    proof_policy_version: integerOrNull(record.proofPolicyVersion),
    attachment_id: record.attachment?.id || null,
    session_json: record,
    updated_at: new Date().toISOString(),
  };
}

function mapCloudMileTest(row) {
  if (!row) return null;
  const result = safeJSON(row.result_json, {});
  return {
    ...result,
    id: result.id || row.client_record_id || row.id,
    testKey: row.test_key || result.testKey || 'mile-test:baseline',
    distance: row.distance ?? result.distance,
    totalMinutes: row.total_minutes ?? result.totalMinutes,
    totalSeconds: row.total_seconds ?? result.totalSeconds,
    avgBpm: row.avg_bpm ?? result.avgBpm,
    maxBpm: row.max_bpm ?? result.maxBpm,
    paceMinPerMile: row.pace_min_per_mile ?? result.paceMinPerMile,
    savedAt: row.saved_at || result.savedAt || row.updated_at || row.created_at,
  };
}

export async function initSupabaseAuth(onChange) {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentSession = data.session || null;

  if (!authSubscription) {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      currentSession = session || null;
      onChange?.(currentSession, event);
    });
    authSubscription = listener.subscription;
  }

  return currentSession;
}

export function getCurrentUser() {
  return currentSession?.user || null;
}

export function isCoachUser(user = getCurrentUser()) {
  return isCoachEmail(user?.email);
}

async function loadCoachTable(table, columns = '*') {
  const client = requireSupabase();
  const { data, error } = await client.from(table).select(columns);
  if (error) throw error;
  return data || [];
}

function settledRows(result) {
  return result.status === 'fulfilled' ? (result.value || []) : [];
}

function settledError(result) {
  if (result.status === 'fulfilled') return '';
  const message = String(result.reason?.message || result.reason || 'Load failed');
  return message;
}

const COACH_ROSTER_TABLES = [
  ['profiles', 'athlete_profiles'],
  ['hrRows', 'hr_info'],
  ['completions', 'workout_completions'],
  ['sprints', 'sprint_sessions'],
  ['mileTests', 'mile_tests'],
  ['notes', 'coach_notes'],
  ['exclusions', 'coach_roster_exclusions'],
  ['meta', 'coach_athlete_meta'],
];

// coach_roster_snapshot RPC is explicitly deferred. loadCoachRosterPayload() loads
// tables directly until a consolidated snapshot RPC ships.

export async function loadCoachRosterPayload() {
  if (!isSupabaseConfigured || !supabase || !isCoachUser()) return null;
  const client = requireSupabase();
  const [profilesResult, hrResult, completionsResult, sprintsResult, mileTestsResult, notesResult, identitiesResult, exclusionsResult, metaResult] = await Promise.allSettled([
    loadCoachTable('athlete_profiles', 'user_id,athlete_name,fight_date,camp_length,training_tenure,camp_reset_at,default_modality,updated_at'),
    loadCoachTable('hr_info', 'user_id,max_hr,resting_hr,goal_weight,target_date,updated_at'),
    loadCoachTable('workout_completions', 'user_id,completion_key,week_index,workout_index,week_label,week_title,day_of_week,workout_type,description,warmup,target_zone,target_bpm,total_minutes,total_seconds,avg_bpm,max_bpm,distance,completed_at,attachment_id,record_json,updated_at'),
    loadCoachTable('sprint_sessions', 'user_id,session_id,session_at,week_index,workout_index,workout_type,avg_drop,peak_hr,intervals_completed,attachment_id,session_json,updated_at'),
    loadCoachTable('mile_tests', 'user_id,test_key,saved_at,distance,total_minutes,avg_bpm,max_bpm,attachment_id,result_json,updated_at'),
    loadCoachTable('coach_notes', 'athlete_user_id,note,updated_at'),
    client.rpc('coach_roster_identities').then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
    loadCoachTable('coach_roster_exclusions'),
    loadCoachTable('coach_athlete_meta'),
  ]);
  const sourceErrors = {};
  const results = {
    profiles: profilesResult,
    hrRows: hrResult,
    completions: completionsResult,
    sprints: sprintsResult,
    mileTests: mileTestsResult,
    notes: notesResult,
    identities: identitiesResult,
    exclusions: exclusionsResult,
    meta: metaResult,
  };
  COACH_ROSTER_TABLES.forEach(([key]) => {
    const err = settledError(results[key]);
    if (err) sourceErrors[key] = err;
  });
  if (identitiesResult.status === 'rejected') sourceErrors.identities = settledError(identitiesResult);
  if (profilesResult.status === 'rejected') throw profilesResult.reason;
  return {
    profiles: settledRows(profilesResult),
    hrRows: settledRows(hrResult),
    completions: settledRows(completionsResult),
    sprints: settledRows(sprintsResult),
    mileTests: settledRows(mileTestsResult),
    notes: settledRows(notesResult),
    identities: settledRows(identitiesResult),
    exclusions: settledRows(exclusionsResult),
    meta: settledRows(metaResult),
    sourceErrors,
  };
}

export async function saveCoachCampStartDate(athleteUserId, campStartDate) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !isCoachUser() || !athleteUserId) return null;
  const { error } = await supabase
    .from('coach_athlete_meta')
    .upsert({
      athlete_user_id: athleteUserId,
      camp_start_date: campStartDate || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'athlete_user_id' });
  if (error) throw error;
  return true;
}

export async function saveCoachNote(athleteUserId, note) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !isCoachUser() || !athleteUserId) return null;
  const { error } = await supabase
    .from('coach_notes')
    .upsert({
      athlete_user_id: athleteUserId,
      note: String(note || '').trim(),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'athlete_user_id' });
  if (error) throw error;
  return true;
}

/**
 * Archive the current camp snapshot, then clear live training data.
 * Pass athleteUserId only when a coach is resetting another fighter.
 */
export async function archiveAndResetCamp({ athleteUserId = null, label = '' } = {}) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) {
    throw new Error('Sign in before starting a clean slate.');
  }
  const targetId = athleteUserId || user.id;
  if (athleteUserId && athleteUserId !== user.id && !isCoachUser()) {
    throw new Error('Only coaches can reset another athlete.');
  }
  const { data, error } = await supabase.rpc('archive_and_reset_camp', {
    target_user_id: athleteUserId && athleteUserId !== user.id ? athleteUserId : null,
    p_label: String(label || '').trim() || null,
  });
  if (error) throw error;
  return { archiveId: data, userId: targetId };
}

export async function signInWithEmail(email, password) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentSession = data.session || null;
  return data;
}

export async function signUpWithEmail(email, password) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  currentSession = data.session || currentSession;
  return data;
}

export async function requestPasswordReset(email) {
  const client = requireSupabase();
  const redirectTo = `${window.location.origin}${window.location.pathname || '/'}`;
  const { data, error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  return data;
}

export async function updatePassword(newPassword) {
  const client = requireSupabase();
  const { data, error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
  currentSession = data.session || currentSession;
  return data;
}

export function isPasswordRecoveryRedirect() {
  const hash = String(window.location.hash || '');
  const search = String(window.location.search || '');
  return /[?&#]type=recovery(?:&|$)/i.test(`${search}${hash}`)
    || /type=recovery/i.test(hash);
}

export function clearAuthRedirectParams() {
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    ['type', 'access_token', 'refresh_token', 'expires_in', 'token_type', 'error', 'error_code', 'error_description'].forEach((key) => {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  } catch (error) {
    // Ignore history cleanup failures.
  }
}

export async function signOut() {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  currentSession = null;
}

export async function loadCloudProfile() {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return null;

  const { data, error } = await supabase
    .from('athlete_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  return mapCloudProfile(data);
}

export async function saveCloudProfile(profile) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return null;

  const { data, error } = await supabase
    .from('athlete_profiles')
    .upsert(toCloudProfile(profile, user.id), { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return mapCloudProfile(data);
}

export async function loadCloudHRInfo() {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return null;

  const { data, error } = await supabase
    .from('hr_info')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  return mapCloudHRInfo(data);
}

export async function saveCloudHRInfo(hrInfo) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return null;

  const { data, error } = await supabase
    .from('hr_info')
    .upsert(toCloudHRInfo(hrInfo, user.id), { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return mapCloudHRInfo(data);
}

export async function loadCloudWorkoutCompletions() {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return {};

  const { data, error } = await supabase
    .from('workout_completions')
    .select('*')
    .eq('user_id', user.id);

  if (error) throw error;
  return (data || []).reduce((acc, row) => {
    const record = mapCloudWorkoutCompletion(row);
    if (record?.completionKey) acc[record.completionKey] = record;
    return acc;
  }, {});
}

export async function ensureCloudWorkoutIdentity(record) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !record?.id) return null;
  const identityRecord = buildWorkoutIdentityRecord(record);
  const payload = buildWorkoutCloudPayload(identityRecord, user.id);
  if (!payload.completion_key || !payload.client_record_id) return null;
  payload.attachment_id = null;
  payload.proof_policy_version = null;

  const { error } = await supabase
    .from('workout_completions')
    .upsert(payload, { onConflict: 'user_id,completion_key' });

  if (error) throw error;
  return payload.client_record_id;
}

export async function rollbackCloudWorkoutIdentity(record) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !record?.id) return false;
  const clientRecordId = textOrEmpty(record.id);
  if (!clientRecordId) return false;

  const { data, error } = await supabase
    .from('workout_completions')
    .select('id, attachment_id')
    .eq('user_id', user.id)
    .eq('client_record_id', clientRecordId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || data.attachment_id) return false;

  const { error: deleteError } = await supabase
    .from('workout_completions')
    .delete()
    .eq('id', data.id);
  if (deleteError) throw deleteError;
  return true;
}

export async function saveCloudWorkoutCompletion(record) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !record) return null;
  const payload = buildWorkoutCloudPayload(record, user.id);
  if (!payload.completion_key) return null;
  if (payload.completed_at === null && record.completedAt) {
    payload.completed_at = normalizeISODate(record.completedAt || record.date);
  }

  const { error } = await supabase
    .from('workout_completions')
    .upsert(payload, { onConflict: 'user_id,completion_key' });

  if (error) throw error;
  return record;
}

export async function deleteCloudWorkoutCompletion(weekIndex, workoutIndex) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return false;
  const week = Number(weekIndex);
  const workout = Number(workoutIndex);
  const completionKey = `${week}:${workout}`;

  // Prefer key delete, then fall back to week/workout columns in case older rows
  // were saved with a mismatched completion_key.
  const { data: byKey, error: keyError } = await supabase
    .from('workout_completions')
    .delete()
    .eq('user_id', user.id)
    .eq('completion_key', completionKey)
    .select('completion_key');
  if (keyError) throw keyError;

  const { data: byIndex, error: indexError } = await supabase
    .from('workout_completions')
    .delete()
    .eq('user_id', user.id)
    .eq('week_index', week)
    .eq('workout_index', workout)
    .select('completion_key');
  if (indexError) throw indexError;

  return true;
}

export async function loadCloudSprintSessions() {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return [];

  const { data, error } = await supabase
    .from('sprint_sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('session_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data || []).map(mapCloudSprintSession).filter(Boolean);
}

export async function saveCloudSprintSession(record) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !record) return null;

  const { error } = await supabase
    .from('sprint_sessions')
    .upsert(toCloudSprintSession(record, user.id), { onConflict: 'user_id,session_id' });

  if (error) throw error;
  return record;
}

export async function loadCloudMileTest(testKey = '') {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return null;

  let query = supabase
    .from('mile_tests')
    .select('*')
    .eq('user_id', user.id);

  if (testKey) query = query.eq('test_key', testKey);

  const { data, error } = await query
    .order('saved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return mapCloudMileTest(data);
}

export async function loadCloudMileTestByKey(testKey) {
  return loadCloudMileTest(String(testKey || '').trim());
}

export async function ensureCloudMileTestIdentity(result, hrInfo, testContext) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !result?.id) return null;
  const identityResult = buildMileTestIdentityResult(result, testContext);
  const payload = buildMileTestCloudPayload(identityResult, hrInfo, testContext, user.id);
  if (!payload.client_record_id || !payload.test_key) return null;
  payload.attachment_id = null;
  payload.proof_policy_version = null;

  const { error } = await supabase
    .from('mile_tests')
    .upsert(payload, { onConflict: 'user_id,test_key' });

  if (error) throw error;
  return payload.client_record_id;
}

export async function rollbackCloudMileTestIdentity(result, testContext) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !result?.id) return false;
  const clientRecordId = textOrEmpty(result.id);
  const testKey = String(testContext?.testKey || result.testKey || '').trim();
  if (!clientRecordId || !testKey) return false;

  const { data, error } = await supabase
    .from('mile_tests')
    .select('id, attachment_id')
    .eq('user_id', user.id)
    .eq('client_record_id', clientRecordId)
    .eq('test_key', testKey)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || data.attachment_id) return false;

  const { error: deleteError } = await supabase
    .from('mile_tests')
    .delete()
    .eq('id', data.id);
  if (deleteError) throw deleteError;
  return true;
}

export async function saveCloudMileTest(result, hrInfo, testContext) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !result) return null;

  const { error } = await supabase
    .from('mile_tests')
    .upsert(buildMileTestCloudPayload(result, hrInfo, testContext, user.id), { onConflict: 'user_id,test_key' });

  if (error) throw error;
  return result;
}