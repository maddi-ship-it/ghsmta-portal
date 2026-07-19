import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AwardCycle, ScoringCategory, ScoringCriterion, ScoringRubric } from "@/lib/types";

import { createCategory, createCriterion, duplicateRubricVersion, publishRubric, updateCategory, updateCriterion, updateRubric } from "./actions";

export default async function RubricEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string }>;
}) {
  await requireProfile(["owner"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const [{ data: rubricData }, { data: categoriesData }] = await Promise.all([
    supabase.from("scoring_rubrics").select("*").eq("id", id).maybeSingle(),
    supabase.from("scoring_categories").select("*").eq("rubric_id", id).order("sort_order"),
  ]);
  if (!rubricData) notFound();
  const rubric = rubricData as ScoringRubric;
  const categories = (categoriesData ?? []) as ScoringCategory[];
  const categoryIds = categories.map((category) => category.id);
  const [{ data: cycleData }, { data: criteriaData }] = await Promise.all([
    supabase.from("award_cycles").select("*").eq("id", rubric.cycle_id).single(),
    categoryIds.length ? supabase.from("scoring_criteria").select("*").in("category_id", categoryIds).order("sort_order") : Promise.resolve({ data: [] }),
  ]);
  const cycle = cycleData as AwardCycle;
  const criteria = (criteriaData ?? []) as ScoringCriterion[];
  const editable = rubric.status === "draft";

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">{cycle.season_year} · {cycle.name}</span><h1>Scoring rubric editor</h1><p>Edit a draft rubric, duplicate a published rubric into a new version, and publish before scoring begins.</p></div><Link className="button button-secondary" href="/portal/admin/setup?tab=scoring">Back to scoring setup</Link></div>
      {query.published && <div className="notice page-message">Rubric published.</div>}
      {!editable && <div className="info-banner">This rubric is {rubric.status} and read-only. Duplicate it to create an editable draft.</div>}

      <section className="panel rubric-editor-overview"><div className="panel-header"><div><h2>{rubric.name}</h2><p>Version {rubric.version_number} · {rubric.status}</p></div><span className={`badge badge-form-${rubric.status}`}>{rubric.status}</span></div><div className="panel-body rubric-editor-top-grid">
        <form action={updateRubric.bind(null, rubric.id)} className="form-stack">
          <div className="field"><label>Name</label><input className="input" defaultValue={rubric.name} disabled={!editable} name="name" required /></div>
          <div className="two-column-grid"><div className="field"><label>Minimum score</label><input className="input" defaultValue={rubric.score_min} disabled={!editable} name="score_min" step="0.25" type="number" /></div><div className="field"><label>Maximum score</label><input className="input" defaultValue={rubric.score_max} disabled={!editable} name="score_max" step="0.25" type="number" /></div></div>
          {editable && <button className="button button-secondary" type="submit">Save rubric settings</button>}
        </form>
        <div className="rubric-version-actions">
          <form action={duplicateRubricVersion.bind(null, rubric.id)} className="form-stack"><div className="field"><label>New draft name</label><input className="input" name="copy_name" placeholder={`${rubric.name} — Copy`} /></div><button className="button button-secondary" type="submit">Duplicate as editable draft</button></form>
          {editable && <form action={publishRubric.bind(null, rubric.id)}><button className="button button-dark" type="submit">Publish this rubric</button></form>}
        </div>
      </div></section>

      {editable && <section className="panel"><div className="panel-header"><div><h2>Add category</h2><p>Create a new scoring category at the end of the rubric.</p></div></div><div className="panel-body"><form action={createCategory.bind(null, rubric.id)} className="rubric-category-create-grid"><div className="field"><label>Title</label><input className="input" name="title" required /></div><div className="field"><label>Stable key</label><input className="input" name="category_key" placeholder="auto-generated" /></div><div className="field"><label>Application subject label</label><input className="input" name="subject_label" /></div><div className="field field-span-2"><label>Description</label><textarea className="textarea compact-textarea" name="description" /></div><div className="field field-span-2"><label>Guidance</label><textarea className="textarea compact-textarea" name="guidance" /></div><label className="inline-check"><input defaultChecked name="required" type="checkbox" /> Required</label><label className="inline-check"><input defaultChecked name="allow_not_applicable" type="checkbox" /> Allow ineligible</label><button className="button button-dark" type="submit">Add category</button></form></div></section>}

      <div className="rubric-category-editor-list">
        {categories.map((category) => {
          const categoryCriteria = criteria.filter((criterion) => criterion.category_id === category.id);
          return <section className="panel rubric-category-editor" key={category.id}><div className="panel-header"><div><span className="eyebrow">Category {category.sort_order}</span><h2>{category.title}</h2><p>{categoryCriteria.length} criteria</p></div><span className={`badge ${category.active ? "badge-complete" : "badge-warning"}`}>{category.active ? "Active" : "Hidden"}</span></div><div className="panel-body">
            <form action={updateCategory.bind(null, rubric.id, category.id)} className="form-stack"><div className="rubric-category-settings-grid"><div className="field"><label>Title</label><input className="input" defaultValue={category.title} disabled={!editable} name="title" required /></div><div className="field"><label>Stable key</label><input className="input" defaultValue={category.category_key} disabled={!editable} name="category_key" required /></div><div className="field"><label>Subject label</label><input className="input" defaultValue={category.subject_label ?? ""} disabled={!editable} name="subject_label" /></div><div className="field"><label>Order</label><input className="input" defaultValue={category.sort_order} disabled={!editable} name="sort_order" type="number" /></div></div><div className="field"><label>Description</label><textarea className="textarea compact-textarea" defaultValue={category.description ?? ""} disabled={!editable} name="description" /></div><div className="field"><label>Guidance</label><textarea className="textarea compact-textarea" defaultValue={category.guidance ?? ""} disabled={!editable} name="guidance" /></div><div className="inline-check-row"><label className="inline-check"><input defaultChecked={category.required} disabled={!editable} name="required" type="checkbox" /> Required</label><label className="inline-check"><input defaultChecked={category.allow_not_applicable} disabled={!editable} name="allow_not_applicable" type="checkbox" /> Allow ineligible</label><label className="inline-check"><input defaultChecked={category.active} disabled={!editable} name="active" type="checkbox" /> Active</label></div>{editable && <button className="button button-secondary button-compact" type="submit">Save category</button>}</form>
            <div className="rubric-criteria-editor"><h3>Criteria</h3>{categoryCriteria.map((criterion) => <form action={updateCriterion.bind(null, rubric.id, criterion.id)} className="rubric-criterion-row" key={criterion.id}><div className="field"><label>Criterion</label><input className="input" defaultValue={criterion.title} disabled={!editable} name="title" /></div><div className="field"><label>Stable key</label><input className="input" defaultValue={criterion.criterion_key} disabled={!editable} name="criterion_key" /></div><div className="field criterion-description-field"><label>Description</label><textarea className="textarea compact-textarea" defaultValue={criterion.description ?? ""} disabled={!editable} name="description" /></div><div className="field"><label>Weight</label><input className="input" defaultValue={criterion.weight} disabled={!editable} name="weight" step="0.25" type="number" /></div><div className="field"><label>Order</label><input className="input" defaultValue={criterion.sort_order} disabled={!editable} name="sort_order" type="number" /></div><label className="inline-check"><input defaultChecked={criterion.active} disabled={!editable} name="active" type="checkbox" /> Active</label>{editable && <button className="button button-secondary button-compact" type="submit">Save</button>}</form>)}
              {editable && <form action={createCriterion.bind(null, rubric.id, category.id)} className="rubric-criterion-create"><div className="field"><label>New criterion</label><input className="input" name="title" required /></div><div className="field"><label>Stable key</label><input className="input" name="criterion_key" placeholder="auto-generated" /></div><div className="field criterion-description-field"><label>Description</label><textarea className="textarea compact-textarea" name="description" /></div><div className="field"><label>Weight</label><input className="input" defaultValue="1" name="weight" step="0.25" type="number" /></div><button className="button button-dark button-compact" type="submit">Add criterion</button></form>}
            </div>
          </div></section>;
        })}
      </div>
    </>
  );
}
