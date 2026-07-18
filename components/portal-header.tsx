import Link from "next/link";

import { signOut } from "@/app/portal/actions";
import { roleLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: string;
};

function navItems(profile: Profile): NavItem[] {
  const items: NavItem[] = [
    { href: "/portal", label: "Dashboard", shortLabel: "Home", icon: "⌂" },
    { href: "/portal/schedule", label: "Scheduling", shortLabel: "Schedule", icon: "◷" },
    { href: "/portal/chat", label: "Chat", icon: "✉" },
  ];

  if (profile.role === "applicant") {
    items.push(
      { href: "/portal/admin/applications", label: "My application", shortLabel: "Application", icon: "▤" },
      { href: "/portal/results", label: "Released results", shortLabel: "Results", icon: "★" },
    );
    return items;
  }

  items.push({ href: "/portal/admin/applications", label: "Applications", icon: "▤" });
  items.push({ href: "/portal/adjudication", label: profile.role === "adjudicator" ? "Assignments" : "Adjudication", icon: "✓" });

  if (profile.role === "advisory_member" || profile.role === "owner") {
    items.push({ href: "/portal/admin/cycles", label: "Cycles", icon: "◫" });
  }

  if (profile.role === "owner") {
    items.push(
      { href: "/portal/admin/scoring", label: "Scoring setup", shortLabel: "Scoring", icon: "⚙" },
      { href: "/portal/admin/forms", label: "Form Builder", shortLabel: "Forms", icon: "✎" },
      { href: "/portal/admin/users", label: "Users", icon: "♙" },
    );
  }

  return items;
}

export function PortalHeader({ profile }: { profile: Profile }) {
  const items = navItems(profile);
  const mobileItems = items;

  return (
    <>
      <header className="portal-header">
        <div className="container portal-header-inner">
          <Link href="/portal" className="brand">
            <span className="brand-mark">G</span>
            <span className="brand-copy">GHSMTA<small>Awards Portal</small></span>
          </Link>

          <nav className="portal-nav" aria-label="Portal navigation">
            {items.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
          </nav>

          <div className="user-chip">
            <span className="user-avatar">{(profile.full_name ?? profile.email ?? "U").slice(0, 1).toUpperCase()}</span>
            <span className="user-meta"><strong>{profile.full_name ?? profile.email}</strong><span>{roleLabel(profile.role)}</span></span>
            <form action={signOut}><button className="button button-secondary button-compact" type="submit">Sign out</button></form>
          </div>
        </div>
      </header>

      <nav className="mobile-portal-nav" aria-label="Mobile portal navigation">
        {mobileItems.map((item) => (
          <Link href={item.href} key={item.href}>
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.shortLabel ?? item.label}</small>
          </Link>
        ))}
      </nav>
    </>
  );
}
