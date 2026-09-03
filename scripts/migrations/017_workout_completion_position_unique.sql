-- Align repository migration contract with production uniqueness for workout position.
-- Production already enforces UNIQUE(user_id, week_index, workout_index) as
-- workout_completions_user_id_week_index_workout_index_key (legacy / pre-migration).
-- Repo migrations previously only documented UNIQUE(user_id, completion_key).
-- Keep BOTH: completion_key remains the application upsert identity, while
-- week/workout remains the semantic workout position identity.
-- Do not drop the positional unique constraint.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_completions_user_id_week_index_workout_index_key'
      and conrelid = 'public.workout_completions'::regclass
  ) then
    alter table public.workout_completions
      add constraint workout_completions_user_id_week_index_workout_index_key
      unique (user_id, week_index, workout_index);
  end if;
end $$;
