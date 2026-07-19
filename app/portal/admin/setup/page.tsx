import Link from "next/link";

import CyclesPage from "@/app/portal/admin/cycles/page";
import FormsPage from "@/app/portal/admin/forms/page";
import ScoringAdminPage from "@/app/portal/admin/scoring/page";
import { requireProfile } from "@/lib/auth";

type AdminSetupTab = "programs" | "forms" | "scoring";

type AdminSetupSearchParams = {
  tab?: string;
  assigned?: string;
  prompt_saved?: string;
};

const tabs: Array<{
  key: AdminSetupTab;
  label: string;
  description: string;
}> = [
  {
    key: "programs",
    label: "Programs & cycles",
    description: "Open, close, create, and duplicate application programs.",
  },
  {
    key: "forms",
    label: "Form builder",
    description: "Create and manage staged application form versions.",
  },
  {
    key: "scoring",
    label: "Scoring setup",
    description: "Manage assignments, rubrics, and the AI narrative prompt.",
  },
];

function resolveTab(value: string | undefined): AdminSetupTab {
  return tabs.some((tab) => tab.key === value)
    ? (value as AdminSetupTab)
    : "programs";
}

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<AdminSetupSearchParams>;
}) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const activeTab = resolveTab(params.tab);

  return (
    <>
      <div className="page-heading admin-setup-heading">
        <div>
          <span className="eyebrow">Owner administration</span>
          <h1>Program setup</h1>
          <p>
            Manage application programs, forms, scoring assignments, rubrics,
            and AI feedback settings from one workspace.
          </p>
        </div>
      </div>

      <nav className="admin-setup-tabs" aria-label="Program setup sections">
        {tabs.map((tab) => (
          <Link
            aria-current={activeTab === tab.key ? "page" : undefined}
            className={activeTab === tab.key ? "is-active" : ""}
            href={`/portal/admin/setup?tab=${tab.key}`}
            key={tab.key}
          >
            <strong>{tab.label}</strong>
            <small>{tab.description}</small>
          </Link>
        ))}
      </nav>

      <div className="admin-setup-content">
        {activeTab === "programs" && <CyclesPage />}
        {activeTab === "forms" && <FormsPage />}
        {activeTab === "scoring" && (
          <ScoringAdminPage
            searchParams={Promise.resolve({
              assigned: params.assigned,
              prompt_saved: params.prompt_saved,
            })}
          />
        )}
      </div>
    </>
  );
}
