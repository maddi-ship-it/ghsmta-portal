import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy policy for the Georgia High School Musical Theatre Awards Portal, including its text messaging program.",
};

export default function PrivacyPage() {
  return (
    <main className="public-policy-page safe-shell">
      <article className="public-policy-card">
        <Link className="regal-brand policy-brand" href="/">
          <span className="regal-brand-mark">G</span>
          <span>
            <strong>GHSMTA</strong>
            <small>Awards Portal</small>
          </span>
        </Link>

        <p className="eyebrow">Privacy policy</p>
        <h1>How we protect and use portal information</h1>
        <p className="policy-effective-date">
          Effective and last updated October 17, 2026
        </p>

        <p>
          ArtsBridge Foundation operates the Georgia High School Musical
          Theatre Awards (&quot;GHSMTA&quot;) Awards Portal. This Privacy Policy
          explains how information is collected, used, disclosed, and
          protected when you use the portal, its communications, and related
          program services.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account and contact information:</strong> name, email
            address, mobile number, school or organization, role, and account
            security information.
          </li>
          <li>
            <strong>Program information:</strong> applications, scheduling,
            eligibility, student and production information, nominations,
            adjudication materials, scores, comments, appeals, and results.
          </li>
          <li>
            <strong>Portal content:</strong> chat messages, uploaded files,
            feedback requests, support history, and related audit records.
          </li>
          <li>
            <strong>Billing records:</strong> invoices, scholarship
            confirmations, payment status, receipts, and delivery history.
            Payment card details are handled by the linked payment provider
            and are not collected by this portal.
          </li>
          <li>
            <strong>Technical information:</strong> browser, device, screen
            size, page location, timestamps, security events, and diagnostic
            information needed to secure and support the portal.
          </li>
        </ul>

        <h2>How we use information</h2>
        <p>We use portal information to:</p>
        <ul>
          <li>operate GHSMTA applications, scheduling, and adjudication;</li>
          <li>manage accounts, permissions, security, and authentication;</li>
          <li>communicate program, school, panel, and portal updates;</li>
          <li>review eligibility, appeals, billing, and program participation;</li>
          <li>provide support, investigate problems, and improve the portal;</li>
          <li>protect students, users, ArtsBridge Foundation, and the program;</li>
          <li>comply with legal, contractual, and recordkeeping obligations.</li>
        </ul>

        <h2 id="text-messaging">Text messaging and mobile information</h2>
        <p>
          When you provide and verify a mobile number, GHSMTA may use it for
          one-time verification codes, account security, account recovery, and
          time-sensitive program or chat alerts. Message frequency varies.
          Message and data rates may apply. See our{" "}
          <Link href="/terms#text-messaging">Text Messaging Terms</Link> for
          complete program details, including STOP and HELP instructions.
        </p>
        <p className="policy-emphasis">
          Mobile information, text messaging originator opt-in data, and
          consent will not be sold, rented, or shared with third parties or
          affiliates for their marketing or promotional purposes.
        </p>
        <p>
          We may provide mobile information to service providers, including
          messaging and authentication providers, solely as necessary to
          deliver and support requested portal communications. Those providers
          may not use it for their own marketing. We may also disclose
          information when required by law or necessary to protect safety and
          security.
        </p>

        <h2>Voice dictation, scans, and assisted writing</h2>
        <p>
          When you choose Dictate, Scan notes, or another assisted-writing
          feature, the selected audio, image, or text is sent to the portal&apos;s
          configured processing provider to create editable text. The portal
          does not save the source audio or image from these tools. Review
          generated text before inserting it, and do not submit information
          unrelated to GHSMTA work.
        </p>

        <h2>How information is shared</h2>
        <p>We may share information only as reasonably necessary with:</p>
        <ul>
          <li>
            authorized school representatives, assigned panel members,
            advisory members, program managers, and portal owners according to
            their role and program relationship;
          </li>
          <li>
            vendors that host, secure, authenticate, process, or deliver portal
            services under appropriate restrictions;
          </li>
          <li>
            legal authorities or other parties when required by law, to address
            fraud or security, or to protect rights and safety.
          </li>
        </ul>
        <p>
          We do not sell personal information. We do not use information about
          students or portal users for third-party behavioral advertising.
        </p>

        <h2>Information involving minors</h2>
        <p>
          The GHSMTA program concerns high school productions and may include
          information about students. School representatives and other users
          must submit student information only when authorized to do so and
          must follow applicable school, district, parent or guardian, and
          program requirements. The portal is not intended for a child to
          create an account without appropriate authorization.
        </p>

        <h2>Security and retention</h2>
        <p>
          We use role-based access, authentication controls, private storage,
          encryption in transit, logging, and other safeguards appropriate to
          the portal. No system can guarantee absolute security. Records are
          retained for as long as reasonably necessary to operate the program,
          meet legal and financial obligations, resolve disputes, and preserve
          appropriate program history. Access is removed or restricted when it
          is no longer needed.
        </p>

        <h2>Your choices and requests</h2>
        <p>
          You may update account information and routine notification choices
          from your portal account. You may reply <strong>STOP</strong> to an
          eligible GHSMTA text message to opt out of further messages from that
          messaging program. Reply <strong>HELP</strong> for help. You may also
          contact us to request access, correction, or appropriate deletion of
          personal information. Some records may need to be retained for legal,
          security, financial, or program-integrity reasons.
        </p>

        <h2>External services and links</h2>
        <p>
          The portal may link to payment, document-signing, application, or
          other external services. Their privacy practices are governed by
          their own policies. This policy applies only to information handled
          by ArtsBridge Foundation through the GHSMTA Awards Portal.
        </p>

        <h2>Policy updates</h2>
        <p>
          We may update this policy as the portal or legal requirements change.
          The revised policy will be posted here with a new effective date.
          Material changes may also be communicated through the portal or by
          another appropriate method.
        </p>

        <h2>Contact us</h2>
        <address className="policy-address">
          <strong>ArtsBridge Foundation — GHSMTA</strong>
          <br />
          2800 Cobb Galleria Parkway
          <br />
          Atlanta, Georgia 30339
          <br />
          <a href="mailto:elenhart@artsbridgega.org">
            elenhart@artsbridgega.org
          </a>
          <br />
          <a href="tel:+17709162808">770-916-2808</a>
        </address>

        <nav className="policy-links" aria-label="Legal pages">
          <Link href="/terms">Terms &amp; Conditions</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/">Return home</Link>
        </nav>
      </article>
    </main>
  );
}
