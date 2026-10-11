# RAGTerminal Hub

A Hugging Face–inspired community catalog for RAGTerminal assets: Knowledge, Flows, Blocks, Scripts, and Plays.

## Current deployed implementation

- Static, responsive community catalog served by Vercel from index.html.
- Search, five category tabs, tag filters, sorting, sample cards, and local-only stars.
- Public catalog reads from Supabase's REST Data API using the project URL and publishable key.
- auth-ui.js implements Supabase email/password sign-up, sign-in, sign-out, and profile create/edit in a modal.
- Public pages use demo assets when no published records are present.
- Upload and package download remain intentionally disabled until private staging storage, validation, and publishing controls are implemented.

## Deployment

- GitHub repository: https://github.com/Grewpot/ragterminal-hub
- Vercel project: https://vercel.com/grewpots-projects/ragterminal-hub
- Production URL: https://ragterminal-hub.vercel.app
- Supabase project: https://supabase.com/dashboard/project/zjifbqdvbmvuiwgwdkey
- Supabase region: ap-south-1 (Mumbai)

Push changes to the main branch to trigger a Vercel deployment.

## Supabase Auth setup

In Supabase Dashboard, open **Authentication → URL Configuration** and set:

- **Site URL:** https://ragterminal-hub.vercel.app
- **Redirect URLs:** https://ragterminal-hub.vercel.app/**
- Add preview/local URLs only as needed, such as https://*-grewpots-projects.vercel.app/** and http://localhost:3000/**.

Email confirmation uses the current site's origin as its redirect target. That URL must be on Supabase Auth's allowlist. Email/password sign-up uses the provider and email-delivery settings configured in Supabase Auth. The UI currently does not implement a custom server-side OAuth callback.

The browser code uses only the Supabase **publishable** key. Never place a service-role or secret key in index.html, auth-ui.js, or any browser-delivered file.

## Database

The community schema defines:

- community_profiles: public profile fields, editable only by the profile owner.
- community_repositories: repository/package metadata, visibility and publication status.
- community_artifacts: Knowledge, Flow, Block, Script and Play entries.
- community_artifact_versions: release metadata, checksum and storage path.
- community_stars: per-user stars with star identities private to the user.
- community_download_events: download telemetry scoped to the signed-in user.

Row Level Security is enabled on all six tables. Security Advisor returned no security lints during the initial setup review. The schema snapshot is stored at supabase/migrations/202610110001_community_catalog.sql; it corresponds to the schema applied to the connected Supabase project. Reconcile the migration history before using CLI migration push on an existing database.

## Next implementation steps

1. Configure Supabase Auth Site URL and allowed redirect URLs, then test sign-up confirmation and profile editing with a real test account.
2. Move public counts and persistent stars to database-backed queries.
3. Add a private Storage bucket and authenticated upload policies.
4. Add RAGTerminal pack archive limits, safe extraction, manifest/JSONL validation, checksum verification, malware/secrets scanning, and a moderation/publish step.
5. Implement signed downloads and persistent download counts.
6. Add the Knowledge import pipeline: validate, chunk, embed, index, and track the embedding profile per workspace.
7. Only execute Scripts/Flows/Plays through a separately secured sandbox; never execute them during upload or preview.
