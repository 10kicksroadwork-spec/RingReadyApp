const DYNAMIC_STRETCHES_VIDEO_URL =
  'https://www.youtube.com/watch?v=3WUtJxLv-wI';

function addVideoLink(workout) {
  if (workout.warmup === 'Dynamic Stretches (Video)') {
    return {
      ...workout,
      videoUrl: DYNAMIC_STRETCHES_VIDEO_URL,
    };
  }

  return workout;
}

export const PROGRAM = [
  {
    id: 'week-1',
    label: 'Week 1',
    title: 'Foundation',
    focus: 'Set baselines, learn the rhythm, keep recovery honest.',
    workouts: [
      { day: 'Monday', type: 'Sprint Intervals', description: '5x150 m Sprints (90 Second rest). Focus on fast but controlled reps. Record HR after 60 seconds rest', warmup: '5 min easy jog; 2x60 m strides; 2x60 m A-skips; followed by 5 minute run at 85% MaxHR / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'sprint' },
      { day: 'Tuesday', type: 'Benchmark Run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Wednesday', type: 'Threshold Run', description: '3x4min at 84%-88% HRmax (2 min easy jog recovery between rounds). Total time in Minutes to be recorded is 18', warmup: '10 min easy jog; 2x100 m strides / 5 minute walk', targetZone: '84-88%', targetBPM: 163, action: 'log' },
      { day: 'Thursday', type: 'Easy Run', description: '20 min easy jog (recovery).', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Long Run', description: '45 min easy continuous run.', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
    ].map(addVideoLink),
  },
  {
    id: 'week-2',
    label: 'Week 2',
    title: 'Introducing High Intensity',
    focus: 'Keep the baseline work, raise quality slightly.',
    workouts: [
      { day: 'Monday', type: 'Sprint Intervals', description: '6x150 m sprints (90s rest). Record HR after 60 seconds rest', warmup: '5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips, 5 minute run at 85% / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'sprint' },
      { day: 'Tuesday', type: 'Benchmark Run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Wednesday', type: 'Threshold Run', description: '4x4min at 84%-88% HRmax (2 min easy jog recovery between rounds). Total time in Minutes to be recorded is 22', warmup: '10 min easy jog; 2x20 m strides; 1x60 m acceleration / 5 minute walk', targetZone: '84-88%', targetBPM: 163, action: 'log' },
      { day: 'Thursday', type: 'Easy Run', description: '20 min easy jog (recovery).', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Long Run', description: '50 min easy run.', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
    ].map(addVideoLink),
  },
  {
    id: 'week-3',
    label: 'Week 3',
    title: 'Ramp-Up',
    focus: 'Build volume while keeping easy days easy.',
    workouts: [
      { day: 'Monday', type: 'Sprint Intervals', description: '8x150 m sprints (90s rest). Record HR after 60 seconds rest', warmup: '5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips, 5 minute run at 85% / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'sprint' },
      { day: 'Tuesday', type: 'Benchmark Run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Wednesday', type: 'Threshold Run', description: '5x4min at 84%-88% HRmax (2 min easy jog recovery between rounds). Total time in Minutes to be recorded is 28', warmup: '10 min easy jog; 2x100 m strides / 5 minute walk', targetZone: '84-88%', targetBPM: 163, action: 'log' },
      { day: 'Thursday', type: 'Easy Run', description: '30 min easy jog (recovery).', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Long Run', description: '60 min easy run.', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
    ].map(addVideoLink),
  },
  {
    id: 'week-4',
    label: 'Week 4',
    title: 'Deload',
    focus: 'Recover without losing rhythm.',
    workouts: [
      { day: 'Monday', type: 'Sprint Intervals', description: '5x150 m Sprints (90s rest). Record HR after 60 seconds rest', warmup: '5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips, 5 minute run at 85% / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'sprint' },
      { day: 'Tuesday', type: 'Benchmark Run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Wednesday', type: 'Tempo Run', description: '20 min comfortably-hard pace (with 5 min cooldown, stop workout on app before the cooldown). Total time in Minutes to be recorded is 20', warmup: '10 min easy jog; 2x100 m strides / 5 minute walk', targetZone: '75-80%', targetBPM: 153, action: 'log' },
      { day: 'Thursday', type: 'Easy Jog', description: '15 min super-easy jog (skip if fatigued).', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Long Run', description: '45 min easy run.', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
    ].map(addVideoLink),
  },
  {
    id: 'week-5',
    label: 'Week 5',
    title: 'Peak Intensity',
    focus: 'Highest quality week. Watch recovery closely.',
    workouts: [
      { day: 'Monday', type: 'Sprint Intervals', description: '10x150 m (90s rest). Record HR after 60 seconds rest', warmup: '5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips, 5 minute run at 85% / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'sprint' },
      { day: 'Tuesday', type: 'Benchmark Run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Wednesday', type: 'Threshold Run', description: '6x4min at 84%-88% HRmax (2 min easy jog recovery between rounds). Total time in Minutes to be recorded is 34', warmup: '10 min easy jog; 2x20 m strides; 1x60 m acceleration', targetZone: '88-88%', targetBPM: 166, action: 'log' },
      { day: 'Thursday', type: 'Easy Run', description: '20 min easy jog (recovery).', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Fight-Pace Intervals', description: '3x3 min hard run : 1 min easy jog between rounds Total time in Minutes to be recorded is 11', warmup: '6 min jog; 2x30 m strides / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'log' },
    ].map(addVideoLink),
  },
  {
    id: 'week-6',
    label: 'Week 6',
    title: 'Taper Begins',
    focus: 'Stay sharp while lowering total strain.',
    workouts: [
      { day: 'Monday', type: 'Sprint Intervals', description: '5x150m sprints (90 seconds rest). Record HR after 60 seconds rest', warmup: '5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips, 5 minute run at 85% / 5 minute walk', targetZone: '90-95%', targetBPM: 172, action: 'sprint' },
      { day: 'Tuesday', type: 'Benchmark Run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Thursday', type: 'Shake-Out Run', description: '20 min very easy run.', warmup: 'Dynamic Stretches (Video)', targetZone: '60-65%', targetBPM: 134, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Mile Re-Test', description: 'Same as the original Mile test (4 laps around a track) for time, all out effort', warmup: '10 min easy jog; mobility; 3x30 m strides / 5 minute walk', targetZone: '95-100%', targetBPM: 178, action: 'mile-test' },
    ].map(addVideoLink),
  },
  {
    id: 'fight-week',
    label: 'Fight Week',
    title: 'Stay Ready',
    focus: 'Light, sharp, and recovered.',
    workouts: [
      { day: 'Monday', type: 'Shake-Out Run + Strides', description: '15 min easy jog + 3x50 m strides.', warmup: 'Dynamic Stretches (Video)', targetZone: '90-95%', targetBPM: 172, action: 'log' },
      { day: 'Tuesday', type: 'Benchmark run', description: '30 min conversational jog, HR and Time stay the same, goal is more distance', warmup: 'Dynamic Stretches (Video)', targetZone: '60-70%', targetBPM: 137, action: 'log' },
      { day: 'Wednesday', type: 'Light Shadowboxing', description: '20 min technique-focused shadowboxing.', warmup: '5 min mobility warm-up', targetZone: '80-85%', targetBPM: 159, action: 'log' },
      { day: 'Saturday/Sunday', type: 'Fight-Day Warm-Up', description: 'Pre-bout warm-up: 5 min walk, dynamic stretches, a few pad/air combos.', warmup: 'Light 5 min walk; dynamic stretches', targetZone: '60-70%', targetBPM: 137, action: 'log' },
    ].map(addVideoLink),
  },
];

const DAY_INDEX = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function getWeek(index) {
  return PROGRAM[Math.max(0, Math.min(PROGRAM.length - 1, index))];
}

export function getTodayWorkout(week) {
  const today = DAY_INDEX[new Date().getDay()];

  return (
    week.workouts.find((workout) => workout.day.includes(today)) ||
    week.workouts[0]
  );
}
