import Link from "next/link";

import {
  formatScore,
  formatScoreAverage,
} from "@/lib/adjudication";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationRelease,
  Application,
  AwardCycle,
} from "@/lib/types";

export default async function ReleasedResultsPage() {
  await requireProfile(["applicant"]);
  const supabase = await createClient();

  const { data: applicationData, error: applicationError } = await supabase
    .from("applications")
    .select("*")
    .eq("is_archived", false)
    .order("updated_at", { ascending: false });
  if (applicationError) throw new Error(applicationError.message);
  const applications = (applicationData ?? []) as Application[];

  const applicationIds = applications.map((application) => application.id);
  const [{ data: releaseData, error: releaseError }, { data: cycleData }] = applicationIds.length
    ? await Promise.all([
      supabase.from("adjudication_releases").select("*").in("application_id", applicationIds),
      supabase.from("award_cycles").select("*").in("id", applications.map((application) => application.cycle_id)),
    ])
    : [{ data: [], error: null }, { data: [] }];
  if (releaseError) throw new Error(releaseError.message);

  const releases = (releaseData ?? []) as AdjudicationRelease[];
  const cycles = (cycleData ?? []) as AwardCycle[];
  const releaseMap = new Map(releases.map((release) => [release.application_id, release]));
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const releasedApplications = applications.filter((application) => releaseMap.has(application.id));

  return (
    <>
      <div className="page-heading">
        <div><h1>Released adjudication results</h1><p>Only results formally released by GHSMTA appear here.</p></div>
      </div>

      {releasedApplications.length === 0 ? (
        <section className="panel"><div className="empty-state"><h3>No results have been released yet.</h3><p>Your application and adjudication work remain private while the panel completes its review.</p><Link className="button button-secondary" href="/portal/admin/applications">Return to my application</Link></div></section>
      ) : releasedApplications.map((application) => {
        const release = releaseMap.get(application.id)!;
        const cycle = cycleMap.get(application.cycle_id);
        return (
          <section className="panel released-results-panel" key={application.id}>
            <div className="panel-header released-results-heading"><div><span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Application"}</span><h2>{application.school_name}</h2><p>{application.production_title ?? "Untitled production"}</p></div><Link href={`/portal/applications/${application.id}`}>View application</Link></div>

            {release.scores_released_at && <div className="panel-body"><h3>Released category averages</h3><p className="release-date">Released {new Date(release.scores_released_at).toLocaleDateString()}</p><div className="released-score-grid">{release.score_snapshot.map((item) => <article key={item.category_id}><span>{item.title}</span><strong>{formatScoreAverage(item.average_score)}</strong></article>)}</div></div>}

            {release.feedback_released_at && <div className="panel-body released-feedback-section"><h3>Adjudication panel feedback</h3><p className="release-date">Released {new Date(release.feedback_released_at).toLocaleDateString()}</p><div className="released-feedback-list">{release.feedback_snapshot.map((item) => <article key={item.category_id}><h4>{item.title}</h4><p>{item.final_comment}</p></article>)}</div></div>}

            {release.release_notes && <div className="panel-body release-note"><strong>GHSMTA note</strong><p>{release.release_notes}</p></div>}
          </section>
        );
      })}
    </>
  );
}
