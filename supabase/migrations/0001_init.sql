-- Video Automation MVP — initial schema
-- Run via Supabase SQL editor, or `supabase db push` if you have the CLI linked.

create extension if not exists "pgcrypto";

-- =========================================================================
-- projects
-- =========================================================================
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  title         text not null,
  transcript    text,
  voiceover_url text,
  status        text not null default 'draft',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_user_id_idx     on public.projects (user_id);
create index if not exists projects_status_idx      on public.projects (status);
create index if not exists projects_created_at_idx  on public.projects (created_at desc);

-- =========================================================================
-- project_entities (extracted by Gemini)
-- =========================================================================
create table if not exists public.project_entities (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  type        text not null,
  value       text not null,
  confidence  numeric default 1,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists project_entities_project_id_idx on public.project_entities (project_id);
create index if not exists project_entities_type_idx       on public.project_entities (type);

-- =========================================================================
-- youtube_search_results (candidate videos before download decision)
-- =========================================================================
create table if not exists public.youtube_search_results (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  youtube_video_id   text not null,
  url                text,
  title              text,
  description        text,
  channel_id         text,
  channel_title      text,
  duration_seconds   int,
  score              numeric default 0,
  status             text not null default 'candidate',
  metadata           jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists ysr_project_id_idx on public.youtube_search_results (project_id);
create index if not exists ysr_video_id_idx   on public.youtube_search_results (youtube_video_id);
create index if not exists ysr_score_idx      on public.youtube_search_results (project_id, score desc);

-- =========================================================================
-- video_sources (downloaded source videos, deduped by youtube_video_id)
-- =========================================================================
create table if not exists public.video_sources (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references public.projects(id) on delete set null,
  youtube_video_id  text unique not null,
  youtube_url       text,
  title             text,
  channel_title     text,
  duration_seconds  int,
  local_path        text,
  storage_url       text,
  status            text not null default 'queued',
  error             text,
  metadata          jsonb default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists video_sources_project_id_idx on public.video_sources (project_id);
create index if not exists video_sources_status_idx     on public.video_sources (status);

-- =========================================================================
-- video_clips (4–5 second pieces cut from sources)
-- =========================================================================
create table if not exists public.video_clips (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  video_source_id uuid not null references public.video_sources(id) on delete cascade,
  start_time      numeric not null,
  end_time        numeric not null,
  duration        numeric not null,
  clip_url        text,
  thumbnail_url   text,
  relevance_score numeric default 0,
  labels          jsonb default '[]'::jsonb,
  status          text not null default 'pending',
  created_at      timestamptz not null default now()
);

create index if not exists video_clips_project_id_idx on public.video_clips (project_id);
create index if not exists video_clips_source_id_idx  on public.video_clips (video_source_id);
create index if not exists video_clips_status_idx     on public.video_clips (status);

-- =========================================================================
-- timeline_items (draft + approved timeline)
-- =========================================================================
create table if not exists public.timeline_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  clip_id      uuid references public.video_clips(id) on delete set null,
  type         text not null,
  position     int not null,
  start_time   numeric,
  duration     numeric not null default 5,
  script_text  text,
  overlay_text text,
  metadata     jsonb default '{}'::jsonb,
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists timeline_items_project_id_idx on public.timeline_items (project_id);
create index if not exists timeline_items_position_idx   on public.timeline_items (project_id, position);

-- =========================================================================
-- render_jobs (final video assembly)
-- =========================================================================
create table if not exists public.render_jobs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  status      text not null default 'queued',
  progress    int not null default 0,
  output_url  text,
  error       text,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists render_jobs_project_id_idx on public.render_jobs (project_id);
create index if not exists render_jobs_status_idx     on public.render_jobs (status);

-- =========================================================================
-- media_jobs (every step of the pipeline, resumable by status)
-- =========================================================================
create table if not exists public.media_jobs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  type        text not null,
  status      text not null default 'queued',
  progress    int not null default 0,
  attempts    int not null default 0,
  error       text,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists media_jobs_project_id_idx on public.media_jobs (project_id);
create index if not exists media_jobs_type_idx       on public.media_jobs (type);
create index if not exists media_jobs_status_idx     on public.media_jobs (status);

-- =========================================================================
-- channel_rules (approved/blocked channels for ranking)
-- =========================================================================
create table if not exists public.channel_rules (
  id            uuid primary key default gen_random_uuid(),
  channel_id    text,
  channel_title text,
  rule          text not null check (rule in ('approved', 'blocked')),
  created_at    timestamptz not null default now()
);

create index if not exists channel_rules_rule_idx on public.channel_rules (rule);

-- =========================================================================
-- updated_at trigger
-- =========================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists video_sources_touch on public.video_sources;
create trigger video_sources_touch
  before update on public.video_sources
  for each row execute function public.touch_updated_at();

drop trigger if exists render_jobs_touch on public.render_jobs;
create trigger render_jobs_touch
  before update on public.render_jobs
  for each row execute function public.touch_updated_at();

drop trigger if exists media_jobs_touch on public.media_jobs;
create trigger media_jobs_touch
  before update on public.media_jobs
  for each row execute function public.touch_updated_at();
