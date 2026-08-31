-- Sprint BLE verification: ble_verified column, canonical prescriptions, DB-derived validation.
-- Run after scripts/migrations/013_attachment_write_revoke.sql.

alter table public.sprint_sessions
  add column if not exists ble_verified boolean not null default false;

create table if not exists public.program_sprint_prescriptions (
  week_index integer not null,
  workout_index integer not null,
  reps integer not null check (reps > 0),
  rest_seconds integer not null check (rest_seconds > 0),
  rest_capture_seconds integer not null default 60 check (rest_capture_seconds > 0),
  distance_meters integer not null default 150 check (distance_meters > 0),
  primary key (week_index, workout_index)
);

insert into public.program_sprint_prescriptions
  (week_index, workout_index, reps, rest_seconds, rest_capture_seconds, distance_meters)
values
  (0, 0, 5, 90, 60, 150),
  (1, 0, 6, 90, 60, 150),
  (2, 0, 8, 90, 60, 150),
  (3, 0, 5, 90, 60, 150),
  (4, 0, 10, 90, 60, 150),
  (5, 0, 5, 90, 60, 150)
on conflict (week_index, workout_index) do update set
  reps = excluded.reps,
  rest_seconds = excluded.rest_seconds,
  rest_capture_seconds = excluded.rest_capture_seconds,
  distance_meters = excluded.distance_meters;

alter table public.program_sprint_prescriptions enable row level security;

grant select on table public.program_sprint_prescriptions to authenticated;

drop policy if exists program_sprint_prescriptions_select on public.program_sprint_prescriptions;
create policy program_sprint_prescriptions_select
  on public.program_sprint_prescriptions
  for select
  to authenticated
  using (true);

create or replace function public.validate_sprint_ble_verification_row(
  p_week_index integer,
  p_workout_index integer,
  p_intervals_completed integer,
  p_reps_planned integer,
  p_rest_seconds integer,
  p_session_json jsonb
)
returns boolean
language plpgsql
stable
as $$
declare
  canonical record;
  data_json jsonb;
  rep jsonb;
  capture jsonb;
  i integer;
  seq bigint;
  window_seq bigint;
  capture_at_rest integer;
  sprint_hr integer;
  rest_hr integer;
begin
  if p_session_json is null or jsonb_typeof(p_session_json) <> 'object' then
    return false;
  end if;

  select reps, rest_seconds, rest_capture_seconds
  into canonical
  from public.program_sprint_prescriptions
  where week_index = p_week_index
    and workout_index = p_workout_index;

  if not found then
    return false;
  end if;

  if p_intervals_completed is distinct from canonical.reps
    or p_reps_planned is distinct from canonical.reps
    or p_rest_seconds is distinct from canonical.rest_seconds then
    return false;
  end if;

  data_json := p_session_json -> 'data';
  if data_json is null or jsonb_typeof(data_json) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(data_json) <> canonical.reps then
    return false;
  end if;

  for i in 0 .. canonical.reps - 1 loop
    rep := data_json -> i;
    if rep is null or jsonb_typeof(rep) <> 'object' then
      return false;
    end if;

    begin
      sprint_hr := nullif(trim(both from coalesce(rep ->> 'sprintHR', '')), '')::integer;
      rest_hr := nullif(trim(both from coalesce(rep ->> 'restHR', '')), '')::integer;
    exception when others then
      return false;
    end;

    if sprint_hr is null or sprint_hr < 60 or sprint_hr > 230 then
      return false;
    end if;
    if rest_hr is null or rest_hr < 40 or rest_hr > 229 then
      return false;
    end if;

    capture := rep -> 'sprintCapture';
    if capture is null or jsonb_typeof(capture) <> 'object'
      or capture ->> 'mode' is distinct from 'auto'
      or capture ->> 'source' not in ('web-ble', 'native-ble') then
      return false;
    end if;

    begin
      seq := nullif(trim(both from coalesce(capture ->> 'sampleSequence', '')), '')::bigint;
      window_seq := nullif(trim(both from coalesce(capture ->> 'windowStartSequence', '')), '')::bigint;
    exception when others then
      return false;
    end;

    if seq is null or window_seq is null or seq <= window_seq then
      return false;
    end if;

    capture := rep -> 'restCapture';
    if capture is null or jsonb_typeof(capture) <> 'object'
      or capture ->> 'mode' is distinct from 'auto'
      or capture ->> 'source' not in ('web-ble', 'native-ble') then
      return false;
    end if;

    begin
      seq := nullif(trim(both from coalesce(capture ->> 'sampleSequence', '')), '')::bigint;
      window_seq := nullif(trim(both from coalesce(capture ->> 'windowStartSequence', '')), '')::bigint;
      capture_at_rest := nullif(trim(both from coalesce(capture ->> 'captureAtRestSec', '')), '')::integer;
    exception when others then
      return false;
    end;

    if seq is null or window_seq is null or seq <= window_seq then
      return false;
    end if;

    if capture_at_rest is null
      or capture_at_rest < canonical.rest_capture_seconds
      or capture_at_rest > canonical.rest_capture_seconds + 2 then
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.sprint_sessions_apply_ble_verified()
returns trigger
language plpgsql
as $$
begin
  new.ble_verified := public.validate_sprint_ble_verification_row(
    new.week_index,
    new.workout_index,
    new.intervals_completed,
    new.reps_planned,
    new.rest_seconds,
    new.session_json
  );
  return new;
end;
$$;

drop trigger if exists sprint_sessions_ble_verified_trigger on public.sprint_sessions;
create trigger sprint_sessions_ble_verified_trigger
  before insert or update on public.sprint_sessions
  for each row
  execute function public.sprint_sessions_apply_ble_verified();
