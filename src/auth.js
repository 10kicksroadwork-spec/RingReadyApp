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
    athlete_name: String(profile.athleteName || '').trim(),
    age: profile.age ? Number(profile.age) : null,
    gender: String(profile.gender || '').trim(),
    gender_detail: String(profile.genderDetail || '').trim(),
    training_tenure: String(profile.trainingTenure || '').trim(),
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
    goal_weight: Number(hrInfo.goalWeight) || null,
    target_date: hrInfo.targetDate || null,
    max_hr: Number(hrInfo.maxHr) || null,
    resting_hr: Number(hrInfo.restingHr) || null,
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

