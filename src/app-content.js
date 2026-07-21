export const HR_INFO_STORAGE_KEY = 'ringReadyHrInfo';
export const MILE_TEST_STORAGE_KEY = 'ringReadyMileTestResult';
export const SC_MODE_STORAGE_KEY = 'ringReadySCMode';
export const SC_WEEK_STORAGE_KEY = 'ringReadySCWeek';

export const HR_INFO_DEFAULTS = {
  goalWeight: 181,
  targetDate: '2026-03-21',
  maxHr: 181,
  restingHr: 55,
};

export const HR_ZONES = [
  { label: 'Max HR', pct: 100, uses: ['Sprints'] },
  { label: '95% HR', pct: 95, uses: ['Sprints'] },
  { label: '90% HR', pct: 90, uses: ['Sprints'] },
  { label: '80% HR', pct: 80, uses: ['Tempo Run', 'Threshold Run', 'Circuits'] },
  { label: '75% HR', pct: 75, uses: ['Tempo Run', 'Threshold Run', 'Circuits'] },
  { label: '70% HR', pct: 70, uses: ['Easy Runs', 'Long Runs'] },
  { label: '60% HR', pct: 60, uses: ['Easy Runs', 'Long Runs'] },
];

export const WELCOME_SECTIONS = [
  {
    group: 'Read First',
    title: 'Welcome Fighters',
    docUrl: 'https://docs.google.com/document/d/11-DKNqVi3iaeb05YKAehzlknzYuu_3ew1BTYq_4M1rg/edit?tab=t.0',
    summary: 'This app is the athlete-side version of the roadwork sheet. Check the plan here, complete the assigned work, and log the numbers honestly so the coach view stays useful.',
    bullets: ['Keep easy days easy.', 'Use the assigned heart-rate zones.', 'Do not add extra intensity just because the app looks clean.'],
  },
  {
    group: 'Fighter Instructions',
    title: 'How to Use the System',
    docUrl: 'https://docs.google.com/document/d/1KnttBr9fPpzatO0UxESBFwRDkEibrHcQOSSN5JXGygY/edit?tab=t.0',
    summary: 'Start at Home, confirm the active week, open the daily workout, and follow the details inside the app instead of hunting through spreadsheet tabs.',
    bullets: ['Use the weekly plan for roadwork.', 'Use S&C for Tuesday/Saturday strength work.', 'Use Mile Test before the plan and again at Week 6.'],
  },
  {
    group: 'Approved Swaps',
    title: 'Other Cardio Modalities',
    docUrl: 'https://docs.google.com/document/d/1JdpE1fqQMOShn-J5kTiAyzhf4GvSGKfkdV2cqJJuC8g/edit?tab=t.0',
    summary: 'Running is the default. If a swap is approved, match the training effect rather than simply matching time.',
    bullets: ['Easy work should stay conversational.', 'Tempo and threshold work should feel controlled but uncomfortable.', 'Sprint work should be short, hard, and measured.'],
  },
  {
    group: 'Gear',
    title: 'What You Need',
    docUrl: 'https://docs.google.com/document/d/1zKm_fHwMSLMI_JLh2ENrxQd_ywP4SPfwr_IDz357_hU/edit?tab=t.0',
    summary: 'The useful basics are simple: shoes you can run in, a phone or watch to time sessions, and ideally a heart-rate strap or wearable.',
    bullets: ['A measured track helps the Mile Test.', 'A BLE chest strap gives the best automatic HR capture.', 'Manual HR entry is always okay when tech gets in the way.'],
  },
  {
    group: 'The Science',
    title: 'Why the Plan Works',
    docUrl: 'https://docs.google.com/document/d/1zucGhKmOjW1gQ5xVKVAVlFXJE2_C55uauUbfz2zPvDc/edit?tab=t.0',
    summary: 'The plan blends aerobic base, threshold work, sprint recovery, strength maintenance, deloading, and tapering so conditioning supports fighting instead of stealing from it.',
    bullets: ['Volume builds the engine.', 'Intensity teaches repeatability.', 'Recovery data shows whether you are adapting.'],
  },
  {
    group: 'Nutrition',
    title: 'Fuel the Work',
    docUrl: 'https://docs.google.com/document/d/1X1zKFkDDosUHczu5BBa9_MnQD8pGilEYBVu9hkPiELw/edit?usp=sharing',
    summary: 'Nutrition is not required inside the app, but fighters usually perform better when they hydrate, eat enough protein, and avoid crash-dieting around hard sessions.',
    bullets: ['Fuel before hard days.', 'Recover after long or intense work.', 'Weight goals should not wreck training quality.'],
  },
];

export const SC_SESSIONS = [
  { week: 1, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | EZ Bar Bicep Curl | Tricep Pushdown', setsReps: '1-2 x 8-12 each', intensity: '0-2 RIR (stop 1-2 reps before failure)', rest: '60-120s', notes: 'Quality reps. If you can do more than 15 clean reps, progress leverage, tempo, or variation.' },
  { week: 1, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Leg Press | Hamstring Curl | Standing Calf Press | Barbell Hip Thrust (or machine/glute bridge)', setsReps: '1-2 x 8-12 each', intensity: '1-2 RIR (lower body)', rest: '60-150s', notes: 'Lower body soreness management is priority. If legs are heavy for roadwork: 1 set each.' },
  { week: 2, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | EZ Bar Bicep Curl | Tricep Pushdown', setsReps: '1-2 x 8-12 each', intensity: '0-2 RIR', rest: '60-120s', notes: 'Add reps first; then make variation harder.' },
  { week: 2, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Leg Press | Hamstring Curl | Standing Calf Press | Hip Thrust', setsReps: '1-2 x 8-12 each', intensity: '1-2 RIR', rest: '60-150s', notes: 'Use tempo/pauses instead of chasing failure.' },
  { week: 3, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | EZ Bar Bicep Curl | Tricep Pushdown', setsReps: '2 x 8-12 each', intensity: '0-2 RIR', rest: '60-120s', notes: 'Highest volume week. Keep all reps crisp; avoid true failure.' },
  { week: 3, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Leg Press | Hamstring Curl | Standing Calf Press | Hip Thrust', setsReps: '2 x 8-12 each', intensity: '1-2 RIR', rest: '60-150s', notes: 'If sparring/intervals are brutal: cut squats to 1 set.' },
  { week: 4, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | EZ Bar Bicep Curl | Tricep Pushdown', setsReps: '1-2 x 8-12 each', intensity: '0-2 RIR', rest: '60-120s', notes: 'Maintain. Do not force extra volume if sore.' },
  { week: 4, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Leg Press | Hamstring Curl | Standing Calf Press | Hip Thrust', setsReps: '1-2 x 8-12 each', intensity: '1-2 RIR', rest: '60-150s', notes: 'Keep legs fresh for roadwork.' },
  { week: 5, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | EZ Bar Bicep Curl | Tricep Pushdown', setsReps: '1-2 x 8-10 each', intensity: '0-2 RIR', rest: '90-150s', notes: 'Slightly lower rep focus; longer rest.' },
  { week: 5, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Gym Machines', exercises: 'Leg Press | Hamstring Curl | Standing Calf Press | Hip Thrust', setsReps: '1-2 x 8-10 each', intensity: '1-2 RIR', rest: '90-180s', notes: 'Avoid grinders. Use tempo for difficulty.' },
  { week: 6, day: 'Tuesday', sessionType: 'Deload / Fatigue Management', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | EZ Bar Bicep Curl | Tricep Pushdown', setsReps: '1 x 8-10 each', intensity: '2-3 RIR', rest: '60-120s', notes: 'Cut volume about 50%. Leave fresh.' },
  { week: 6, day: 'Saturday', sessionType: 'Deload / Fatigue Management', modality: 'Gym Machines', exercises: 'Leg Press | Hamstring Curl | Standing Calf Press | Hip Thrust', setsReps: '1 x 8-10 each', intensity: '2-3 RIR', rest: '60-150s', notes: 'Skip squats if legs are beat.' },
  { week: 7, day: 'Tuesday', sessionType: 'Taper Maintenance', modality: 'Gym Machines', exercises: 'Smith Machine Bench Press | Seated Cable Row | optional Tricep Pushdown', setsReps: '1 x 6-10 each', intensity: '2-3 RIR', rest: '60-120s', notes: 'Short session (10-20 min). No soreness goal.' },
  { week: 7, day: 'Saturday', sessionType: 'Taper Maintenance', modality: 'Gym Machines', exercises: 'Hamstring Curl | Standing Calf Press | Hip Thrust (light)', setsReps: '1 x 6-10 each', intensity: '2-3 RIR', rest: '60-150s', notes: 'Keep it light.' },
  { week: 1, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Pushups (feet elevated if advanced) | Pull-Ups (band if needed) | Chin-Ups (band if needed) | Dips (bench/parallel bars)', setsReps: '1-2 x 6-15 each', intensity: '0-2 RIR (stop 1-2 reps before failure)', rest: '60-120s', notes: 'Quality reps. If you can do more than 15 clean reps, progress leverage, tempo, or variation.' },
  { week: 1, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Squats (bodyweight) | Bulgarian Split Squat | Single-Leg Glute Bridge | Standing Calf Raise', setsReps: '1-2 x 8-20 each', intensity: '1-2 RIR (lower body)', rest: '60-150s', notes: 'Lower body soreness management is priority. If legs are heavy for roadwork: 1 set each.' },
  { week: 2, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Pushups (harder variation if needed) | Pull-Ups | Chin-Ups | Dips', setsReps: '1-2 x 6-15 each', intensity: '0-2 RIR', rest: '60-120s', notes: 'Add reps first; then make variation harder.' },
  { week: 2, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Squats (tempo 3-1-1 if too easy) | Bulgarian Split Squat | Single-Leg Glute Bridge (pause top) | Standing Calf Raise (pause top)', setsReps: '1-2 x 8-20 each', intensity: '1-2 RIR', rest: '60-150s', notes: 'Use tempo/pauses instead of chasing failure.' },
  { week: 3, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Pushups | Pull-Ups | Chin-Ups | Dips', setsReps: '2 x 6-15 each', intensity: '0-2 RIR', rest: '60-120s', notes: 'Highest volume week. Keep all reps crisp; avoid true failure.' },
  { week: 3, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Squats | Bulgarian Split Squat | Single-Leg Glute Bridge | Standing Calf Raise', setsReps: '2 x 8-20 each', intensity: '1-2 RIR', rest: '60-150s', notes: 'If sparring/intervals are brutal: cut squats to 1 set.' },
  { week: 4, day: 'Tuesday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Pushups | Pull-Ups | Chin-Ups | Dips', setsReps: '1-2 x 6-15 each', intensity: '0-2 RIR', rest: '60-120s', notes: 'Maintain. Do not force extra volume if sore.' },
  { week: 4, day: 'Saturday', sessionType: 'Strength Maintenance', modality: 'Calisthenics', exercises: 'Squats | Bulgarian Split Squat | Single-Leg Glute Bridge | Standing Calf Raise', setsReps: '1-2 x 8-20 each', intensity: '1-2 RIR', rest: '60-150s', notes: 'Keep legs fresh for roadwork.' },
  { week: 5, day: 'Tuesday', sessionType: 'Strength Maintenance (Strength Bias)', modality: 'Calisthenics', exercises: 'Pushups (hardest clean variation) | Pull-Ups (weighted backpack if available) | Chin-Ups | Dips', setsReps: '1-2 x 5-12 each', intensity: '0-2 RIR', rest: '90-150s', notes: 'Slightly lower rep focus; longer rest.' },
  { week: 5, day: 'Saturday', sessionType: 'Strength Maintenance (Strength Bias)', modality: 'Calisthenics', exercises: 'Squats (hard variation/tempo) | Bulgarian Split Squat (slow eccentrics) | Single-Leg Glute Bridge (long pause) | Standing Calf Raise (slow + pause)', setsReps: '1-2 x 6-15 each', intensity: '1-2 RIR', rest: '90-180s', notes: 'Avoid grinders. Use tempo for difficulty.' },
  { week: 6, day: 'Tuesday', sessionType: 'Deload / Fatigue Management', modality: 'Calisthenics', exercises: 'Pushups | Pull-Ups | optional Dips', setsReps: '1 x 6-12 each', intensity: '2-3 RIR', rest: '60-120s', notes: 'Cut volume about 50%. Leave fresh.' },
  { week: 6, day: 'Saturday', sessionType: 'Deload / Fatigue Management', modality: 'Calisthenics', exercises: 'Bulgarian Split Squat | Single-Leg Glute Bridge | Standing Calf Raise', setsReps: '1 x 8-15 each', intensity: '2-3 RIR', rest: '60-150s', notes: 'Skip squats if legs are beat.' },
  { week: 7, day: 'Tuesday', sessionType: 'Taper Maintenance', modality: 'Calisthenics', exercises: 'Pushups | Pull-Ups', setsReps: '1 x 6-10 each', intensity: '2-3 RIR', rest: '60-120s', notes: 'Short session (10-20 min). No soreness goal.' },
  { week: 7, day: 'Saturday', sessionType: 'Taper Maintenance', modality: 'Calisthenics', exercises: 'Single-Leg Glute Bridge | Standing Calf Raise', setsReps: '1 x 6-12 each', intensity: '2-3 RIR', rest: '60-150s', notes: 'Keep it light.' },
];

export const MILE_TEST_INFO = {
  day: 'Any Saturday or Sunday before roadwork starts',
  workout: 'Mile Test (Max HR Test)',
  description: 'Run one mile, 4 laps, as fast as possible. You are running for time and also testing Max HR. Repeat this again at Week 6.',
  warmup: 'Dynamic stretches, 10 minute easy jog, mobility, 3 x 30m strides, then a 10 minute walk cooldown.',
  warmupLink: 'https://www.youtube.com/watch?v=3WUtJxLv-wI',
  locations: [
    'Eastern Henrico Recreation Center - 1440 N. Laburnum Ave., Henrico, VA 23223',
    'Robious Athletic Complex - 2801 Robious Crossing Drive, Midlothian, VA 23113',
    'Hermitage High School - 8301 Hungary Spring Road, Henrico, VA 23228',
    'Varina High School - 7053 Messer Road, Henrico, VA 23231',
    'Mills E. Godwin High School - 2101 Pump Road, Henrico, VA 23238',
    'Thomas Dale High School - 3626 W. Hundred Road, Chester, VA 23831',
    'Midlothian High School - 401 Charter Colony Parkway, Midlothian, VA 23114',
    'Cosby High School - 14300 Fox Club Parkway, Midlothian, VA 23112',
  ],
};