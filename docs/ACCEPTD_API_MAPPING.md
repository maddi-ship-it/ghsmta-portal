# Acceptd API application mapping

Verified against the Acceptd v2 OpenAPI document and read-only API responses on
August 4, 2026. This document intentionally excludes applicant response values
and other personally identifiable information.

## Current source scope

- Endpoint: `GET /v2/applications`
- Detail endpoint: `GET /v2/applications/{application}`
- Current program: `175284` — `2026-27 GHSMTA Director's Application`
- Required list filter: `programs=175284`
- Requested relationships: `include=user,program,tags`
- Current source count at verification time: 3 applications
- Submission state at verification time: 1 submitted, 2 not submitted

An unfiltered organization pull currently spans 1,150 applications across 24
historical and current programs. Production jobs must always provide a program
scope unless an organization-wide archive is explicitly intended.

## Verified response contract

The detail response is a flat object under `data`:

| Acceptd field | Portal use |
| --- | --- |
| `id` | Stable external record ID |
| `user` | Acceptd applicant user ID |
| `first_name`, `last_name`, `user` | Applicant name and stable Acceptd user ID |
| `program` | Acceptd program ID |
| `current_stage` | Acceptd stage ID; resolve names through `GET /v2/stages` |
| `started` | Application start timestamp |
| `submitted` | Submission timestamp or `null` |
| `answers` | Answer ID, value, optional attachment, and embedded question definition |
| `documentation` | Acceptd documentation records |
| `critiques` | Acceptd critique/rating records |
| `comments` | Acceptd comments |

Each embedded answer question supplies a stable numeric ID plus its type, label,
description, category, and archive state. The current program exposes 30 unique
Section A questions. A read-only scan of all 76 applications in historical
program `162204` exposed 628 unique question IDs across 39 categories and 21
field types. The expected form is around 688 questions; the approximately 60
not observed in API application data are most likely conditional questions that
none of the scanned records activated. The API does not publish a standalone
form-question endpoint, so the loader adds newly encountered IDs automatically
instead of inventing IDs for unseen fields.

## Implemented portal field mapping

| Portal field | Acceptd source | Rule |
| --- | --- | --- |
| `source_system` | constant | `acceptd-api-v2` |
| `source_record_id` | `data.id` | Convert to text |
| `external_applicant_name` | `first_name`, `last_name` | Join first and last name |
| `external_applicant_email` | first embedded email answer | Display/audit only; never auto-match identity by email |
| portal workflow status | existing portal application | Preserve; Acceptd submission state is source metadata |
| Acceptd submission time | `data.submitted` | Store in snapshot and `form_data.acceptd` |
| `source_stage` | `data.current_stage` | Preserve the numeric source stage separately |
| `school_name` | answer to question `82999` | Currently missing from all 3 source records |
| `production_title` | answer to question `83013` | Currently missing from all 3 source records |
| applicant email fallback | answer to question `83002` | Populated in all 3 current records |
| raw payload | complete detail object | Preserve in the owner-only snapshot table for audit |

Question definitions should store the Acceptd question ID in
`application_questions.settings.acceptd_question_id`. Labels are useful for
review but must not be treated as durable identifiers.

## Reconciliation rules

1. An owner maps the Acceptd program to an explicit portal cycle and form.
2. An owner maps each stable Acceptd user ID to one active applicant profile.
   Email is shown for context but is never used as an automatic identity match.
3. Once mapped, sync links the existing live application for that user/cycle or
   creates one on the mapped form. When Acceptd has not supplied a school name,
   the temporary value `School pending — Acceptd {application id}` satisfies the
   portal constraint and is replaced automatically when the answer appears.
4. Portal status and visible stage remain portal-owned. Acceptd stage and
   submission timestamps are stored as source metadata.
5. Source-managed answers can only be written by the server service role. An
   applicant cannot write to the hidden stage through the UI, a crafted Server
   Action request, or a direct authenticated Supabase request.

## Implemented ingestion boundary

API responses land in `acceptd_application_snapshots`, an owner-only table
idempotent on `(program_mapping_id, acceptd_application_id)`. Each snapshot
retains the raw payload, SHA-256 content hash, first/last seen timestamps, link
status, and reconciliation issue.

The target form receives one hidden `acceptd_synced_data` stage. Questions use
keys such as `acceptd_q_82999`, store source metadata in `settings`, and are
linked through `acceptd_question_mappings`. They remain visible to authorized
staff on application records but are rendered read-only.

## Delivery and freshness

The webhook route validates the raw body with HMAC-SHA256 before storing a
delivery. Acceptd's public setup article documents HMAC-SHA256 but does not name
the signature header, so `ACCEPTD_WEBHOOK_SIGNATURE_HEADER` must be set to the
exact header supplied in the account's webhook setup/support response. Hex,
`sha256=`-prefixed hex, and Base64 digests are accepted.

Verified deliveries receive an immediate `202`; processing continues with
Next.js `after()`. Acceptd disables a webhook after five consecutive delivery
failures, so a Vercel cron also reconciles enabled program mappings every two
minutes. The owner admin page receives status-only events through a private
Supabase Broadcast topic (`admin:acceptd-sync`). No application payload or PII
is included in Broadcast messages. Vercel schedules more frequent than daily
require a Pro plan; on Hobby, invoke the protected reconciliation endpoint from
another scheduler or reduce its Vercel schedule.

Attachments remain metadata/links; the integration does not copy source files
into portal storage. Copying them requires a separate retention and access
policy.
