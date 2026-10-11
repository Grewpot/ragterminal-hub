-- Private staging upload pipeline for RAGTerminal Hub.
-- Already applied to project zjifbqdvbmvuiwgwdkey; keep this file as the migration source.
create table if not exists public.community_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_file_name text not null check (char_length(original_file_name) between 1 and 255),
  title text not null check (char_length(title) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9._-]{1,80}$'),
  description text not null default '' check (char_length(description) <= 2000),
  tags text[] not null default '{}',
  license text not null check (char_length(license) between 2 and 80),
  storage_path text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text check (sha256 is null or sha256 ~ '^[a-fA-F0-9]{64}$'),
  status text not null default 'uploaded' check (status in ('uploaded','validating','needs_changes','validated','published','rejected')),
  validation_report jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_report) = 'object'),
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  discovered_files jsonb not null default '[]'::jsonb check (jsonb_typeof(discovered_files) = 'array'),
  repository_id uuid references public.community_repositories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug),
  unique(storage_path)
);
create index if not exists community_uploads_owner_created_idx on public.community_uploads(owner_id, created_at desc);
create index if not exists community_uploads_status_idx on public.community_uploads(status);
alter table public.community_uploads enable row level security;
create policy "Owners can view their uploads" on public.community_uploads for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can register staging uploads" on public.community_uploads for insert to authenticated with check ((select auth.uid()) = owner_id and status = 'uploaded' and storage_path like ((select auth.uid())::text || '/%'));
grant select, insert on public.community_uploads to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-staging', 'community-staging', false, 52428800, null)
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = null;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-releases', 'community-releases', true, 52428800, array['application/octet-stream','application/zip','application/x-zip-compressed'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own community staging files" on storage.objects;
create policy "Users upload own community staging files" on storage.objects for insert to authenticated with check (bucket_id = 'community-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users view own community staging files" on storage.objects;
create policy "Users view own community staging files" on storage.objects for select to authenticated using (bucket_id = 'community-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete own community staging files" on storage.objects;
create policy "Users delete own community staging files" on storage.objects for delete to authenticated using (bucket_id = 'community-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.guard_community_publication()
returns trigger language plpgsql as $$
begin
  if current_user <> 'service_role' and new.status = 'published' then
    raise exception 'Publishing must go through the validated publication workflow';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_repository_publication on public.community_repositories;
create trigger guard_repository_publication before insert or update of status on public.community_repositories for each row execute function public.guard_community_publication();
drop trigger if exists guard_artifact_publication on public.community_artifacts;
create trigger guard_artifact_publication before insert or update of status on public.community_artifacts for each row execute function public.guard_community_publication();
