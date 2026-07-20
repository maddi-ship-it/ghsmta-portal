"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveSpecialtyAwardRecommendations } from "@/app/portal/adjudication/[id]/workflow-actions";

type Recommendation = {
  id: string;
  application_id: string;
  advisory_user_id: string;
  award_type: string;
  recommendation_status: string;
  song_title: string | null;
  explanation: string | null;
  status: string;
  submitted_at: string | null;
  updated_at: string;
  advisory_member_name?: string | null;
  advisory_member_email?: string | null;
};

type AwardDefinition = {
  key: string;
  group: string;
  title: string;
  description: string;
  requiresSong: boolean;
};

const AWARDS: AwardDefinition[] = [
  {
    key: "spotlight_technical",
    group: "Spotlight",
    title: "Technical",
    description:
      "Recognize an exceptional technical, design, or production contribution.",
    requiresSong: false,
  },
  {
    key: "spotlight_performance",
    group: "Spotlight",
    title: "Performance",
    description:
      "Recognize a standout musical performance by an individual or ensemble.",
    requiresSong: true,
  },
  {
    key: "standing_ovation",
    group: "Standing Ovation",
    title: "Standing Ovation",
    description:
      "Recognize a moment, contribution, or achievement worthy of special acclaim.",
    requiresSong: false,
  },
  {
    key: "showstopper",
    group: "Showstopper",
    title: "Showstopper",
    description:
      "Recognize the musical number that most completely stopped the show.",
    requiresSong: true,
  },
];

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function SpecialtyAwardWorkspace({
  applicationId,
  currentUserId,
  role,
  recommendations,
}: {
  applicationId: string;
  currentUserId: string;
  role: "adjudicator" | "advisory_member" | "owner";
  recommendations: Recommendation[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ownRecommendations = useMemo(
    () =>
      new Map(
        recommendations
          .filter((recommendation) => recommendation.advisory_user_id === currentUserId)
          .map((recommendation) => [recommendation.award_type, recommendation]),
      ),
    [currentUserId, recommendations],
  );

  const ownerGroups = useMemo(() => {
    const groups = new Map<string, Recommendation[]>();
    for (const recommendation of recommendations) {
      const name =
        recommendation.advisory_member_name ??
        recommendation.advisory_member_email ??
        "Advisory Committee member";
      groups.set(name, [...(groups.get(name) ?? []), recommendation]);
    }
    return [...groups.entries()];
  }, [recommendations]);

  function submit(form: HTMLFormElement, shouldSubmit: boolean) {
    const formData = new FormData(form);
    formData.set("submit_recommendations", shouldSubmit ? "true" : "false");
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        await saveSpecialtyAwardRecommendations(applicationId, formData);
        setMessage(
          shouldSubmit
            ? "Specialty award recommendations submitted."
            : "Specialty award draft saved.",
        );
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not save specialty award recommendations.",
        );
      }
    });
  }

  if (role === "owner") {
    return (
      <section className="panel specialty-awards-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Advisory Committee</span>
            <h2>Specialty award recommendations</h2>
            <p>
              Recommendations are internal and are never released automatically
              to schools.
            </p>
          </div>
        </div>

        <div className="panel-body">
          {ownerGroups.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <h3>No specialty award recommendations yet</h3>
              <p>
                Recommendations will appear after assigned Advisory Committee
                members begin their review.
              </p>
            </div>
          ) : (
            <div className="specialty-owner-groups">
              {ownerGroups.map(([memberName, memberRecommendations]) => (
                <article className="specialty-owner-group" key={memberName}>
                  <div className="specialty-owner-heading">
                    <div>
                      <strong>{memberName}</strong>
                      <small>
                        {
                          memberRecommendations.filter(
                            (item) => item.status === "submitted",
                          ).length
                        }{" "}
                        submitted
                      </small>
                    </div>
                  </div>

                  <div className="specialty-summary-grid">
                    {AWARDS.map((award) => {
                      const recommendation = memberRecommendations.find(
                        (item) => item.award_type === award.key,
                      );

                      return (
                        <div className="specialty-summary-card" key={award.key}>
                          <span className="eyebrow">
                            {award.group === award.title
                              ? award.group
                              : `${award.group} · ${award.title}`}
                          </span>
                          <strong>
                            {recommendation
                              ? label(recommendation.recommendation_status)
                              : "No response"}
                          </strong>
                          {recommendation?.song_title && (
                            <p>
                              <b>Song:</b> {recommendation.song_title}
                            </p>
                          )}
                          {recommendation?.explanation && (
                            <p>{recommendation.explanation}</p>
                          )}
                          {recommendation && (
                            <small>{label(recommendation.status)}</small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (role !== "advisory_member") {
    return null;
  }

  return (
    <section className="panel specialty-awards-panel">
      <div className="panel-header specialty-panel-header">
        <div>
          <span className="eyebrow">Advisory Committee</span>
          <h2>Specialty awards</h2>
          <p>
            Record a recommendation or explicitly select no recommendation for
            each award.
          </p>
        </div>
      </div>

      <div className="panel-body">
        {(message || error) && (
          <div
            className={
              error
                ? "form-error page-message"
                : "notice-banner success-banner page-message"
            }
          >
            {error ?? message}
          </div>
        )}

        <form
          className="specialty-awards-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget, false);
          }}
        >
          <div className="specialty-action-bar">
            <div>
              <strong>Four award decisions</strong>
              <small>
                Drafts remain editable until this school is sent to Owner
                review.
              </small>
            </div>
            <div className="heading-actions">
              <button
                className="button button-secondary"
                disabled={pending}
                type="submit"
              >
                {pending ? "Saving…" : "Save draft"}
              </button>
              <button
                className="button button-gold"
                disabled={pending}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (form) {
                    event.preventDefault();
                    submit(form, true);
                  }
                }}
                type="button"
              >
                {pending ? "Saving…" : "Submit recommendations"}
              </button>
            </div>
          </div>

          <div className="specialty-awards-grid">
            {AWARDS.map((award) => {
              const recommendation = ownRecommendations.get(award.key);
              const prefix = `specialty_${award.key}`;

              return (
                <fieldset className="specialty-award-card" key={award.key}>
                  <input
                    name="award_type"
                    type="hidden"
                    value={award.key}
                  />

                  <legend>
                    <span className="eyebrow">{award.group}</span>
                    <strong>{award.title}</strong>
                  </legend>

                  <p>{award.description}</p>

                  <div className="field">
                    <label htmlFor={`${prefix}_status`}>Decision</label>
                    <select
                      className="select"
                      defaultValue={
                        recommendation?.recommendation_status ??
                        "no_recommendation"
                      }
                      id={`${prefix}_status`}
                      name={`recommendation_status_${award.key}`}
                    >
                      <option value="no_recommendation">
                        No recommendation
                      </option>
                      <option value="recommended">Recommend</option>
                    </select>
                  </div>

                  {award.requiresSong && (
                    <div className="field">
                      <label htmlFor={`${prefix}_song`}>Song</label>
                      <input
                        className="input"
                        defaultValue={recommendation?.song_title ?? ""}
                        id={`${prefix}_song`}
                        name={`song_title_${award.key}`}
                        placeholder="Enter the musical number"
                      />
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor={`${prefix}_why`}>Why</label>
                    <textarea
                      className="textarea"
                      defaultValue={recommendation?.explanation ?? ""}
                      id={`${prefix}_why`}
                      name={`explanation_${award.key}`}
                      placeholder="Explain the recommendation with specific evidence from the production."
                      rows={5}
                    />
                  </div>

                  <small className="specialty-card-status">
                    {recommendation
                      ? `${label(recommendation.status)} · Last saved ${new Date(
                          recommendation.updated_at,
                        ).toLocaleString()}`
                      : "Not started"}
                  </small>
                </fieldset>
              );
            })}
          </div>

          <div className="specialty-action-bar specialty-action-bar-bottom">
            <div>
              <strong>Ready to send these recommendations?</strong>
              <small>
                Submitting does not release them to the school.
              </small>
            </div>
            <div className="heading-actions">
              <button
                className="button button-secondary"
                disabled={pending}
                type="submit"
              >
                Save draft
              </button>
              <button
                className="button button-gold"
                disabled={pending}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (form) {
                    event.preventDefault();
                    submit(form, true);
                  }
                }}
                type="button"
              >
                Submit recommendations
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
