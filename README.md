# RAGTerminal Hub

A Hugging Face–inspired community catalog for RAGTerminal assets: Knowledge, Flows, Blocks, Scripts, and Plays.

## Live services

- Community site: https://ragterminal-hub.vercel.app
- GitHub: https://github.com/Grewpot/ragterminal-hub
- Vercel project: https://vercel.com/grewpots-projects/ragterminal-hub
- Supabase project: https://supabase.com/dashboard/project/zjifbqdvbmvuiwgwdkey (region: ap-south-1 / Mumbai)

Push to the main branch to trigger a Vercel deployment. The current frontend is a static HTML/CSS/JavaScript site; Supabase client code is loaded as a browser ES module.

## Community catalog

- Five category tabs: Knowledge, Flows, Blocks, Scripts, and Plays.
- Search, tag filtering and sort controls.
- Public catalog reads from Supabase's REST Data API using the publishable key.
- When there are no published records, clearly labeled demo assets are shown.
- Published package cards include a direct download link for the public release object.
- Stars are currently local to the browser; durable stars, download analytics and comments are not yet wired to the UI.

## Authentication and profiles

The auth-ui.js module implements Supabase email/password sign-up, sign-in, sign-out, session restoration, and create/edit profile fields (username, display name, bio and optional HTTPS avatar URL).

In Supabase Dashboard, open **Authentication → URL Configuration** and set:

- **Site URL:** https://ragterminal-hub.vercel.app
- **Redirect URLs:** https://ragterminal-hub.vercel.app/**
- Add preview/local redirect URLs only when needed.

Email confirmation uses the current site's origin as the redirect target, so it must be on the allowlist. Email/password sign-up also depends on the provider and email-delivery settings configured in Supabase Auth.

The browser code uses the Supabase **publishable** key only. Never place a service-role or secret key in index.html, auth-ui.js, or any browser-delivered file.

## Secure .pack upload and publication

The upload flow is deployed and uses Supabase Storage plus the pack-lifecycle Edge Function.

1. Signed-in user enters package title, slug, description, tags and license.
2. The .pack is uploaded to the private community-staging bucket using an owner-scoped path.
3. The authenticated Edge Function checks ownership, archive structure, size limits, file allowlist, manifest.json, JSONL records, declared checksums where supplied and common hard-coded secret patterns.
4. A validation preview shows the manifest metadata, file list, record counts, size and package SHA-256.
5. The uploader must explicitly attest that they have rights to share the content under the selected license, then submit the validated package for moderator review. The package stays private while pending.
6. An authorized moderator may inspect the validation report and choose **Approve & publish**, **Request changes**, or **Reject**. Approval rechecks the package checksum, copies the archive to community-releases, creates repository and per-category records/version metadata, and removes the staging copy where possible.
7. Published catalog cards open an asset detail page with version, license, checksum, validated file summary and a download link for the complete public .pack. No uploaded script or flow is executed during validation or publication.

### Current archive limits

- ZIP-formatted .pack archives only.
- Maximum compressed upload: 50 MiB.
- Maximum expanded contents: 50 MiB total; maximum 10 MiB per file.
- Maximum 32 ZIP entries and maximum compression ratio of 100:1.
- Up to 10,000 JSONL records per file; 1 MiB per non-empty JSONL line.
- Only manifest.json, optional README/license text, and defined JSONL paths under knowledge/, flows/, blocks/, scripts/, and plays/ are accepted.
- JSONL lines must decode to JSON objects. Unsafe paths, duplicate paths, unexpected files, invalid JSON and checksum mismatches are rejected.

Secret-pattern checks are heuristic guardrails, not a full malware scanner or a guarantee that content is harmless. The Hub does not execute user-provided code. Published packages become public and downloadable; private source material must not be uploaded.

## Moderation bootstrap

The moderator allowlist is private and cannot be managed from the public client. To provision a trusted moderator, first have them create and confirm their Supabase Auth account. Then, as a trusted project administrator, run this once in the Supabase SQL Editor after replacing the email with that moderator account:

```sql
insert into public.community_moderators (user_id, role)
select id, 'admin'
from auth.users
where lower(email) = lower('moderator@example.com')
on conflict (user_id) do update set role = excluded.role;
```

If the query inserts zero rows, confirm the user exists and has completed registration. Never add a public self-service moderator enrollment flow or put server credentials in browser code. The review queue appears only for allowlisted users. Rejection and change requests require a moderator note; approval is the only path that makes the package public.

## Database and storage

Tables include:

- community_profiles
- community_repositories
- community_artifacts
- community_artifact_versions
- community_stars
- community_download_events
- community_uploads
- community_moderators (private moderator allowlist; service-role controlled)
  
`community_uploads` tracks validation, license attestation and review status separately. Row Level Security is enabled. community-staging is private and scoped to the uploader's user ID. community-releases is public-read only; client policies do not permit public uploads. pack-lifecycle requires a valid user JWT and performs server-side validation/publication using server credentials.

The Security Advisor returned no security lints after the upload pipeline changes. Re-check security advisors after future schema/policy changes.

## Schema migration files

- supabase/migrations/202610110001_community_catalog.sql
- supabase/migrations/202610110002_secure_upload_pipeline.sql
- supabase/migrations/202610110003_community_moderation_review.sql
- supabase/functions/pack-lifecycle/index.ts
- supabase/functions/pack-lifecycle/deno.json

These migrations have already been applied to the connected Supabase project. Reconcile remote migration history before running supabase db push against an existing database.

## Not yet implemented

- Takedown/withdrawal workflow for already-published packages.
- Content/license review beyond uploader attestation and automated checks.
- Persistent user stars, comments and download analytics in the UI.
- Per-asset signed downloads (current download is the complete published .pack).
- Full malware analysis, semantic validation of every domain schema, and safe execution sandboxing.
- Knowledge import for the consumer workspace: chunking, embeddings, vector indexing and reindex controls.
