import {
  inviteSchoolTeamMember,
  removeSchoolTeamMember,
  resendSchoolTeamInvite,
  updateSchoolTeamMemberAccess,
} from "@/app/portal/school-team/actions";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TeamWorkspaceRow = {
  application_id: string;
  school_name: string;
  production_title: string | null;
  application_archived: boolean;
  user_id: string;
  display_name: string;
  email: string | null;
  member_role: "primary" | "collaborator";
  can_edit_application: boolean;
  can_manage_members: boolean;
  member_active: boolean;
  joined_at: string;
  current_user_can_manage: boolean;
};

type SearchParams = {
  invited?: string;
  removed?: string;
  resent?: string;
  updated?: string;
};

function groupByApplication(rows: TeamWorkspaceRow[]) {
  const grouped = new Map<
    string,
    {
      applicationId: string;
      schoolName: string;
      productionTitle: string | null;
      archived: boolean;
      canManage: boolean;
      members: TeamWorkspaceRow[];
    }
  >();

  for (const row of rows) {
    const existing = grouped.get(row.application_id);
    if (existing) {
      existing.members.push(row);
      continue;
    }

    grouped.set(row.application_id, {
      applicationId: row.application_id,
      schoolName: row.school_name,
      productionTitle: row.production_title,
      archived: row.application_archived,
      canManage: row.current_user_can_manage,
      members: [row],
    });
  }

  return [...grouped.values()];
}

export default async function SchoolTeamPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireProfile(["applicant"]);
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_school_team_workspace");

  if (error) {
    throw new Error(error.message);
  }

  const applications = groupByApplication(
    ((data ?? []) as TeamWorkspaceRow[]).filter(
      (row) => !row.application_archived,
    ),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shared school account</span>
          <h1>School team</h1>
          <p>
            Invite additional school contacts to share the application, private
            School Messaging, scheduling details, appeals, and released results.
          </p>
        </div>
      </div>

      {params.invited && (
        <div className="notice page-message">
          {params.invited} was added and sent a secure access link.
        </div>
      )}
      {params.removed && (
        <div className="notice page-message">
          {params.removed} was removed from the school account.
        </div>
      )}
      {params.resent && (
        <div className="notice page-message">
          A new access link was sent to {params.resent}.
        </div>
      )}
      {params.updated && (
        <div className="notice page-message">Team member access was updated.</div>
      )}

      {applications.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <h2>No school applications are linked to this account.</h2>
            <p>
              Once your account is connected to an application, its school team
              will appear here.
            </p>
          </div>
        </section>
      ) : (
        <div className="school-team-stack">
          {applications.map((application) => {
            const activeMembers = application.members.filter(
              (member) => member.member_active,
            );
            const removedMembers = application.members.filter(
              (member) => !member.member_active,
            );

            return (
              <section className="panel school-team-panel" key={application.applicationId}>
                <div className="panel-header school-team-heading">
                  <div>
                    <span className="eyebrow">
                      {application.archived ? "Archived application" : "School account"}
                    </span>
                    <h2>{application.schoolName}</h2>
                    <p>{application.productionTitle ?? "Production title not entered"}</p>
                  </div>
                  <span className="badge">
                    {activeMembers.length} active {activeMembers.length === 1 ? "user" : "users"}
                  </span>
                </div>

                <div className="panel-body school-team-body">
                  <div className="school-team-member-list">
                    {activeMembers.map((member) => (
                      <article className="school-team-member" key={member.user_id}>
                        <div className="school-team-member-avatar" aria-hidden="true">
                          {member.display_name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="school-team-member-copy">
                          <div className="school-team-member-title">
                            <strong>{member.display_name}</strong>
                            <span>
                              {member.member_role === "primary"
                                ? "Primary account"
                                : member.can_edit_application
                                  ? "Editor"
                                  : "View only"}
                            </span>
                          </div>
                          <p>{member.email ?? "No email address"}</p>
                          <small>
                            Added {new Date(member.joined_at).toLocaleDateString()}
                          </small>
                        </div>

                        {application.canManage && member.member_role !== "primary" && (
                          <div className="school-team-member-actions">
                            <form action={updateSchoolTeamMemberAccess}>
                              <input
                                name="application_id"
                                type="hidden"
                                value={application.applicationId}
                              />
                              <input name="user_id" type="hidden" value={member.user_id} />
                              <label className="check-row school-team-edit-toggle">
                                <input
                                  defaultChecked={member.can_edit_application}
                                  name="can_edit_application"
                                  type="checkbox"
                                />
                                Can edit application
                              </label>
                              <button
                                className="button button-secondary button-compact"
                                type="submit"
                              >
                                Save access
                              </button>
                            </form>

                            <form action={resendSchoolTeamInvite}>
                              <input
                                name="application_id"
                                type="hidden"
                                value={application.applicationId}
                              />
                              <input name="user_id" type="hidden" value={member.user_id} />
                              <button
                                className="button button-secondary button-compact"
                                type="submit"
                              >
                                Resend access link
                              </button>
                            </form>

                            <form action={removeSchoolTeamMember}>
                              <input
                                name="application_id"
                                type="hidden"
                                value={application.applicationId}
                              />
                              <input name="user_id" type="hidden" value={member.user_id} />
                              <button
                                className="button button-secondary button-compact danger-button"
                                type="submit"
                              >
                                Remove
                              </button>
                            </form>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>

                  {application.canManage && !application.archived && (
                    <form action={inviteSchoolTeamMember} className="school-team-invite-form">
                      <div>
                        <span className="eyebrow">Add a sub-user</span>
                        <h3>Invite another school contact</h3>
                        <p>
                          They receive their own login and join this application&apos;s
                          private School Messaging. You can make them an editor or view-only.
                        </p>
                      </div>

                      <input
                        name="application_id"
                        type="hidden"
                        value={application.applicationId}
                      />

                      <div className="school-team-invite-grid">
                        <div className="field">
                          <label htmlFor={`full-name-${application.applicationId}`}>
                            Full name
                          </label>
                          <input
                            className="input"
                            id={`full-name-${application.applicationId}`}
                            name="full_name"
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`email-${application.applicationId}`}>
                            Email address
                          </label>
                          <input
                            className="input"
                            id={`email-${application.applicationId}`}
                            name="email"
                            required
                            type="email"
                          />
                        </div>
                      </div>

                      <label className="check-row">
                        <input defaultChecked name="can_edit_application" type="checkbox" />
                        Allow this user to edit draft application answers and school
                        schedule details
                      </label>

                      <button className="button button-dark" type="submit">
                        Add user and send invite
                      </button>
                    </form>
                  )}

                  {removedMembers.length > 0 && (
                    <details className="school-team-removed">
                      <summary>Show {removedMembers.length} removed team member{removedMembers.length === 1 ? "" : "s"}</summary>
                      <div>
                        {removedMembers.map((member) => (
                          <p key={member.user_id}>
                            <strong>{member.display_name}</strong>
                            {member.email ? ` · ${member.email}` : ""}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
