import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicatorAssignment,
  AiPromptTemplate,
  Application,
  AwardCycle,
  Profile,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
} from "@/lib/types";

import {
  assignAdjudicator,
  removeAdjudicatorAssignment,
  saveAiPrompt,
} from "./actions";

const defaultUserTemplate = `SCHOOL: {{school_name}}
PRODUCTION: {{production_title}}
CATEGORY: {{category_title}}
CRITERIA:
{{criteria}}

ADJUDICATOR OBSERVATIONS:
{{raw_comments}}`;

export default async function ScoringAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ assigned?: string; prompt_saved?: string }>;
}) {
  await requireProfile(["owner"]);
  const query = await searchParams;
  const supabase = await createClient();

  const [
    cyclesResult,
    applicationsResult,
    adjudicatorsResult,
    assignmentsResult,
    rubricsResult,
    categoriesResult,
    criteriaResult,
    promptsResult,
  ] = await Promise.all([
    supabase.from("award_cycles").select("*").neq("status", "archived").order("season_year", { ascending: false }).order("name"),
    supabase.from("applications").select("*").eq("is_archived", false).order("school_name"),
    supabase.from("profiles").select("id,email,full_name,role,active").eq("role", "adjudicator").eq("active", true).order("full_name"),
    supabase.from("adjudicator_assignments").select("*").order("assigned_at", { ascending: false }),
    supabase.from("scoring_rubrics").select("*").order("created_at", { ascending: false }),
    supabase.from("scoring_categories").select("*").order("sort_order"),
    supabase.from("scoring_criteria").select("*").order("sort_order"),
    supabase.from("ai_prompt_templates").select("*").eq("template_key", "panel_category_comment").order("cycle_id", { ascending: true }).order("version_number", { ascending: false }),
  ]);

  for (const result of [
    cyclesResult,
    applicationsResult,
    adjudicatorsResult,
    assignmentsResult,
    rubricsResult,
    categoriesResult,
    criteriaResult,
    promptsResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const cycles = (cyclesResult.data ?? []) as AwardCycle[];
  const activeCycleIds = new Set(cycles.map((cycle) => cycle.id));
  const applications = ((applicationsResult.data ?? []) as Application[]).filter(
    (application) => activeCycleIds.has(application.cycle_id),
  );
  const activeApplicationIds = new Set(applications.map((application) => application.id));
  const adjudicators = (adjudicatorsResult.data ?? []) as Profile[];
  const assignments = ((assignmentsResult.data ?? []) as AdjudicatorAssignment[]).filter(
    (assignment) => activeApplicationIds.has(assignment.application_id),
  );
  const rubrics = ((rubricsResult.data ?? []) as ScoringRubric[]).filter(
    (rubric) => activeCycleIds.has(rubric.cycle_id) && rubric.status !== "archived",
  );
  const categories = (categoriesResult.data ?? []) as ScoringCategory[];
  const criteria = (criteriaResult.data ?? []) as ScoringCriterion[];
  const prompts = (promptsResult.data ?? []) as AiPromptTemplate[];

  const applicationMap = new Map(applications.map((application) => [application.id, application]));
  const adjudicatorMap = new Map(adjudicators.map((profile) => [profile.id, profile]));
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const latestGlobalPrompt = prompts.find((prompt) => !prompt.cycle_id) ?? null;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Scoring setup</h1>
          <p>Manage adjudicator assignments, scoring rubrics, and the owner-controlled AI narrative prompt.</p>
        </div>
      </div>

      {query.assigned && <div className="notice page-message">Adjudicator assignment saved.</div>}
      {query.prompt_saved && <div className="notice page-message">AI narrative prompt saved.</div>}

      <details className="panel scoring-admin-section admin-collapsible-section">
        <summary className="admin-collapsible-summary">
          <div>
            <span className="eyebrow">Panel management</span>
            <h2>Assign adjudicators</h2>
            <p>{assignments.length} active assignments · {adjudicators.length} available adjudicators</p>
          </div>
          <span className="admin-collapsible-toggle">Open</span>
        </summary>
        <div className="panel-body">
          <form action={assignAdjudicator} className="form-grid assignment-form">
            <div className="field">
              <label htmlFor="application_id">Application</label>
              <select className="select" id="application_id" name="application_id" required>
                <option value="">Choose an application</option>
                {applications.map((application) => {
                  const cycle = cycleMap.get(application.cycle_id);
                  return <option key={application.id} value={application.id}>{application.school_name} — {application.production_title ?? "Untitled"}{cycle ? ` (${cycle.season_year})` : ""}</option>;
                })}
              </select>
            </div>
            <div className="field">
              <label htmlFor="adjudicator_user_id">Adjudicator</label>
              <select className="select" id="adjudicator_user_id" name="adjudicator_user_id" required>
                <option value="">Choose an adjudicator</option>
                {adjudicators.map((adjudicator) => <option key={adjudicator.id} value={adjudicator.id}>{adjudicator.full_name ?? adjudicator.email}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="due_at">Due date</label>
              <input className="input" id="due_at" name="due_at" type="datetime-local" />
            </div>
            <div className="field field-span-2">
              <label htmlFor="internal_notes">Internal assignment notes</label>
              <input className="input" id="internal_notes" name="internal_notes" placeholder="Optional" />
            </div>
            <button className="button button-dark" type="submit">Save assignment</button>
          </form>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>School</th><th>Production</th><th>Adjudicator</th><th>Status</th><th>Due</th><th /></tr></thead>
            <tbody>
              {assignments.map((assignment) => {
                const application = applicationMap.get(assignment.application_id);
                const adjudicator = adjudicatorMap.get(assignment.adjudicator_user_id);
                return (
                  <tr key={assignment.id}>
                    <td>{application?.school_name ?? "Unavailable application"}</td>
                    <td>{application?.production_title ?? "—"}</td>
                    <td>{adjudicator?.full_name ?? adjudicator?.email ?? "Unavailable user"}</td>
                    <td><span className="badge">{assignment.status.replaceAll("_", " ")}</span></td>
                    <td>{assignment.due_at ? new Date(assignment.due_at).toLocaleString() : "—"}</td>
                    <td><form action={removeAdjudicatorAssignment.bind(null, assignment.id)}><button className="text-danger" type="submit">Remove</button></form></td>
                  </tr>
                );
              })}
              {assignments.length === 0 && <tr><td colSpan={6}>No adjudicators have been assigned yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </details>

      <details className="panel scoring-admin-section admin-collapsible-section">
        <summary className="admin-collapsible-summary">
          <div>
            <span className="eyebrow">Scoring guides</span>
            <h2>Scoring rubrics</h2>
            <p>{rubrics.length} active rubrics · {categories.length} categories · {criteria.length} criteria</p>
          </div>
          <span className="admin-collapsible-toggle">Open</span>
        </summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Program</th><th>Rubric</th><th>Status</th><th>Categories</th><th>Criteria</th><th /></tr></thead>
            <tbody>
              {rubrics.map((rubric) => {
                const cycle = cycleMap.get(rubric.cycle_id);
                const rubricCategories = categories.filter((category) => category.rubric_id === rubric.id);
                const categoryIds = new Set(rubricCategories.map((category) => category.id));
                return (
                  <tr key={rubric.id}>
                    <td>{cycle ? `${cycle.season_year} — ${cycle.name}` : "Unknown program"}</td>
                    <td>{rubric.name}</td>
                    <td><span className={`badge badge-form-${rubric.status}`}>{rubric.status}</span></td>
                    <td>{rubricCategories.length}</td>
                    <td>{criteria.filter((criterion) => categoryIds.has(criterion.category_id)).length}</td>
                    <td><Link href={`/portal/admin/scoring/rubrics/${rubric.id}`}>{rubric.status === "draft" ? "Edit rubric" : "Open rubric"}</Link></td>
                  </tr>
                );
              })}
              {rubrics.length === 0 && <tr><td colSpan={6}>No scoring rubric is installed yet. Run the included 2025–2026 rubric seed script.</td></tr>}
            </tbody>
          </table>
        </div>
      </details>

      <details className="panel scoring-admin-section admin-collapsible-section">
        <summary className="admin-collapsible-summary">
          <div>
            <span className="eyebrow">Narrative generation</span>
            <h2>ChatGPT narrative prompt</h2>
            <p>{latestGlobalPrompt ? `Active model: ${latestGlobalPrompt.model}` : "Global prompt not configured"}</p>
          </div>
          <span className="admin-collapsible-toggle">Open</span>
        </summary>
        <div className="panel-body">
          <form action={saveAiPrompt} className="form-stack">
            <input name="prompt_id" type="hidden" value={latestGlobalPrompt?.id ?? ""} />
            <div className="form-grid">
              <div className="field">
                <label htmlFor="prompt_name">Prompt name</label>
                <input className="input" id="prompt_name" name="name" defaultValue={latestGlobalPrompt?.name ?? "GHSMTA panel category narrative"} required />
              </div>
              <div className="field">
                <label htmlFor="prompt_model">OpenAI model</label>
                <input className="input" id="prompt_model" name="model" defaultValue={latestGlobalPrompt?.model ?? "gpt-5-mini"} required />
              </div>
              <input name="cycle_id" type="hidden" value="" />
              <div className="field">
                <label>Prompt scope</label>
                <div className="input input-static">Global default for all programs</div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="system_prompt">System prompt</label>
              <textarea className="textarea prompt-textarea" id="system_prompt" name="system_prompt" defaultValue={latestGlobalPrompt?.system_prompt ?? "You synthesize the observations of multiple Georgia High School Musical Theatre Awards adjudicators into one polished panel comment. Write in the collective voice of the adjudication panel and speak directly to the school. Preserve specific observed examples. Balance celebration with constructive opportunities for growth. Do not identify individual adjudicators, invent observations, mention numeric scores, or imply that AI made the judgment. Use supportive, clear, theatre-education language. Return only the finished narrative comment."} required />
            </div>
            <div className="field">
              <label htmlFor="user_prompt_template">User prompt template</label>
              <textarea className="textarea prompt-textarea" id="user_prompt_template" name="user_prompt_template" defaultValue={latestGlobalPrompt?.user_prompt_template ?? defaultUserTemplate} required />
              <small className="field-help">Available placeholders: {"{{school_name}}"}, {"{{production_title}}"}, {"{{category_title}}"}, {"{{criteria}}"}, and {"{{raw_comments}}"}.</small>
            </div>
            <button className="button button-dark" type="submit">Save AI prompt</button>
          </form>
        </div>
      </details>
    </>
  );
}
