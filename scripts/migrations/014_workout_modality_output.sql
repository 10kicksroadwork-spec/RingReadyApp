-- Ring Ready workout modality + modality-specific output
-- Run after scripts/migrations/013_attachment_write_revoke.sql
--
-- Running:
--   output_type = 'distance'
--   distance contains miles
--   avg_watts is NULL
--
-- Machine modalities:
--   output_type = 'watts'
--   avg_watts contains average watts
--   distance is NULL
--
-- output_value is the modality-neutral performance output.

begin;

alter table public.workout_completions
  add column if not exists modality text;

alter table public.workout_completions
  add column if not exists output_type text;

alter table public.workout_completions
  add column if not exists output_value numeric;

alter table public.workout_completions
  add column if not exists avg_watts numeric;

-- ------------------------------------------------------------
-- Backfill modality from existing record_json.
-- Existing legacy running rows default to running.
-- ------------------------------------------------------------
update public.workout_completions
set modality =
  case
    when record_json #>> '{workoutLog,modality}' in (
      'running',
      'assault_bike',
      'rower',
      'stationary_bike'
    )
      then record_json #>> '{workoutLog,modality}'
    when distance is not null and distance > 0
      then 'running'
    else 'running'
  end
where modality is null
   or btrim(modality) = '';

-- ------------------------------------------------------------
-- Backfill average watts from JSON where a numeric JSON value
-- exists.
-- ------------------------------------------------------------
update public.workout_completions
set avg_watts =
  (record_json #>> '{workoutLog,avgWatts}')::numeric
where avg_watts is null
  and jsonb_typeof(record_json #> '{workoutLog,avgWatts}') = 'number';

-- ------------------------------------------------------------
-- Determine canonical output type.
-- ------------------------------------------------------------
update public.workout_completions
set output_type =
  case
    when modality = 'running' then 'distance'
    when modality in (
      'assault_bike',
      'rower',
      'stationary_bike'
    ) then 'watts'
    else null
  end
where output_type is null
   or btrim(output_type) = '';

-- ------------------------------------------------------------
-- Backfill generic output value.
-- Prefer explicitly stored JSON outputValue when present.
-- Otherwise use modality-specific relational field.
-- ------------------------------------------------------------
update public.workout_completions
set output_value =
  case
    when jsonb_typeof(record_json #> '{workoutLog,outputValue}') = 'number'
      then (record_json #>> '{workoutLog,outputValue}')::numeric
    when output_type = 'watts'
      then avg_watts
    when output_type = 'distance'
      then distance
    else null
  end
where output_value is null;

-- ------------------------------------------------------------
-- Repair legacy null→0 mapper artifacts on machine rows.
-- ------------------------------------------------------------
update public.workout_completions
set distance = null
where modality in ('assault_bike', 'rower', 'stationary_bike')
  and distance = 0;

-- ------------------------------------------------------------
-- Anomaly gate: positive machine distance requires investigation.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.workout_completions
    where modality in ('assault_bike', 'rower', 'stationary_bike')
      and distance > 0
  ) then
    raise exception
      'Migration 014 aborted: machine workout rows contain positive distance values.';
  end if;
end $$;

-- ------------------------------------------------------------
-- Defaults / integrity
-- ------------------------------------------------------------
alter table public.workout_completions
  alter column modality set default 'running';

update public.workout_completions
set modality = 'running'
where modality is null;

alter table public.workout_completions
  alter column modality set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_completions_modality_check'
  ) then
    alter table public.workout_completions
      add constraint workout_completions_modality_check
      check (
        modality in (
          'running',
          'assault_bike',
          'rower',
          'stationary_bike'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_completions_output_type_check'
  ) then
    alter table public.workout_completions
      add constraint workout_completions_output_type_check
      check (
        output_type is null
        or output_type in ('distance', 'watts')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_completions_output_value_positive_check'
  ) then
    alter table public.workout_completions
      add constraint workout_completions_output_value_positive_check
      check (
        output_value is null
        or output_value > 0
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_completions_avg_watts_positive_check'
  ) then
    alter table public.workout_completions
      add constraint workout_completions_avg_watts_positive_check
      check (
        avg_watts is null
        or avg_watts > 0
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_completions_modality_output_check'
  ) then
    alter table public.workout_completions
      add constraint workout_completions_modality_output_check
      check (
        (
          modality = 'running'
          and avg_watts is null
          and (output_type is null or output_type = 'distance')
        )
        or
        (
          modality in ('assault_bike', 'rower', 'stationary_bike')
          and distance is null
          and (output_type is null or output_type = 'watts')
        )
      );
  end if;
end $$;

create index if not exists workout_completions_user_modality_idx
  on public.workout_completions(user_id, modality);

commit;
