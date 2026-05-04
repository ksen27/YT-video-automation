-- Track the actual voiceover audio duration so the timeline planner can
-- size blocks against real seconds instead of word-count estimates.
alter table public.projects
  add column if not exists voiceover_duration_seconds numeric;
