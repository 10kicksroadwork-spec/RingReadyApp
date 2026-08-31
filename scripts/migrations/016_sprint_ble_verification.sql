-- Sprint BLE verification: first-class column + DB-derived flag from session_json provenance.
-- Run after 009_coach_attachment_access.sql.

alter table public.sprint_sessions
  add column if not exists ble_verified boolean not null default false;

create or replace function public.validate_sprint_ble_verification(p_session jsonb)
returns boolean
language plpgsql
stable
as $$
declare
  prescribed integer;
  rep jsonb;
  capture jsonb;
  i integer;
  seq bigint;
  window_seq bigint;
begin
  if p_session is null or jsonb_typeof(p_session) <> 'object' then
    return false;
  end if;

  prescribed := nullif(trim(both from (p_session #>> '{cfg,workoutContext,sprintConfig,reps}')), '')::integer;
  if prescribed is null or prescribed <= 0 then
    return false;
  end if;

  if jsonb_array_length(coalesce(p_session -> 'data', '[]'::jsonb)) <> prescribed then
    return false;
  end if;

  for i in 0 .. prescribed - 1 loop
    rep := (p_session -> 'data') -> i;
    if rep is null then
      return false;
    end if;

    if nullif(rep ->> 'sprintHR', '') is null or nullif(rep ->> 'restHR', '') is null then
      return false;
    end if;

    capture := rep -> 'sprintCapture';
    if capture is null
      or capture ->> 'mode' is distinct from 'auto'
      or capture ->> 'source' not in ('web-ble', 'native-ble')
      or nullif(capture ->> 'capturedAt', '') is null
      or nullif(capture ->> 'sampleSequence', '') is null
      or nullif(capture ->> 'windowStartSequence', '') is null
    then
      return false;
    end if;

    seq := (capture ->> 'sampleSequence')::bigint;
    window_seq := (capture ->> 'windowStartSequence')::bigint;
    if seq <= window_seq then
      return false;
    end if;

    capture := rep -> 'restCapture';
    if capture is null
      or capture ->> 'mode' is distinct from 'auto'
      or capture ->> 'source' not in ('web-ble', 'native-ble')
      or nullif(capture ->> 'capturedAt', '') is null
      or nullif(capture ->> 'sampleSequence', '') is null
      or nullif(capture ->> 'windowStartSequence', '') is null
    then
      return false;
    end if;

    seq := (capture ->> 'sampleSequence')::bigint;
    window_seq := (capture ->> 'windowStartSequence')::bigint;
    if seq <= window_seq then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.sprint_sessions_apply_ble_verified()
returns trigger
language plpgsql
as $$
begin
  new.ble_verified := public.validate_sprint_ble_verification(new.session_json);
  return new;
end;
$$;

drop trigger if exists sprint_sessions_ble_verified_trigger on public.sprint_sessions;
create trigger sprint_sessions_ble_verified_trigger
  before insert or update of session_json on public.sprint_sessions
  for each row
  execute function public.sprint_sessions_apply_ble_verified();
