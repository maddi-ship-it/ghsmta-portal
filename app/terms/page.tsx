import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "Terms and conditions for the Georgia High School Musical Theatre Awards Portal and its text messaging program.",
};

export default function TermsPage() {
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

        <p className="eyebrow">Terms &amp; conditions</p>
        <h1>Terms for using the GHSMTA Awards Portal</h1>
        <p className="policy-effective-date">
          Effective and last updated October 17, 2026
        </p>

        <p>
          These Terms &amp; Conditions (&quot;Terms&quot;) govern access to the
          Georgia High School Musical Theatre Awards (&quot;GHSMTA&quot;) Awards
          Portal and related communications operated by ArtsBridge Foundation.
          By creating an account or using the portal, you agree to these Terms
          and acknowledge our <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <h2>Portal purpose and eligibility</h2>
        <p>
          The portal supports GHSMTA applications, scheduling, adjudication,
          program communications, files, billing, appeals, and released
          results. You may use it only for authorized GHSMTA activities and
          only in the role assigned to you. If you submit information about a
          student or another person, you represent that you have authority and
          any required permission to do so.
        </p>

        <h2>Accounts and security</h2>
        <ul>
          <li>Provide accurate, current information and keep it updated.</li>
          <li>Keep passwords, access codes, and verification codes private.</li>
          <li>Do not share an account or impersonate another person.</li>
          <li>
            Notify GHSMTA promptly if you believe an account or confidential
            program information has been compromised.
          </li>
          <li>
            ArtsBridge Foundation may require password resets or other
            safeguards and may suspend access when reasonably necessary to
            protect the portal or program. Multi-factor authentication is
            available as an optional account-security feature.
          </li>
        </ul>

        <h2>Confidential program information</h2>
        <p>
          Applications, student information, schedules, panel assignments,
          draft scores, comments, deliberations, appeals, and unreleased
          results may be confidential. You must view and use them only for your
          assigned GHSMTA responsibilities and must not copy, publish, or share
          them outside authorized program channels.
        </p>

        <h2>Acceptable use</h2>
        <p>You may not use the portal to:</p>
        <ul>
          <li>harass, threaten, discriminate against, or exploit anyone;</li>
          <li>upload unlawful, malicious, deceptive, or infringing content;</li>
          <li>access records, accounts, or systems without authorization;</li>
          <li>interfere with security, availability, or portal operation;</li>
          <li>
            submit unnecessary highly sensitive information, including payment
            card details, government identification numbers, or medical records;
          </li>
          <li>use portal communications for advertising or unrelated activity.</li>
        </ul>

        <h2>Content you provide</h2>
        <p>
          You retain ownership of content you submit. You grant ArtsBridge
          Foundation permission to host, process, reproduce, and share that
          content within authorized GHSMTA workflows as needed to operate,
          secure, and administer the program. You are responsible for the
          accuracy and legality of submitted content.
        </p>

        <h2 id="text-messaging">GHSMTA text messaging terms</h2>
        <p>
          <strong>Program name:</strong> GHSMTA Awards Portal Alerts, operated
          by ArtsBridge Foundation.
        </p>
        <p>
          When you provide and verify a mobile number and consent to portal text
          communications, you agree to receive automated informational text
          messages related to account verification, security, recovery,
          scheduling, adjudication, portal activity, and time-sensitive program
          or chat alerts. Messages are not marketing messages. Consent to text
          messages is not a condition of making a purchase.
        </p>
        <ul>
          <li>
            <strong>Message frequency varies</strong> based on account activity,
            program activity, and urgent alerts.
          </li>
          <li>
            <strong>Message and data rates may apply.</strong>
          </li>
          <li>
            <strong>Reply STOP to unsubscribe.</strong> After an opt-out is
            processed, you may receive one final confirmation and no further
            messages from that messaging program unless you opt in again.
          </li>
          <li>
            <strong>Reply HELP for help</strong>, email{" "}
            <a href="mailto:elenhart@artsbridgega.org">
              elenhart@artsbridgega.org
            </a>
            , or call <a href="tel:+17709162808">770-916-2808</a>.
          </li>
          <li>
            Mobile carriers are not liable for delayed or undelivered messages.
          </li>
        </ul>
        <p>
          Portal users may include <strong>@URGENT</strong> in a chat message to
          request a time-sensitive text alert to verified members of that
          authorized conversation. Routine portal SMS preferences do not
          control these urgent alerts, but carrier-level STOP requests and
          applicable law remain controlling. Delivery is not guaranteed.
        </p>
        <p>
          Mobile information and messaging consent are handled as described in
          our <Link href="/privacy#text-messaging">Privacy Policy</Link>. Mobile
          opt-in information and consent are not sold or shared with third
          parties or affiliates for their marketing or promotional purposes.
        </p>

        <h2>Third-party services</h2>
        <p>
          Certain features use third-party providers for hosting,
          authentication, messaging, document signing, payment links, or other
          services. Their separate terms may apply to your direct use of those
          services. ArtsBridge Foundation is not responsible for an external
          service outside its reasonable control.
        </p>

        <h2>Availability and changes</h2>
        <p>
          We may update, suspend, or discontinue portal features, correct data,
          or change these Terms when reasonably necessary. We work to keep the
          portal available and accurate, but do not promise uninterrupted or
          error-free operation. Material changes will be posted with an updated
          effective date and may also be communicated through the portal.
        </p>

        <h2>Disclaimers and limitation of liability</h2>
        <p>
          To the extent permitted by law, the portal is provided on an
          &quot;as available&quot; basis. ArtsBridge Foundation is not responsible
          for losses caused by events outside its reasonable control, including
          carrier delays, internet outages, or unauthorized conduct by another
          user. Nothing in these Terms excludes liability that cannot lawfully
          be excluded.
        </p>

        <h2>Suspension and termination</h2>
        <p>
          ArtsBridge Foundation may restrict or end access for violations of
          these Terms, program rules, confidentiality obligations, or security
          requirements. Provisions concerning confidentiality, intellectual
          property, records, disclaimers, and liability continue to apply after
          access ends where appropriate.
        </p>

        <h2>Governing law</h2>
        <p>
          These Terms are governed by the laws of the State of Georgia, without
          regard to conflict-of-law principles. Any dispute that cannot be
          resolved informally will be handled in a court of competent
          jurisdiction in Georgia, unless applicable law requires otherwise.
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
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/">Return home</Link>
        </nav>
      </article>
    </main>
  );
}
