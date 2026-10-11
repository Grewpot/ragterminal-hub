-- RAGTerminal Hub community catalog schema snapshot.
-- This schema has been applied to Supabase project zjifbqdvbmvuiwgwdkey.
-- Reconcile remote migration history before using Supabase CLI db push on an existing project.
create extension if not exists pgcrypto;

create table if not exists public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_-]{3,32}$'),
  display_name text,
  avatar_url text,
  bio text check (char_length(coalesce(bio, '')) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_repositories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9._-]{1,80}$'),
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  readme text not null default '',
  license text,
  visibility text not null default 'public' check (visibility in ('public','private','organization')),
  status text not null default 'draft' check (status in ('draft','published','blocked','archived')),
  tags text[] not null default '{}',
  latest_version text,
  package_storage_path text,
  package_sha256 text,
  package_size_bytes bigint check (package_size_bytes is null or package_size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug)
);

create table if not exists public.community_artifacts (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.community_repositories(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9._-]{1,80}$'),
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  artifact_type text not null check (artifact_type in ('knowledge','flow','block','script','play')),
  status text not null default 'draft' check (status in ('draft','published','blocked','archived')),
  tags text[] not null default '{}',
  license text,
  latest_version text,
  storage_path text,
  sha256 text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(repository_id, slug)
);

create table if not exists public.community_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.community_artifacts(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 80),
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[a-fA-F0-9]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  release_notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(artifact_id, version)
);

create table if not exists public.community_stars (
  user_id uuid not null references auth.users(id) on delete cascade,
  artifact_id uuid not null references public.community_artifacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, artifact_id)
);

create table if not exists public.community_download_events (
  id bigint generated always as identity primary key,
  artifact_id uuid not null references public.community_artifacts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists community_repositories_public_updated_idx
  on public.community_repositories (updated_at desc)
  where status = 'published' and visibility = 'public';
create index if not exists community_artifacts_public_updated_idx
  on public.community_artifacts (updated_at desc)
  where status = 'published';
create index if not exists community_artifacts_type_idx on public.community_artifacts (artifact_type);
create index if not exists community_artifacts_tags_idx on public.community_artifacts using gin (tags);
create index if not exists community_stars_artifact_idx on public.community_stars (artifact_id);
create index if not exists community_download_events_artifact_idx on public.community_download_events (artifact_id, created_at desc);
create index if not exists community_artifact_versions_created_by_idx on public.community_artifact_versions(created_by);
create index if not exists community_artifacts_owner_id_idx on public.community_artifacts(owner_id);
create index if not exists community_download_events_user_id_idx on public.community_download_events(user_id);

alter table public.community_profiles enable row level security;
alter table public.community_repositories enable row level security;
alter table public.community_artifacts enable row level security;
alter table public.community_artifact_versions enable row level security;
alter table public.community_stars enable row level security;
alter table public.community_download_events enable row level security;

create policy "Public profiles are readable" on public.community_profiles
  for select to anon, authenticated using (true);
create policy "Users create their own profile" on public.community_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own profile" on public.community_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Published public repositories are readable" on public.community_repositories
  for select to anon, authenticated
  using ((status = 'published' and visibility = 'public') or (select auth.uid()) = owner_id);
create policy "Users create repositories as owner" on public.community_repositories
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners update repositories" on public.community_repositories
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners delete repositories" on public.community_repositories
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Published public artifacts are readable" on public.community_artifacts
  for select to anon, authenticated using (
    (status = 'published' and exists (
      select 1 from public.community_repositories r
      where r.id = repository_id and r.status = 'published' and r.visibility = 'public'
    )) or (select auth.uid()) = owner_id
  );
create policy "Owners create artifacts" on public.community_artifacts
  for insert to authenticated with check (
    (select auth.uid()) = owner_id and exists (
      select 1 from public.community_repositories r
      where r.id = repository_id and r.owner_id = (select auth.uid())
    )
  );
create policy "Owners update artifacts" on public.community_artifacts
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and exists (
    select 1 from public.community_repositories r
    where r.id = repository_id and r.owner_id = (select auth.uid())
  ));
create policy "Owners delete artifacts" on public.community_artifacts
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Published versions or owner versions readable" on public.community_artifact_versions
  for select to anon, authenticated using (
    exists (select 1 from public.community_artifacts a
      join public.community_repositories r on r.id = a.repository_id
      where a.id = artifact_id and a.status = 'published' and r.status = 'published'
        and r.visibility = 'public')
    or exists (select 1 from public.community_artifacts a
      where a.id = artifact_id and a.owner_id = (select auth.uid()))
  );
create policy "Artifact owners add versions" on public.community_artifact_versions
  for insert to authenticated with check (
    (select auth.uid()) = created_by and exists (
      select 1 from public.community_artifacts a
      where a.id = artifact_id and a.owner_id = (select auth.uid())
    )
  );

create policy "Users read own stars" on public.community_stars
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users star as themselves" on public.community_stars
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users remove their own stars" on public.community_stars
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users record own downloads" on public.community_download_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users read own download events" on public.community_download_events
  for select to authenticated using ((select auth.uid()) = user_id);

revoke select on public.community_stars from anon;
grant select on public.community_profiles, public.community_repositories, public.community_artifacts, public.community_artifact_versions to anon, authenticated;
grant select, insert, update, delete on public.community_profiles, public.community_repositories, public.community_artifacts, public.community_artifact_versions, public.community_stars to authenticated;
grant select, insert on public.community_download_events to authenticated;
grant usage, select on sequence public.community_download_events_id_seq to authenticated;
