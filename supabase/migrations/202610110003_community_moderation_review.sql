-- Moderator review workflow for RAGTerminal Hub.
create table if not exists public.community_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'moderator' check (role in ('moderator','admin')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.community_moderators enable row level security;
revoke all on public.community_moderators from anon, authenticated;
grant select, insert, update, delete on public.community_moderators to service_role;

alter table public.community_uploads
  add column if not exists review_status text not null default 'not_submitted'
    check (review_status in ('not_submitted','pending','approved','changes_requested','rejected')),
  add column if not exists rights_attested_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text check (review_notes is null or char_length(review_notes) <= 2000);

create index if not exists community_uploads_review_queue_idx
  on public.community_uploads(review_status, rights_attested_at)
  where review_status = 'pending';

comment on table public.community_moderators is
  'Private moderator allowlist used only by the pack-lifecycle Edge Function. Provision trusted user UUIDs administratively; never allow self-enrollment.';
comment on column public.community_uploads.review_status is
  'Review workflow independent from validation status. Only validated uploads may enter pending review.';
comment on column public.community_uploads.rights_attested_at is
  'Timestamp of explicit uploader license/share-rights attestation before moderator review.';
