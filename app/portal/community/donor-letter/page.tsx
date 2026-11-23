import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DonorLetterRequest = {
  id: string;
  requested_by: string;
  letter_date: string;
  recipient_name: string;
  recipient_title: string;
  company_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  created_at: string;
};

type RequesterProfile = {
  id: string;
  full_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

function easternToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatStoredDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function CommunityDonorLetterPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("community_donor_letter_requests")
    .select(
      "id,requested_by,letter_date,recipient_name,recipient_title,company_name,address,city,state,zip,created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const requests = (data ?? []) as DonorLetterRequest[];

  const requesterMap = new Map<string, RequesterProfile>();
  if (profile.role === "owner" && requests.length) {
    const requesterIds = [...new Set(requests.map((request) => request.requested_by))];
    const admin = createAdminClient();
    const { data: requesterData, error: requesterError } = await admin
      .from("profiles")
      .select("id,full_name,preferred_name,email")
      .in("id", requesterIds);
    if (requesterError) throw new Error(requesterError.message);
    for (const requester of (requesterData ?? []) as RequesterProfile[]) {
      requesterMap.set(requester.id, requester);
    }
  }

  return (
    <div className="page-stack donor-letter-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Community</span>
          <h1>Create a donor letter</h1>
          <p>
            Personalize the GHSMTA Lasting Legacy Campaign letter for a prospective
            corporate partner, then download a ready-to-send PDF.
          </p>
        </div>
      </header>

      <div className="donor-letter-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Recipient details</span>
              <h2>Complete the letter</h2>
              <p>Every bracketed field in the approved template is completed from this form.</p>
            </div>
          </div>
          <form action="/api/community/donor-letter" className="panel-body donor-letter-form" method="post">
            <div className="donor-letter-form-grid">
              <div className="field">
                <label htmlFor="letter_date">Letter date</label>
                <input className="input" defaultValue={easternToday()} id="letter_date" name="letter_date" required type="date" />
              </div>
              <div className="field">
                <label htmlFor="recipient_name">Recipient name</label>
                <input autoComplete="name" className="input" id="recipient_name" maxLength={100} name="recipient_name" placeholder="Jordan Smith" required />
              </div>
              <div className="field">
                <label htmlFor="recipient_title">Recipient title</label>
                <input autoComplete="organization-title" className="input" id="recipient_title" maxLength={100} name="recipient_title" placeholder="Community Relations Director" required />
              </div>
              <div className="field">
                <label htmlFor="company_name">Company name</label>
                <input autoComplete="organization" className="input" id="company_name" maxLength={120} name="company_name" placeholder="Company or foundation" required />
                <small>This name is automatically repeated throughout the letter.</small>
              </div>
              <div className="field donor-letter-field-wide">
                <label htmlFor="address">Street address</label>
                <input autoComplete="street-address" className="input" id="address" maxLength={160} name="address" placeholder="123 Peachtree Street NE" required />
              </div>
              <div className="field">
                <label htmlFor="city">City</label>
                <input autoComplete="address-level2" className="input" id="city" maxLength={80} name="city" placeholder="Atlanta" required />
              </div>
              <div className="field">
                <label htmlFor="state">State</label>
                <input autoComplete="address-level1" className="input" id="state" maxLength={30} name="state" placeholder="GA" required />
              </div>
              <div className="field">
                <label htmlFor="zip">ZIP code</label>
                <input autoComplete="postal-code" className="input" id="zip" maxLength={15} name="zip" placeholder="30339" required />
              </div>
            </div>

            <div className="donor-letter-form-actions">
              <div>
                <strong>Your request is saved securely.</strong>
                <small>You can re-download it later, and GHSMTA Owners can view every request.</small>
              </div>
              <button className="button button-primary" type="submit">Generate donor letter PDF</button>
            </div>
          </form>
        </section>

        <aside className="panel donor-letter-guide">
          <div className="panel-header">
            <div>
              <span className="eyebrow">What you receive</span>
              <h2>Ready to send</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="donor-letter-guide-mark" aria-hidden="true">✉</div>
            <h3>Approved Lasting Legacy letter</h3>
            <p>The downloaded PDF keeps the ArtsBridge and GHSMTA branding, campaign language, signatures, and formatting from the approved template.</p>
            <ul>
              <li>Recipient name appears in the address and greeting.</li>
              <li>Company name is inserted in every campaign reference.</li>
              <li>The PDF is ready to email or print.</li>
            </ul>
          </div>
        </aside>
      </div>

      <section className="panel donor-letter-history">
        <div className="panel-header">
          <div>
            <span className="eyebrow">
              {profile.role === "owner" ? "Owner view" : "Your history"}
            </span>
            <h2>
              {profile.role === "owner" ? "All donor letter requests" : "Your donor letter requests"}
            </h2>
            <p>
              {profile.role === "owner"
                ? "Review every letter requested through the portal and download a fresh copy at any time."
                : "Download a fresh copy of any donor letter you have created."}
            </p>
          </div>
          <span className="badge">{requests.length} total</span>
        </div>

        <div className="panel-body donor-letter-request-list">
          {requests.length ? (
            requests.map((letterRequest) => {
              const requester = requesterMap.get(letterRequest.requested_by);
              const requesterName =
                requester?.preferred_name ??
                requester?.full_name ??
                requester?.email ??
                "Portal user";

              return (
                <article className="donor-letter-request-card" key={letterRequest.id}>
                  <div className="donor-letter-request-main">
                    <div>
                      <span className="eyebrow">{formatStoredDate(letterRequest.letter_date)}</span>
                      <h3>{letterRequest.company_name}</h3>
                      <p>{letterRequest.recipient_name} · {letterRequest.recipient_title}</p>
                    </div>
                    <a
                      className="button button-secondary"
                      href={`/api/community/donor-letter?request=${letterRequest.id}`}
                    >
                      Download PDF
                    </a>
                  </div>

                  <div className="donor-letter-request-meta">
                    {profile.role === "owner" ? (
                      <span><strong>Requested by:</strong> {requesterName}</span>
                    ) : null}
                    <span><strong>Created:</strong> {formatCreatedAt(letterRequest.created_at)}</span>
                    <span>
                      <strong>Recipient address:</strong>{" "}
                      {letterRequest.address}, {letterRequest.city}, {letterRequest.state} {letterRequest.zip}
                    </span>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state donor-letter-empty-state">
              <strong>No donor letters have been requested yet.</strong>
              <p>Completed requests will appear here after their PDFs are generated.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
