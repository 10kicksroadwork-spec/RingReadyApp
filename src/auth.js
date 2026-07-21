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

function getRecordContext(record = {}) {
  return record?.cfg?.workoutContext || record?.workoutContext || {};
}

function getCompletionKeyFromRecord(record = {}) {
  const context = getRecordContext(record);
  if (record.completionKey) return String(record.completionKey);
  if (Number.isFinite(Number(context.weekIndex)) && Number.isFinite(Number(context.workoutIndex))) {
    return `${Number(context.weekIndex)}:${Number(context.workoutIndex)}`;
  }
  return '';
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
    id: record.id || row.id,
    completionKey: row.completion_key || record.completionKey || getCompletionKeyFromRecord({ ...record, workoutContext: nextContext }),
    completedAt: row.completed_at || record.completedAt || row.updated_at || row.created_at,
    workoutContext: record.workoutContext || nextContext,
    cfg: record.cfg || { workoutContext: nextContext },
    workoutLog,
  };
}

function toCloudWorkoutCompletion(record, userId) {
  const context = getRecordContext(record);
  const workoutLog = record.workoutLog || null;
  return {
    user_id: userId,
    completion_key: getCompletionKeyFromRecord(record),
    week_index: integerOrNull(context.weekIndex),
    workout_index: integerOrNull(context.workoutIndex),
    week_label: textOrEmpty(context.weekLabel),
    week_title: textOrEmpty(context.weekTitle),
    day_of_week: textOrEmpty(context.dayOfWeek),
    workout_type: textOrEmpty(context.workoutType),
    description: textOrEmpty(context.description),
    warmup: textOrEmpty(context.warmup),
    target_zone: textOrEmpty(context.targetZone),
    target_bpm: integerOrNull(context.targetBPM),
    total_minutes: workoutLog ? numberOrNull(workoutLog.totalMinutes) : null,
    total_seconds: workoutLog ? integerOrNull(workoutLog.totalSeconds) : null,
    avg_bpm: workoutLog ? integerOrNull(workoutLog.avgBpm) : null,
    max_bpm: workoutLog ? integerOrNull(workoutLog.maxBpm) : null,
    distance: workoutLog ? numberOrNull(workoutLog.distance) : null,
    completed_at: normalizeISODate(record.completedAt || workoutLog?.completedAt || record.date),
    record_json: record,
    updated_at: new Date().toISOString(),
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
    session_json: record,
    updated_at: new Date().toISOString(),
  };
}

function mapCloudMileTest(row) {
  if (!row) return null;
  const result = safeJSON(row.result_json, {});
  return {
    ...result,
    distance: row.distance ?? result.distance,
    totalMinutes: row.total_minutes ?? result.totalMinutes,
    totalSeconds: row.total_seconds ?? result.totalSeconds,
    avgBpm: row.avg_bpm ?? result.avgBpm,
    maxBpm: row.max_bpm ?? result.maxBpm,
    paceMinPerMile: row.pace_min_per_mile ?? result.paceMinPerMile,
    savedAt: row.saved_at || result.savedAt || row.updated_at || row.created_at,
  };
}

function toCloudMileTest(result, hrInfo, testContext, userId) {
  return {
    user_id: userId,
    saved_at: normalizeISODate(result.savedAt),
    distance: numberOrNull(result.distance),
    total_minutes: numberOrNull(result.totalMinutes),
    total_seconds: integerOrNull(result.totalSeconds),
    pace_min_per_mile: numberOrNull(result.paceMinPerMile),
    avg_bpm: integerOrNull(result.avgBpm),
    max_bpm: integerOrNull(result.maxBpm),
    result_json: result,
    hr_info_json: hrInfo || null,
    test_context_json: testContext || null,
    updated_at: new Date().toISOString(),
  };
}

export async function initSupabaseAuth(onChange) {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentSession = data.session || null;

  if (!authSubscription) {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      currentSession = session || null;
      onChange?.(currentSession);
    });
    authSubscription = listener.subscription;
  }

  return currentSession;
}

export function getCurrentUser() {
  return currentSession?.user || null;
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

export async function saveCloudWorkoutCompletion(record) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !record) return null;
  const payload = toCloudWorkoutCompletion(record, user.id);
  if (!payload.completion_key) return null;

  const { error } = await supabase
    .from('workout_completions')
    .upsert(payload, { onConflict: 'user_id,completion_key' });

  if (error) throw error;
  return record;
}

export async function deleteCloudWorkoutCompletion(weekIndex, workoutIndex) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return false;
  const completionKey = `${Number(weekIndex)}:${Number(workoutIndex)}`;

  const { error } = await supabase
    .from('workout_completions')
    .delete()
    .eq('user_id', user.id)
    .eq('completion_key', completionKey);

  if (error) throw error;
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

export async function loadCloudMileTest() {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user) return null;

  const { data, error } = await supabase
    .from('mile_tests')
    .select('*')
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return mapCloudMileTest(data);
}

export async function saveCloudMileTest(result, hrInfo, testContext) {
  const user = getCurrentUser();
  if (!isSupabaseConfigured || !supabase || !user || !result) return null;

  const { error } = await supabase
    .from('mile_tests')
    .upsert(toCloudMileTest(result, hrInfo, testContext, user.id), { onConflict: 'user_id' });

  if (error) throw error;
  return result;
}