# GHSMTA production release runbook

## Required configuration

- Confirm production Supabase URL, publishable key, and server-only service-role key.
- Confirm SMTP host, port, account, app password, sender, and reply-to address.
- Confirm `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, and the OpenAI server key.
- Keep `STAFF_SIGNUP_ENABLED=false` unless a controlled registration window is active.
- Keep `PHONE_VERIFICATION_ENABLED=false` until the Supabase SMS provider is configured and tested.

## Database rollout

1. Take a Supabase backup or confirm point-in-time recovery.
2. Run `supabase/migrations/20260803011303_production_hardening_release.sql` in the SQL Editor after all earlier migrations.
3. Run `supabase/migrations/20260803140701_chat_channel_rebrand.sql`.
4. Run `supabase/migrations/20260803141257_owner_reference_upload_500mb.sql`.
5. Run `supabase/migrations/20260803142145_admin_feedback_ticket_workspace.sql`.
6. Run `supabase/migrations/20260803152247_invoice_message_templates.sql`.
7. Run `supabase/migrations/20260803173346_add_program_manager_role.sql`.
8. Run `supabase/migrations/20260803173350_program_manager_scholarship_access.sql`.
9. Run verification scripts `030` through `036`; require passing results from all seven.
10. Review the Supabase Security and Performance Advisors before deployment.

## Application rollout

1. Run `npm ci`, `npm run check`, `npm run build`, and `npm audit --omit=dev`.
2. Deploy to a Vercel preview and smoke-test Owner, Program Manager, applicant, adjudicator, and Advisory Committee accounts.
3. Verify light, dark, and system themes at desktop and mobile widths.
4. Preview and send a paid test invoice and a scholarship confirmation; verify edited message personalization, email PDF attachment, private School Messaging, queue removal/void return, receipt, reminder, and retry behavior.
5. Verify chat reactions, a 25 MB file rejection boundary, school channel grouping, voice dictation, note scanning, schedule panel/understudy/shadow signup, and locked score submission.
6. Submit a scholarship application and verify its private chat is visible only to that applicant, Program Managers, and Owners. Confirm Program Managers see General Announcements and released results, but cannot open school messaging, panel channels, Advisory chat, School Community Chat, adjudication, or configuration pages.
7. Promote the verified deployment to production and watch `/api/health`, Vercel function logs, and Owner system notifications.

## Rollback

- Roll back the Vercel deployment first if application behavior regresses.
- Do not remove financial or audit columns during an incident. Preserve invoice, delivery, chat, and scoring records.
- Disable the cron in Vercel if reminder delivery is involved, then investigate delivery logs before re-enabling it.
