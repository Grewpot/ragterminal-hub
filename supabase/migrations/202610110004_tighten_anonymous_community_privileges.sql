-- Least-privilege hardening for public Community catalog access.
-- Public catalog reads are preserved; anonymous uploads and mutations are not needed.
revoke all on public.community_uploads from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.community_repositories, public.community_artifacts, public.community_artifact_versions
  from anon;
grant select on public.community_repositories, public.community_artifacts, public.community_artifact_versions to anon, authenticated;
