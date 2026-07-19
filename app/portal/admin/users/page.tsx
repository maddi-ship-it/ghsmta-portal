import { requireProfile } from "@/lib/auth";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

import { bulkUpdateUsers, forcePasswordReset, updateUserAccess } from "./actions";

type UserSort = "name" | "email" | "role" | "status";
type Direction = "asc" | "desc";

type SearchParams = {
  q?: string;
  role?: string;
  status?: string;
  sort?: UserSort;
  direction?: Direction;
  updated?: string;
  reset_sent?: string;
};

function compare(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,preferred_name,phone_e164,phone_verified_at,role,active,mfa_required,mfa_grace_until,force_password_reset,password_reset_requested_at");

  if (error) throw new Error(error.message);

  const search = params.q?.trim().toLowerCase() ?? "";
  const selectedRole = params.role ?? "";
  const selectedStatus = params.status ?? "";
  const sort = params.sort ?? "name";
  const direction = params.direction ?? "asc";

  const profiles = ((data ?? []) as Profile[])
    .filter((profile) => {
      if (search && !`${profile.full_name ?? ""} ${profile.email ?? ""}`.toLowerCase().includes(search)) return false;
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

  const roles: AppRole[] = ["applicant", "adjudicator", "advisory_member", "owner"];

  return (
    <>
      <div className="page-heading"><div><h1>Portal users</h1><p>Search, filter, sort, and update access in bulk. Passwords remain private; Owners can only send secure reset links.</p></div></div>
      {params.updated && <div className="notice page-message">Updated {params.updated} user accounts.</div>}
      {params.reset_sent && <div className="notice page-message">Password-reset email sent and reset required at the next portal visit.</div>}

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
        <select className="select" name="bulk_role"><option value="applicant">Applicant</option><option value="adjudicator">Adjudicator</option><option value="advisory_member">Advisory Committee</option><option value="owner">Owner</option></select>
        <button className="button button-dark button-compact" type="submit">Apply to selected</button>
      </form>

      <section className="panel"><div className="table-wrap"><table className="data-table user-admin-table"><thead><tr><th><span className="sr-only">Select</span></th><th>User</th><th>Email</th><th>Mobile</th><th>Role</th><th>Status</th><th>Password</th><th>Change access</th></tr></thead><tbody>
        {profiles.map((profile) => (
          <tr key={profile.id}>
            <td><input aria-label={`Select ${profile.full_name ?? profile.email}`} form="bulk-users-form" name="user_ids" type="checkbox" value={profile.id} /></td>
            <td><strong>{profile.full_name ?? "Unnamed user"}</strong></td>
            <td>{profile.email}</td>
            <td><span>{profile.phone_e164 ?? "Not entered"}</span><small>{profile.phone_verified_at ? "Verified" : "Unverified"}</small></td>
            <td><span className="badge">{roleLabel(profile.role)}</span></td>
            <td><span className={`badge ${profile.active ? "badge-complete" : "badge-warning"}`}>{profile.active ? "Active" : "Inactive"}</span></td>
            <td>{profile.force_password_reset ? <span className="badge badge-warning">Reset required</span> : "Current"}</td>
            <td>
              <div className="user-row-actions">
                <form action={updateUserAccess.bind(null, profile.id)} className="user-inline-access-form">
                  <input className="input input-compact" name="phone_e164" defaultValue={profile.phone_e164 ?? ""} placeholder="+14045551234" aria-label="Mobile number" />
                  <select className="select" defaultValue={profile.role} name="role">{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select>
                  <label className="inline-check"><input defaultChecked={profile.active} name="active" type="checkbox" /> Active</label>
                  <label className="inline-check"><input defaultChecked={profile.mfa_required} name="mfa_required" type="checkbox" /> Require MFA</label>
                  <button className="button button-secondary button-compact" type="submit">Save</button>
                </form>
                <form action={forcePasswordReset.bind(null, profile.id)}><button className="text-button" type="submit">Force reset</button></form>
              </div>
            </td>
          </tr>
        ))}
        {profiles.length === 0 && <tr><td colSpan={8}>No users match these filters.</td></tr>}
      </tbody></table></div></section>
    </>
  );
}
