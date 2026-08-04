# GHSMTA Awards Backbone Starter

A responsive Next.js + Supabase foundation for the Georgia High School Musical Theatre Awards application and adjudication system.

## Included

- Public landing page
- Applicant signup and shared sign-in
- Role-aware portal shell
- Four access levels: applicant, adjudicator, advisory member, owner
- Owner user-role management
- Awards-cycle management
- Application list and detail pages
- Owner editing of core application details
- Supabase RLS for every role
- Assignment-ready database schema
- Application audit trail
- Mobile and iPad-safe responsive styling

## 1. Create the app locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## 2. Configure Supabase

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `supabase/migrations/001_initial_schema.sql`.
4. Put the project URL and publishable key in `.env.local`.
5. In Authentication > URL Configuration, add:
   - `http://localhost:3000/auth/callback`
   - your Vercel production callback URL

## 3. Create the first owner

Create an applicant account through `/signup`, then run:

```sql
update public.profiles
set role = 'owner'
where email = 'YOUR_EMAIL';
```

Sign out and sign back in. The owner navigation will expose Cycles and Users.

## 4. Deploy to Vercel

Import the repository and add these environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

For the complete production release, also configure these server-only values:

- `SUPABASE_SERVICE_ROLE_KEY` — cron delivery, receipts, and school chat notices
- `CRON_SECRET` — protects the hourly notifications and minute Acceptd pull routes
- `ACCEPTD_API_TOKEN` — server-only Acceptd application pull access
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
- `SMTP_FROM_NAME` and `SMTP_REPLY_TO` (optional)
- `OPENAI_API_KEY` — voice dictation and handwritten-note scanning
- `OPENAI_TRANSCRIBE_MODEL` (optional; defaults to `gpt-4o-mini-transcribe`)
- `OPENAI_HANDWRITING_MODEL` (optional; defaults to `gpt-5.6-sol`)

Before deploying the release:

1. Apply all migrations through `supabase/migrations/20260804163627_acceptd_cron_only.sql`.
2. In Supabase Storage settings, set the project-wide maximum file size to at least 200 MB. The migration sets the private `reference-documents` bucket to 200 MB and the private `chat-files` bucket to 25 MB, but bucket limits cannot exceed the project-wide limit.
3. Keep both Storage buckets private and verify their RLS policies after migration.
4. Confirm `NEXT_PUBLIC_SITE_URL` is the canonical HTTPS production URL so invoice, receipt, and payment emails contain production links.
5. Run `npm run lint` and `npm run build` before promoting the deployment.

## Mobile direction

The web interface already uses safe-area insets, touch-sized controls, responsive tables, and phone/iPad breakpoints. Keep Supabase as the shared backend. When native packaging begins, either:

- add a Capacitor client that consumes the same Supabase backend, or
- add an Expo app in a monorepo and share TypeScript domain types, validation, and design tokens.

For a durable App Store product, the Expo companion app is the recommended long-term route; this web starter remains the public site and full admin workspace.

## Acceptd API sync

The owner-only **Program setup → Acceptd sync** page connects an Acceptd program
to a portal cycle/form, loads a hidden read-only question schema, reconciles
Acceptd user IDs to portal applicants, and monitors automatic application syncs.
The 2025–26 source program exposes 628 observed question IDs; conditional fields
are added automatically when the API first returns them, allowing the schema to
grow toward the expected roughly 688 questions without unsafe label matching.

Request API access from [Acceptd's developer portal](https://api.getacceptd.com),
then add the server-only token to `.env.local`:

```env
ACCEPTD_API_TOKEN=YOUR_BEARER_TOKEN
CRON_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
```

Apply the Acceptd migration, configure program `175284`, and use historical
program `162204` as the schema source. No Acceptd webhook or Integration setup is
required. Vercel calls `/api/cron/acceptd-sync` every minute in production; the
route verifies `CRON_SECRET` and pulls only enabled program mappings. The admin
status page refreshes through a private, owner-only Supabase Broadcast topic
containing no applicant PII. A one-minute Vercel schedule requires Pro. Hobby
deployments must reduce the schedule to once daily or use another scheduler.

For read-only API troubleshooting, pull a small private schema sample:

```bash
npm run acceptd:pull -- \
  --programs 175284 \
  --limit 5 \
  --output ./acceptd-2026-27-application-sample.json
```

Program `175284` is the 2026–27 GHSMTA Director's Application. A program scope
is required by default to avoid collecting unrelated historical applicant PII;
use `--all-programs` only for an intentional organization-wide pull. Add
`--list-only` to skip detail requests, or `--query 'key=value'` for another
documented Acceptd list parameter. Use `--force` only when intentionally
replacing an existing snapshot. Snapshot files are created with owner-only
permissions and can contain applicant PII, so keep them out of source control.
The verified source contract, question coverage, security boundary, and sync
behavior are documented in
[`docs/ACCEPTD_API_MAPPING.md`](docs/ACCEPTD_API_MAPPING.md).

## Immediate next modules

1. Dynamic application form builder and form versions
2. School directory and applicant onboarding
3. Adjudicator assignment interface
4. Adjudication rubric and scoring
5. Conflict-of-interest controls
6. Email notifications and deadlines
7. File uploads and document review
8. Audit-log viewer and exports

## Adjudication scoring and AI narratives

Run migrations in order through:

```text
supabase/migrations/005_adjudication_scoring_and_ai.sql
```

Then seed the rubric recovered from the 2025–2026 scoring workbook:

```bash
node scripts/seed-2025-2026-scoring.mjs
```

The scoring module includes:

- 15 GHSMTA scoring categories and 58 criteria from the supplied workbook
- private adjudicator scorecards and four-part comment quadrants
- advisory/owner panel review
- owner-edited ChatGPT prompt and AI-assisted panel narratives
- owner approval and explicit score/feedback release
- school access only to released category averages and approved narrative snapshots
- responsive category tabs and full bottom navigation on phone and iPad layouts

For AI narrative generation, add these server-only variables locally and in Vercel:

```env
OPENAI_API_KEY=sk-YOUR_OPENAI_API_KEY
OPENAI_MODEL=gpt-5-mini
```

Never prefix the OpenAI key with `NEXT_PUBLIC_`.
