import {
  normalizeAdobeSignEmbedHeight,
  safeAdobeSignEmbedUrl,
} from "@/lib/adobe-sign";
import type { ApplicationQuestion } from "@/lib/types";

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "yes";
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function displaySourceValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? value.map(displaySourceValue).join(", ") : "—";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key !== "attachment" && item !== null && item !== "")
      .map(([key, item]) => `${key.replaceAll("_", " ")}: ${displaySourceValue(item)}`)
      .join(" · ") || "—";
  }
  return String(value);
}

export function ApplicationQuestionField({
  question,
  value,
  disabled = false,
}: {
  question: ApplicationQuestion;
  value: unknown;
  disabled?: boolean;
}) {
  const name = `question_${question.id}`;
  const requiredMark = question.required ? <span className="required-mark">Required</span> : null;

  if (question.settings.source_managed) {
    const sourceRecord =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const attachment =
      sourceRecord?.attachment &&
      typeof sourceRecord.attachment === "object" &&
      !Array.isArray(sourceRecord.attachment)
        ? (sourceRecord.attachment as Record<string, unknown>)
        : null;
    const attachmentUrl = safeHttpUrl(attachment?.url);
    return (
      <div className="application-question">
        <div className="question-label-row">
          <strong>{question.label}</strong>
          <span className="badge">Acceptd</span>
        </div>
        {question.description && <p className="field-help">{question.description}</p>}
        <p>{displaySourceValue(sourceRecord && "answer" in sourceRecord ? sourceRecord.answer : value)}</p>
        {attachmentUrl && (
          <a className="document-link" href={attachmentUrl} target="_blank" rel="noreferrer noopener">
            {typeof attachment?.name === "string" && attachment.name
              ? attachment.name
              : "Open Acceptd attachment"}
          </a>
        )}
      </div>
    );
  }

  if (question.question_type === "adobe_sign") {
    const embedUrl = safeAdobeSignEmbedUrl(
      question.settings.adobe_sign_embed_url,
    );
    const embedHeight = normalizeAdobeSignEmbedHeight(
      question.settings.adobe_sign_embed_height,
    );

    return (
      <article className="application-adobe-sign-block">
        <div className="application-adobe-sign-heading">
          <div>
            <span className="eyebrow">Adobe Acrobat Sign</span>
            <h3>{question.label}</h3>
            {question.description && <p>{question.description}</p>}
          </div>
          <span className="badge">Secure Adobe form</span>
        </div>

        {embedUrl ? (
          <>
            <div className="application-adobe-sign-frame-shell">
              <iframe
                className="application-adobe-sign-frame"
                height={embedHeight}
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                src={embedUrl}
                title={`${question.label} — Adobe Acrobat Sign`}
              />
            </div>
            <p className="application-adobe-sign-fallback">
              Trouble viewing the form?{" "}
              <a href={embedUrl} target="_blank" rel="noreferrer noopener">
                {question.settings.external_label ??
                  "Open the secure Adobe Sign form in a new window"}
              </a>
              .
            </p>
          </>
        ) : (
          <div className="form-error">
            This Adobe Sign block does not have a valid Web Form embed yet.
            Please contact GHSMTA support.
          </div>
        )}
      </article>
    );
  }

  if (question.question_type === "content") {
    return (
      <article className="application-content-block">
        <h3>{question.label}</h3>
        {question.description && <p>{question.description}</p>}
      </article>
    );
  }

  const description = question.description ? (
    <p className="field-help">{question.description}</p>
  ) : null;

  if (
    question.question_type === "signature_acknowledgement" ||
    question.question_type === "checkbox"
  ) {
    return (
      <div className="application-question">
        <div className="question-label-row">
          <strong>{question.label}</strong>
          {requiredMark}
        </div>
        {description}
        {question.settings.external_url && (
          <a
            className="document-link"
            href={question.settings.external_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {question.settings.external_label ?? "Open required document"}
          </a>
        )}
        <label className="check-row acknowledgement-row">
          <input
            name={name}
            type="checkbox"
            value="true"
            defaultChecked={asBoolean(value)}
            disabled={disabled}
          />
          {question.settings.acknowledgement_label ?? "I acknowledge this item."}
        </label>
      </div>
    );
  }

  if (question.question_type === "yes_no") {
    return (
      <fieldset className="application-question">
        <legend>
          <span>{question.label}</span>
          {requiredMark}
        </legend>
        {description}
        <div className="choice-list choice-inline">
          {[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ].map((option) => (
            <label className="choice-row" key={option.value}>
              <input
                name={name}
                type="radio"
                value={option.value}
                defaultChecked={asString(value) === option.value}
                disabled={disabled}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.question_type === "radio") {
    return (
      <fieldset className="application-question">
        <legend>
          <span>{question.label}</span>
          {requiredMark}
        </legend>
        {description}
        <div className="choice-list">
          {question.options.map((option) => (
            <label className="choice-row" key={option}>
              <input
                name={name}
                type="radio"
                value={option}
                defaultChecked={asString(value) === option}
                disabled={disabled}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.question_type === "multi_select") {
    const selected = new Set(asStringArray(value));
    return (
      <fieldset className="application-question">
        <legend>
          <span>{question.label}</span>
          {requiredMark}
        </legend>
        {description}
        <div className="choice-list">
          {question.options.map((option) => (
            <label className="choice-row" key={option}>
              <input
                name={name}
                type="checkbox"
                value={option}
                defaultChecked={selected.has(option)}
                disabled={disabled}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.question_type === "select") {
    return (
      <div className="field application-question">
        <div className="question-label-row">
          <label htmlFor={name}>{question.label}</label>
          {requiredMark}
        </div>
        {description}
        <select
          className="select"
          id={name}
          name={name}
          defaultValue={asString(value)}
          disabled={disabled}
        >
          <option value="">Select an option</option>
          {question.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
    );
  }

  if (question.question_type === "long_text") {
    return (
      <div className="field application-question">
        <div className="question-label-row">
          <label htmlFor={name}>{question.label}</label>
          {requiredMark}
        </div>
        {description}
        <textarea
          className="textarea"
          id={name}
          name={name}
          defaultValue={asString(value)}
          placeholder={question.settings.placeholder}
          disabled={disabled}
        />
      </div>
    );
  }

  const inputType = {
    short_text: "text",
    email: "email",
    phone: "tel",
    number: "number",
    date: "date",
    datetime: "datetime-local",
  }[question.question_type] ?? "text";

  return (
    <div className="field application-question">
      <div className="question-label-row">
        <label htmlFor={name}>{question.label}</label>
        {requiredMark}
      </div>
      {description}
      <input
        className="input"
        id={name}
        name={name}
        type={inputType}
        defaultValue={asString(value)}
        placeholder={question.settings.placeholder}
        disabled={disabled}
      />
    </div>
  );
}
