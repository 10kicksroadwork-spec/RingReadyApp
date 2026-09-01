-- First-class machine output fields on workout_completions.
-- Safe to re-run; backfill uses defensive JSON extraction.

alter table public.workout_completions
  add column if not exists modality text;

alter table public.workout_completions
  add column if not exists output_type text;

alter table public.workout_completions
  add column if not exists output_value numeric;

alter table public.workout_completions
  add column if not exists avg_watts numeric;

update public.workout_completions
set modality = coalesce(
  nullif(record_json #>> '{workoutLog,modality}', ''),
  nullif(record_json #>> '{cfg,workoutContext,modality}', ''),
  'running'
)
where modality is null;

update public.workout_completions
set
  output_type = coalesce(
    nullif(record_json #>> '{workoutLog,outputType}', ''),
    case
      when coalesce(nullif(record_json #>> '{workoutLog,modality}', ''), 'running') = 'running'
        then 'distance'
      else 'watts'
    end
  ),
  output_value = case
    when nullif(record_json #>> '{workoutLog,outputValue}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (record_json #>> '{workoutLog,outputValue}')::numeric
    when nullif(record_json #>> '{workoutLog,distance}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (record_json #>> '{workoutLog,distance}')::numeric
    else null
  end,
  avg_watts = case
    when nullif(record_json #>> '{workoutLog,avgWatts}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (record_json #>> '{workoutLog,avgWatts}')::numeric
    else null
  end
where record_json is not null
  and (output_type is null or output_value is null or avg_watts is null);

-- Keep distance populated only for running-style outputs.
update public.workout_completions
set distance = case
  when output_type = 'distance' then output_value
  else null
end
where output_type is not null;
