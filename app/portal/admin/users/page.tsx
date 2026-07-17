import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { updateUserRole } from "./actions";

export default async function UsersPage() {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id,email,full_name,role,active").order("full_name");
  const profiles = (data ?? []) as Profile[];

  return (
    <>
      <div className="page-heading"><div><h1>Portal users</h1><p>Assign access levels. Supabase RLS applies each role to every database request.</p></div></div>
      <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Email</th><th>Current role</th><th>Change access</th></tr></thead><tbody>
        {profiles.map((profile) => (
          <tr key={profile.id}>
            <td><strong>{profile.full_name ?? "Unnamed user"}</strong></td>
            <td>{profile.email}</td>
            <td><span className="badge">{roleLabel(profile.role)}</span></td>
            <td><form action={updateUserRole.bind(null, profile.id)} style={{ display: "flex", gap: 8 }}><select className="select" name="role" defaultValue={profile.role} style={{ minHeight: 38, width: 190 }}><option value="applicant">Applicant</option><option value="adjudicator">Adjudicator</option><option value="advisory_member">Advisory Member</option><option value="owner">Owner</option></select><button className="button button-dark button-compact" type="submit">Save</button></form></td>
          </tr>
        ))}
      </tbody></table></div></section>
    </>
  );
}
