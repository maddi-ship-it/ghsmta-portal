import {
  normalizeAdobeSignEmbedHeight,
  safeAdobeSignEmbedUrl,
} from "@/lib/adobe-sign";
import { requireProfile } from "@/lib/auth";
import type { AppRole } from "@/lib/types";

type SigningRole = Extract<AppRole, "adjudicator" | "advisory_member">;

const signingDocuments: Record<
  SigningRole,
  {
    audience: string;
    description: string;
    envKey:
      | "ADOBE_SIGN_ADJUDICATOR_EMBED_URL"
      | "ADOBE_SIGN_ADVISORY_MEMBER_EMBED_URL";
    title: string;
  }
> = {
  adjudicator: {
    audience: "Adjudicators",
    description:
      "Review and complete the required adjudicator agreement. Your signature is submitted securely through Adobe Acrobat Sign.",
    envKey: "ADOBE_SIGN_ADJUDICATOR_EMBED_URL",
    title: "Adjudicator agreement",
  },
  advisory_member: {
    audience: "Advisory Committee members",
    description:
      "Review and complete the required Advisory Committee agreement. Your signature is submitted securely through Adobe Acrobat Sign.",
    envKey: "ADOBE_SIGN_ADVISORY_MEMBER_EMBED_URL",
    title: "Advisory Committee member agreement",
  },
};

export default async function DigitalSigningPage() {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const document = signingDocuments[profile.role as SigningRole];
  const embedUrl = safeAdobeSignEmbedUrl(process.env[document.envKey]);
  const embedHeight = normalizeAdobeSignEmbedHeight(900);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Resources</span>
          <h1>DIGITAL SIGNING</h1>
          <p>
            This page contains the single signing document assigned to {document.audience}.
          </p>
        </div>
      </header>

      <section className="panel digital-signing-panel">
        <div className="panel-body">
          <article className="application-adobe-sign-block">
            <div className="application-adobe-sign-heading">
              <div>
                <span className="eyebrow">Adobe Acrobat Sign</span>
                <h3>{document.title}</h3>
                <p>{document.description}</p>
              </div>
              <span className="badge">Secure Adobe form</span>
            </div>

            {embedUrl ? (
              <>
                <div className="application-adobe-sign-frame-shell">
                  <iframe
                    className="application-adobe-sign-frame"
                    height={embedHeight}
                    referrerPolicy="strict-origin-when-cross-origin"
                    src={embedUrl}
                    title={`${document.title} — Adobe Acrobat Sign`}
                  />
                </div>
                <p className="application-adobe-sign-fallback">
                  Trouble viewing the form?{" "}
                  <a href={embedUrl} target="_blank" rel="noreferrer noopener">
                    Open the secure Adobe Sign form in a new window
                  </a>
                  .
                </p>
              </>
            ) : (
              <div className="form-error" role="alert">
                This Adobe Sign document is not configured yet. Please contact GHSMTA support.
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
