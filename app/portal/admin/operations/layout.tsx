import Link from "next/link";

import { requireProfile } from "@/lib/auth";

const sections = [
  {
    href: "/portal/admin/operations",
    label: "Productions",
    description: "Set up GHSMTA internal productions.",
  },
  {
    href: "/portal/admin/operations/schedule",
    label: "Schedule",
    description: "Events, meetings, deadlines, and milestones.",
  },
  {
    href: "/portal/admin/operations/calls",
    label: "Calls",
    description: "Labor calls, assignments, and payroll tracking.",
  },
  {
    href: "/portal/admin/operations/budgets",
    label: "Budgets",
    description: "Budget lines, commitments, actuals, and forecasts.",
  },
];

export default async function OperationsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireProfile(["owner"]);

  return (
    <>
      <div className="page-heading operations-heading">
        <div>
          <span className="eyebrow">GHSMTA internal operations</span>
          <h1>Production operations</h1>
          <p>
            Plan GHSMTA work, publish internal schedules, build labor calls,
            and track production budgets in one connected workspace.
          </p>
        </div>
      </div>

      <nav className="operations-tabs" aria-label="Production operations sections">
        {sections.map((section) => (
          <Link href={section.href} key={section.href}>
            <strong>{section.label}</strong>
            <small>{section.description}</small>
          </Link>
        ))}
      </nav>

      <div className="operations-workspace">{children}</div>
    </>
  );
}
