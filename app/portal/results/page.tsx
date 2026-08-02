import Link from "next/link";

import { formatScoreAverage } from "@/lib/adjudication";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationRelease,
  Application,
  AwardCycle,
} from "@/lib/types";

function formatReleaseDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

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

  const [{ data: releaseData, error: releaseError }, { data: cycleData }] =
    applicationIds.length
      ? await Promise.all([
          supabase
            .from("adjudication_releases")
            .select("*")
            .in("application_id", applicationIds),
          supabase
            .from("award_cycles")
            .select("*")
            .in(
              "id",
              applications.map((application) => application.cycle_id),
            ),
        ])
      : [{ data: [], error: null }, { data: [] }];

  if (releaseError) throw new Error(releaseError.message);

  const releases = (releaseData ?? []) as AdjudicationRelease[];
  const cycles = (cycleData ?? []) as AwardCycle[];
  const releaseMap = new Map(
    releases.map((release) => [release.application_id, release]),
  );
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const releasedApplications = applications.filter((application) =>
    releaseMap.has(application.id),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Released adjudication results</h1>
          <p>Only results formally released by GHSMTA appear here.</p>
        </div>
      </div>

      {releasedApplications.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <h3>No results have been released yet.</h3>
            <p>
              Your application and adjudication work remain private while the
              panel completes its review.
            </p>
            <Link
              className="button button-secondary"
              href="/portal/admin/applications"
            >
              Return to my application
            </Link>
          </div>
        </section>
      ) : (
        <div className="released-results-list">
          {releasedApplications.map((application) => {
            const release = releaseMap.get(application.id)!;
            const cycle = cycleMap.get(application.cycle_id);
            const scoreSnapshot = Array.isArray(release.score_snapshot)
              ? release.score_snapshot
              : [];
            const feedbackSnapshot = Array.isArray(release.feedback_snapshot)
              ? release.feedback_snapshot
              : [];

            return (
              <details
                className="panel released-results-panel released-result-disclosure"
                key={application.id}
              >
                <summary className="released-results-summary">
                  <div className="released-results-summary-copy">
                    <span className="eyebrow">
                      {cycle
                        ? `${cycle.season_year} · ${cycle.name}`
                        : "Application"}
                    </span>
                    <h2>{application.school_name}</h2>
                    <p>
                      {application.production_title ?? "Untitled production"}
                    </p>
                  </div>
                  <div className="released-results-summary-meta">
                    <span>
                      {release.feedback_released_at
                        ? `Feedback released ${formatReleaseDate(
                            release.feedback_released_at,
                          )}`
                        : release.scores_released_at
                          ? `Scores released ${formatReleaseDate(
                              release.scores_released_at,
                            )}`
                          : "Results released"}
                    </span>
                    <strong className="released-results-toggle-label">
                      <span className="released-results-open-label">
                        View results
                      </span>
                      <span className="released-results-close-label">
                        Hide results
                      </span>
                      <span
                        aria-hidden="true"
                        className="released-results-chevron"
                      >
                        ⌄
                      </span>
                    </strong>
                  </div>
                </summary>

                <div className="released-results-expanded">
                  <div className="released-results-actions">
                    <Link
                      className="button button-gold"
                      href={`/portal/results/${application.id}/pdf`}
                      target="_blank"
                    >
                      Download PDF
                    </Link>
                    <Link
                      className="button button-secondary"
                      href={`/portal/applications/${application.id}`}
                    >
                      View application
                    </Link>
                  </div>

                  {release.scores_released_at ? (
                    <details className="released-results-section">
                      <summary>
                        <div>
                          <h3>Released category averages</h3>
                          <p className="release-date">
                            Released {formatReleaseDate(release.scores_released_at)}
                          </p>
                        </div>
                        <span aria-hidden="true">⌄</span>
                      </summary>
                      <div className="released-results-section-body">
                        {scoreSnapshot.length > 0 ? (
                          <div className="released-score-grid">
                            {scoreSnapshot
                              .slice()
                              .sort((a, b) => a.sort_order - b.sort_order)
                              .map((item) => (
                                <article key={item.category_id}>
                                  <span>{item.title}</span>
                                  <strong>
                                    {formatScoreAverage(item.average_score)}
                                  </strong>
                                </article>
                              ))}
                          </div>
                        ) : (
                          <p className="empty-release-copy">
                            Category averages were released, but no score
                            snapshot is available. Contact GHSMTA staff for
                            assistance.
                          </p>
                        )}
                      </div>
                    </details>
                  ) : null}

                  {release.feedback_released_at ? (
                    <details className="released-results-section" open>
                      <summary>
                        <div>
                          <h3>Adjudication panel feedback</h3>
                          <p className="release-date">
                            Released {formatReleaseDate(release.feedback_released_at)}
                          </p>
                        </div>
                        <span aria-hidden="true">⌄</span>
                      </summary>
                      <div className="released-results-section-body released-feedback-list">
                        {feedbackSnapshot.length > 0 ? (
                          feedbackSnapshot
                            .slice()
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map((item) => (
                              <details
                                className="released-feedback-item"
                                key={item.category_id}
                              >
                                <summary>
                                  <h4>{item.title}</h4>
                                  <span aria-hidden="true">⌄</span>
                                </summary>
                                <div className="released-feedback-copy">
                                  <p>{item.final_comment}</p>
                                </div>
                              </details>
                            ))
                        ) : (
                          <p className="empty-release-copy">
                            Feedback was released, but the released comment
                            snapshot is empty. Contact GHSMTA staff for
                            assistance.
                          </p>
                        )}
                      </div>
                    </details>
                  ) : null}

                  {release.release_notes ? (
                    <div className="panel-body release-note">
                      <strong>GHSMTA note</strong>
                      <p>{release.release_notes}</p>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
