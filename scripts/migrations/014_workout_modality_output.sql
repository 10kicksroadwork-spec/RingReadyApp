-- First-class machine output fields on workout_completions.
-- Safe to re-run.
-- Existing first-class values and legacy SQL distance values are preserved.

alter table public.workout_completions
  add column if not exists modality text;

alter table public.workout_completions
  add column if not exists output_type text;

alter table public.workout_completions
  add column if not exists output_value numeric;

alter table public.workout_completions
  add column if not exists avg_watts numeric;

-- 1) Backfill modality without overwriting an existing value.
update public.workout_completions
set modality = coalesce(
  modality,
  nullif(record_json #>> '{workoutLog,modality}', ''),
  nullif(record_json #>> '{cfg,workoutContext,modality}', ''),
  'running'
)
where modality is null;

-- 2) Backfill output type without overwriting an existing value.
update public.workout_completions
set output_type = coalesce(
  output_type,
  nullif(record_json #>> '{workoutLog,outputType}', ''),
  case
    when modality = 'running' then 'distance'
    else 'watts'
  end
)
where output_type is null;

-- 3) Backfill average watts first.
update public.workout_completions
set avg_watts = case
  when avg_watts is not null then avg_watts
  when nullif(record_json #>> '{workoutLog,avgWatts}', '') ~ '^[0-9]+(\.[0-9]+)?$'
    then (record_json #>> '{workoutLog,avgWatts}')::numeric
  when output_type = 'watts'
    and nullif(record_json #>> '{workoutLog,outputValue}', '') ~ '^[0-9]+(\.[0-9]+)?$'
    then (record_json #>> '{workoutLog,outputValue}')::numeric
  else null
end
where avg_watts is null
  and output_type = 'watts';

-- 4) Backfill output_value.
-- Existing SQL distance is an authoritative fallback for running rows.
update public.workout_completions
set output_value = case
  when output_value is not null then output_value
  when nullif(record_json #>> '{workoutLog,outputValue}', '') ~ '^[0-9]+(\.[0-9]+)?$'
    then (record_json #>> '{workoutLog,outputValue}')::numeric
  when output_type = 'distance'
    and distance is not null
    then distance
  when output_type = 'distance'
    and nullif(record_json #>> '{workoutLog,distance}', '') ~ '^[0-9]+(\.[0-9]+)?$'
    then (record_json #>> '{workoutLog,distance}')::numeric
  when output_type = 'watts'
    and avg_watts is not null
    then avg_watts
  else null
end
where output_value is null;

-- 5) Machine sessions must not carry fake running distance.
update public.workout_completions
set distance = null
where output_type = 'watts'
  and distance is not null;

-- 6) Restore running distance from output_value only when distance is missing.
update public.workout_completions
set distance = output_value
where output_type = 'distance'
  and distance is null
  and output_value is not null;
