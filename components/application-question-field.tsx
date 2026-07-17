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
