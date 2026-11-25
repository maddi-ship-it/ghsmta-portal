import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStudentSchoolOption } from "@/lib/student-school-options";

import { studentSignup } from "./actions";

export default async function StudentSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const admin = createAdminClient();
  const { data: schools } = await admin
    .from("schools")
    .select("id,name,city")
    .eq("active", true)
    .order("name");
  const currentYear = new Date().getFullYear();
  const studentSchools = (schools ?? []).filter((school) => isStudentSchoolOption(school.name, process.env.NODE_ENV !== "production"));

  return (
    <main className="regal-auth-shell">
      <section className="regal-auth-hero">
        <Link href="/" className="regal-brand">
          <span className="regal-brand-mark">G</span>
          <span><strong>GHSMTA</strong><small>Student Portal</small></span>
        </Link>
        <div className="regal-auth-copy">
          <p className="eyebrow">Students</p>
          <h1>Your GHSMTA experience starts here.</h1>
          <p>Create your profile, complete assigned opportunities, upload materials, and keep guardian forms together in one secure place.</p>
        </div>
      </section>

      <section className="regal-auth-panel">
        <div className="regal-auth-card">
          <p className="eyebrow">High-school students</p>
          <h2>Create student account</h2>
          <p>Your selected school must be approved by a GHSMTA Owner before your account is fully activated.</p>

          {params.error && (
            <div className="form-error">
              {params.error === "school"
                ? "Choose an active school from the directory."
                : "Please check every required field. The email may already be registered."}
            </div>
          )}

          <form action={studentSignup} className="form-stack" style={{ marginTop: 20 }}>
            <div className="field"><label htmlFor="legal_name">Legal name</label><input className="input" id="legal_name" name="legal_name" autoComplete="name" required /></div>
            <div className="field"><label htmlFor="preferred_name">Preferred name</label><input className="input" id="preferred_name" name="preferred_name" /></div>
            <div className="field"><label htmlFor="pronouns">Pronouns</label><input className="input" id="pronouns" name="pronouns" /></div>
            <div className="field"><label htmlFor="school_id">School</label><select className="select" id="school_id" name="school_id" required><option value="">Choose your school</option>{studentSchools.map((school) => <option key={school.id} value={school.id}>{school.name}{school.city ? ` — ${school.city}` : ""}</option>)}</select></div>
            <div className="field"><label htmlFor="graduation_year">Graduation year</label><select className="select" id="graduation_year" name="graduation_year" required><option value="">Choose year</option>{Array.from({ length: 9 }, (_, index) => currentYear - 1 + index).map((year) => <option key={year} value={year}>{year}</option>)}</select></div>
            <div className="field"><label htmlFor="email">Email address</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
            <div className="field"><label htmlFor="phone">Mobile number</label><input className="input" id="phone" name="phone" type="tel" autoComplete="tel" placeholder="(404) 555-1234" required /></div>
            <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /></div>
            <label className="check-row"><input name="age_confirmed" type="checkbox" required />I confirm that I am at least 13 years old and currently attend high school.</label>
            <button className="button button-gold" type="submit">Create student account</button>
          </form>

          <p className="auth-links">Already registered? <Link href="/login">Sign in</Link></p>
          <p className="auth-links">School representative? <Link href="/signup">Create an applicant account</Link></p>
          <p className="auth-links auth-privacy-link">By creating an account, you agree to the <Link href="/terms">Terms &amp; Conditions</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </section>
    </main>
  );
}
