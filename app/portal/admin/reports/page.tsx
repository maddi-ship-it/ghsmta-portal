import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ReportName =
  | "missing-comments"
  | "missing-scores"
  | "specialty-awards";

type MissingRow = {
  application_id: string;
  school_name: string;
  production_title: string | null;
  adjudicator_name: string;
  adjudicator_email: string | null;
  category_title: string;
  criterion_title: string;
  scorecard_status: string;
};

type SpecialtyRow = {
  application_id: string;
  school_name: string;
  production_title: string | null;
  award_type: string;
  recommendation_status: string;
  song_title: string | null;
  explanation: string | null;
  status: string;
  advisory_member_name: string;
};

function title(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reportHref(report: ReportName) {
  return `/portal/admin/reports?report=${report}`;
}

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  await requireProfile(["owner"]);
  const query = await searchParams;
  const selected: ReportName =
    query.report === "missing-scores" ||
    query.report === "specialty-awards"
      ? query.report
      : "missing-comments";

  const supabase = await createClient();
  const [commentsResult, scoresResult, specialtyResult] = await Promise.all([
    supabase
      .from("owner_report_missing_comments")
      .select("*")
      .order("school_name")
      .order("adjudicator_name")
      .order("category_title")
      .limit(2500),
    supabase
      .from("owner_report_missing_scores")
      .select("*")
      .order("school_name")
      .order("adjudicator_name")
      .order("category_title")
      .limit(2500),
    supabase
      .from("owner_report_specialty_awards")
      .select("*")
      .order("school_name")
      .order("award_type")
      .order("advisory_member_name")
      .limit(2500),
  ]);

  for (const result of [commentsResult, scoresResult, specialtyResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const comments = (commentsResult.data ?? []) as MissingRow[];
  const scores = (scoresResult.data ?? []) as MissingRow[];
  const specialty = (specialtyResult.data ?? []) as SpecialtyRow[];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Owner administration</span>
          <h1>Reports</h1>
          <p>
            Find incomplete panel work and review Advisory Committee specialty
            award recommendations.
          </p>
        </div>
      </div>

      <section className="metric-grid report-metric-grid">
        <article className="metric-card">
          <span className="metric-label">Comments missing</span>
          <strong className="metric-value">{comments.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Scores missing</span>
          <strong className="metric-value">{scores.length}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Award responses</span>
          <strong className="metric-value">{specialty.length}</strong>
        </article>
      </section>

      <nav className="admin-workspace-tabs report-tabs" aria-label="Reports">
        <Link
          className={selected === "missing-comments" ? "is-active" : ""}
          href={reportHref("missing-comments")}
        >
          Comments missing
          <span>{comments.length}</span>
        </Link>
        <Link
          className={selected === "missing-scores" ? "is-active" : ""}
          href={reportHref("missing-scores")}
        >
          Scores missing
          <span>{scores.length}</span>
        </Link>
        <Link
          className={selected === "specialty-awards" ? "is-active" : ""}
          href={reportHref("specialty-awards")}
        >
          Specialty awards
          <span>{specialty.length}</span>
        </Link>
      </nav>

      {selected === "specialty-awards" ? (
        <SpecialtyReport rows={specialty} />
      ) : (
        <MissingWorkReport
          report={selected}
          rows={selected === "missing-scores" ? scores : comments}
        />
      )}
    </>
  );
}

function MissingWorkReport({
  report,
  rows,
}: {
  report: "missing-comments" | "missing-scores";
  rows: MissingRow[];
}) {
  return (
    <section className="panel report-panel">
      <div className="panel-header">
        <div>
          <h2>
            {report === "missing-scores"
              ? "Missing criterion scores"
              : "Missing criterion comments"}
          </h2>
          <p>
            Each row identifies the school, panel member, category, and exact
            criterion requiring completion.
          </p>
        </div>
        <a
          className="button button-secondary"
          href={`/api/admin/reports/${report}`}
        >
          Download CSV
        </a>
      </div>

      <div className="table-wrap report-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>School</th>
              <th>Panel member</th>
              <th>Category</th>
              <th>Criterion</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.application_id}-${row.adjudicator_email}-${row.category_title}-${row.criterion_title}-${index}`}
              >
                <td>
                  <strong>{row.school_name}</strong>
                  <small>{row.production_title ?? "Untitled production"}</small>
                </td>
                <td>
                  <strong>{row.adjudicator_name}</strong>
                  <small>{row.adjudicator_email ?? "No email"}</small>
                </td>
                <td>{row.category_title}</td>
                <td>{row.criterion_title}</td>
                <td>
                  <span className="badge">
                    {title(row.scorecard_status)}
                  </span>
                </td>
                <td>
                  <Link
                    className="button button-secondary button-compact"
                    href={`/portal/adjudication/${row.application_id}`}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="empty-state">
            <h3>Everything is complete</h3>
            <p>No missing items were found in active applications.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SpecialtyReport({ rows }: { rows: SpecialtyRow[] }) {
  return (
    <section className="panel report-panel">
      <div className="panel-header">
        <div>
          <h2>Specialty award recommendations</h2>
          <p>
            Review individual Advisory Committee recommendations and export the
            complete internal report.
          </p>
        </div>
        <Link
          className="button button-secondary"
          href="/api/admin/reports/specialty-awards"
          prefetch={false}
        >
          Download CSV
        </Link>
      </div>

      <div className="table-wrap report-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>School</th>
              <th>Award</th>
              <th>Advisory member</th>
              <th>Song</th>
              <th>Why</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.application_id}-${row.award_type}-${row.advisory_member_name}-${index}`}
              >
                <td>
                  <strong>{row.school_name}</strong>
                  <small>{row.production_title ?? "Untitled production"}</small>
                </td>
                <td>
                  <strong>{title(row.award_type)}</strong>
                  <small>{title(row.recommendation_status)}</small>
                </td>
                <td>{row.advisory_member_name}</td>
                <td>{row.song_title ?? "—"}</td>
                <td className="report-explanation-cell">
                  {row.explanation ?? "—"}
                </td>
                <td>
                  <span className="badge">{title(row.status)}</span>
                </td>
                <td>
                  <Link
                    className="button button-secondary button-compact"
                    href={`/portal/adjudication/${row.application_id}`}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="empty-state">
            <h3>No specialty award responses yet</h3>
            <p>
              Recommendations will appear after assigned Advisory Committee
              members save their review.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
