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

## Mobile direction

The web interface already uses safe-area insets, touch-sized controls, responsive tables, and phone/iPad breakpoints. Keep Supabase as the shared backend. When native packaging begins, either:

- add a Capacitor client that consumes the same Supabase backend, or
- add an Expo app in a monorepo and share TypeScript domain types, validation, and design tokens.

For a durable App Store product, the Expo companion app is the recommended long-term route; this web starter remains the public site and full admin workspace.

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
