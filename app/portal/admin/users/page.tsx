import { requireProfile } from "@/lib/auth";
import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

import { bulkUpdateUsers, forcePasswordReset, updateUserAccess } from "./actions";
import { startApplicantImpersonation } from "@/app/portal/impersonation/actions";

type UserSort = "name" | "email" | "role" | "status";
type Direction = "asc" | "desc";
type SchoolTeamMembership = {
  applicationId: string;
  schoolName: string;
  productionTitle: string | null;
  applicationArchived: boolean;
  memberRole: "primary" | "collaborator";
  canEditApplication: boolean;
  active: boolean;
};
type UserProfileRow = Profile & {
  schoolTeams: SchoolTeamMembership[];
};
type ApplicationMemberRow = {
  user_id: string;
  member_role: "primary" | "collaborator";
  can_edit_application: boolean;
  active: boolean;
  applications:
    | {
        id: string;
        school_name: string | null;
        production_title: string | null;
        is_archived: boolean | null;
      }
    | {
        id: string;
        school_name: string | null;
        production_title: string | null;
        is_archived: boolean | null;
      }[]
    | null;
};

type SearchParams = {
  q?: string;
  role?: string;
  status?: string;
  sort?: UserSort;
  direction?: Direction;
  updated?: string;
  reset_sent?: string;
  impersonation_ended?: string;
};

function compare(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function teamAccessLabel(team: SchoolTeamMembership) {
  if (team.memberRole === "primary") return "Primary";
  return team.canEditApplication ? "Sub-user · Editor" : "Sub-user · View only";
}

function teamStatusLabel(team: SchoolTeamMembership) {
  const labels = [teamAccessLabel(team)];
  if (!team.active) labels.push("removed");
  if (team.applicationArchived) labels.push("archived");
  return labels.join(" · ");
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const owner = await requireProfile(["owner"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,preferred_name,phone_e164,phone_verified_at,role,active,mfa_required,mfa_grace_until,force_password_reset,password_reset_requested_at"),
    supabase
      .from("application_members")
      .select("user_id,member_role,can_edit_application,active,applications!application_members_application_id_fkey(id,school_name,production_title,is_archived)"),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (membershipResult.error) throw new Error(membershipResult.error.message);

  const schoolTeamsByUserId = new Map<string, SchoolTeamMembership[]>();

  for (const row of (membershipResult.data ?? []) as ApplicationMemberRow[]) {
    const application = Array.isArray(row.applications)
      ? row.applications[0]
      : row.applications;

    if (!application) continue;

    const memberships = schoolTeamsByUserId.get(row.user_id) ?? [];
    memberships.push({
      applicationId: application.id,
      schoolName: application.school_name ?? "Unnamed school",
      productionTitle: application.production_title,
      applicationArchived: Boolean(application.is_archived),
      memberRole: row.member_role,
      canEditApplication: row.can_edit_application,
      active: row.active,
    });
    schoolTeamsByUserId.set(row.user_id, memberships);
  }

  for (const memberships of schoolTeamsByUserId.values()) {
    memberships.sort((left, right) => {
      if (left.active !== right.active) return Number(right.active) - Number(left.active);
      if (left.memberRole !== right.memberRole) return left.memberRole === "primary" ? -1 : 1;
      return compare(left.schoolName, right.schoolName);
    });
  }

  const search = params.q?.trim().toLowerCase() ?? "";
  const selectedRole = params.role ?? "";
  const selectedStatus = params.status ?? "";
  const sort = params.sort ?? "name";
  const direction = params.direction ?? "asc";

  const profiles = ((profileResult.data ?? []) as Profile[])
    .map((profile): UserProfileRow => ({
      ...profile,
      schoolTeams: schoolTeamsByUserId.get(profile.id) ?? [],
    }))
    .filter((profile) => {
      const schoolSearchText = profile.schoolTeams
        .map((team) => `${team.schoolName} ${team.productionTitle ?? ""} ${teamStatusLabel(team)}`)
        .join(" ");
      if (search && !`${profile.full_name ?? ""} ${profile.email ?? ""} ${schoolSearchText}`.toLowerCase().includes(search)) return false;
      if (selectedRole && profile.role !== selectedRole) return false;
      if (selectedStatus === "active" && !profile.active) return false;
      if (selectedStatus === "inactive" && profile.active) return false;
      if (selectedStatus === "reset" && !profile.force_password_reset) return false;
      return true;
    })
    .sort((left, right) => {
      let result = 0;
      if (sort === "email") result = compare(left.email, right.email);
      else if (sort === "role") result = compare(left.role, right.role);
      else if (sort === "status") result = Number(left.active) - Number(right.active);
      else result = compare(left.full_name ?? left.email, right.full_name ?? right.email);
      return direction === "desc" ? -result : result;
    });

  const roles: AppRole[] = [
    "applicant",
    "adjudicator",
    "advisory_member",
    "program_manager",
    "owner",
  ];

  return (
    <>
      <div className="page-heading"><div><h1>Portal users</h1><p>Search, filter, sort, and update access in bulk. Passwords remain private; Owners can only send secure reset links.</p></div></div>
      {params.updated && <div className="notice page-message">Updated {params.updated} user accounts.</div>}
      {params.reset_sent && <div className="notice page-message">Password-reset email sent and reset required at the next portal visit.</div>}
      {params.impersonation_ended && <div className="notice page-message">Applicant impersonation ended. Your Owner session has been restored.</div>}

      <section className="panel user-admin-filter-panel">
        <div className="panel-body">
          <form className="user-admin-filter-grid" method="get">
            <div className="field user-admin-search"><label htmlFor="q">Search</label><input className="input" defaultValue={params.q ?? ""} id="q" name="q" placeholder="Name or email" /></div>
            <div className="field"><label htmlFor="role">Role</label><select className="select" defaultValue={selectedRole} id="role" name="role"><option value="">All roles</option>{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></div>
            <div className="field"><label htmlFor="status">Status</label><select className="select" defaultValue={selectedStatus} id="status" name="status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="reset">Reset required</option></select></div>
            <div className="field"><label htmlFor="sort">Sort</label><select className="select" defaultValue={sort} id="sort" name="sort"><option value="name">Name</option><option value="email">Email</option><option value="role">Role</option><option value="status">Status</option></select></div>
            <div className="field"><label htmlFor="direction">Direction</label><select className="select" defaultValue={direction} id="direction" name="direction"><option value="asc">A to Z</option><option value="desc">Z to A</option></select></div>
            <button className="button button-dark" type="submit">Apply</button>
          </form>
        </div>
      </section>

      <form action={bulkUpdateUsers} className="panel user-bulk-toolbar" id="bulk-users-form">
        <div><strong>{profiles.length} users shown</strong><small>Select users in the table, then apply one action.</small></div>
        <select className="select" name="bulk_operation" required><option value="">Bulk action</option><option value="role">Change role</option><option value="activate">Activate</option><option value="deactivate">Deactivate</option></select>
        <select className="select" name="bulk_role"><option value="applicant">Applicant</option><option value="adjudicator">Adjudicator</option><option value="advisory_member">Advisory Committee</option><option value="program_manager">Program Manager</option><option value="owner">Owner</option></select>
        <button className="button button-dark button-compact" type="submit">Apply to selected</button>
      </form>

      <section className="panel"><div className="table-wrap"><table className="data-table user-admin-table user-admin-table-compact"><thead><tr><th><span className="sr-only">Select</span></th><th>Status</th><th>Name</th><th>Phone</th><th>Role</th><th>School</th><th>Email</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {profiles.map((profile) => (
          <tr key={profile.id}>
            <td><input aria-label={`Select ${profile.full_name ?? profile.email}`} form="bulk-users-form" name="user_ids" type="checkbox" value={profile.id} /></td>
            <td>
              <div className="user-status-stack">
                <span className={`badge ${profile.active ? "badge-complete" : "badge-warning"}`}>{profile.active ? "Active" : "Inactive"}</span>
                {profile.force_password_reset && <span className="badge badge-warning">Reset required</span>}
                {profile.mfa_required && <span className="badge">MFA</span>}
              </div>
            </td>
            <td>
              <div className="user-name-cell">
                <strong>{profile.full_name ?? "Unnamed user"}</strong>
                {profile.preferred_name && <small>Preferred: {profile.preferred_name}</small>}
              </div>
            </td>
            <td>
              <div className="user-phone-cell">
                <span>{profile.phone_e164 ?? "Not entered"}</span>
                <small>{profile.phone_e164 ? profile.phone_verified_at ? "Verified" : "Unverified" : "—"}</small>
              </div>
            </td>
            <td><span className="badge">{roleLabel(profile.role)}</span></td>
            <td>
              {profile.schoolTeams.length > 0 ? (
                <div className="user-school-list">
                  {profile.schoolTeams.map((team) => (
                    <span
                      className={
                        team.active && !team.applicationArchived
                          ? "user-school-chip"
                          : "user-school-chip user-school-chip-muted"
                      }
                      key={`${profile.id}-${team.applicationId}`}
                    >
                      <strong>{team.schoolName}</strong>
                      <small>{teamStatusLabel(team)}</small>
                    </span>
                  ))}
                </div>
              ) : (
                <small className="muted-text">No school team</small>
              )}
            </td>
            <td><span className="user-email-cell">{profile.email ?? "No email"}</span></td>
            <td>
              <div className="user-row-action-stack">
              {profile.role === "applicant" &&
              profile.active &&
              profile.email &&
              !profile.force_password_reset &&
              profile.id !== owner.id ? (
                <form action={startApplicantImpersonation.bind(null, profile.id)}>
                  <ConfirmedSubmitButton
                    className="button button-secondary button-compact"
                    description={`This will temporarily open the portal as ${profile.full_name ?? profile.email}. Your Owner session will be restored when you end impersonation.`}
                    label="View as"
                    reasonLabel="Support reason"
                    reasonName="impersonation_reason"
                    reasonPlaceholder="Example: verifying applicant messaging access"
                    requireReason
                    title="View as this applicant?"
                  />
                </form>
              ) : (
                <small>Applicant only</small>
              )}

                <details className="user-edit-details">
                  <summary>Edit user</summary>
                  <div className="user-edit-panel">
                    <form action={updateUserAccess.bind(null, profile.id)} className="user-edit-form">
                      <div className="field">
                        <label htmlFor={`phone-${profile.id}`}>Phone</label>
                        <input className="input input-compact" id={`phone-${profile.id}`} name="phone_e164" defaultValue={profile.phone_e164 ?? ""} placeholder="+14045551234" />
                      </div>
                      <div className="field">
                        <label htmlFor={`role-${profile.id}`}>Role</label>
                        <select className="select" defaultValue={profile.role} id={`role-${profile.id}`} name="role">{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select>
                      </div>
                      <label className="inline-check"><input defaultChecked={profile.active} name="active" type="checkbox" /> Active</label>
                      <label className="inline-check"><input defaultChecked={profile.mfa_required} name="mfa_required" type="checkbox" /> Require MFA</label>
                      <button className="button button-secondary button-compact" type="submit">Save user</button>
                    </form>
                    <form action={forcePasswordReset.bind(null, profile.id)}><button className="text-button" type="submit">Force password reset</button></form>
                  </div>
                </details>
              </div>
            </td>
          </tr>
        ))}
        {profiles.length === 0 && <tr><td colSpan={8}>No users match these filters.</td></tr>}
      </tbody></table></div></section>
    </>
  );
}
