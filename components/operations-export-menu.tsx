import Link from "next/link";

type ExportOption = {
  label: string;
  module: "productions" | "schedule" | "calls" | "budgets" | "trucking";
  format: "pdf" | "csv";
  variant?: string;
  query?: Record<string, string | undefined>;
};

function exportHref(option: ExportOption) {
  const params = new URLSearchParams({
    module: option.module,
    format: option.format,
  });
  if (option.variant) params.set("variant", option.variant);
  Object.entries(option.query ?? {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/api/admin/operations/export?${params.toString()}`;
}

export function OperationsExportMenu({
  options,
  description = "Download the established GHSMTA production reports.",
}: {
  options: ExportOption[];
  description?: string;
}) {
  return (
    <details className="operations-export-menu">
      <summary>
        <span>
          <strong>Exports</strong>
          <small>{description}</small>
        </span>
        <span aria-hidden="true">⇩</span>
      </summary>
      <div className="operations-export-options">
        {options.map((option) => (
          <Link
            className="button button-secondary button-compact"
            href={exportHref(option)}
            key={`${option.label}-${option.format}`}
            target="_blank"
          >
            <span aria-hidden="true">{option.format === "pdf" ? "PDF" : "CSV"}</span>
            {option.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
