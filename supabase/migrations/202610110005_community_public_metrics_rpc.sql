-- Return only aggregate metrics for published public community artifacts.
-- The caller is the server-side metrics Edge Function using service_role credentials.
-- This is SECURITY INVOKER; execution is revoked from all client roles.
create or replace function public.community_public_metrics(p_artifact_ids uuid[])
returns table (
  artifact_id uuid,
  stars_count bigint,
  downloads_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    a.id as artifact_id,
    (
      select count(*)::bigint
      from public.community_stars s
      where s.artifact_id = a.id
    ) as stars_count,
    (
      select count(*)::bigint
      from public.community_download_events d
      where d.artifact_id = a.id
    ) as downloads_count
  from public.community_artifacts a
  join public.community_repositories r on r.id = a.repository_id
  where cardinality(coalesce(p_artifact_ids, array[]::uuid[])) <= 100
    and a.id = any(coalesce(p_artifact_ids, array[]::uuid[]))
    and a.status = 'published'
    and r.status = 'published'
    and r.visibility = 'public';
$function$;
revoke all on function public.community_public_metrics(uuid[]) from public, anon, authenticated;
grant execute on function public.community_public_metrics(uuid[]) to service_role;
