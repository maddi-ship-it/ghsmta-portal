import { requireProfile } from "@/lib/auth";

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

export default async function CommunityDonorLetterPage() {
  await requireProfile();

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
                <strong>Your recipient information is not saved.</strong>
                <small>It is used only to create the PDF download.</small>
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
    </div>
  );
}
