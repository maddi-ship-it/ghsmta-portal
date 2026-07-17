import Link from "next/link";
import { roleLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { signOut } from "@/app/portal/actions";

export function PortalHeader({ profile }: { profile: Profile }) {
  const isAdmin = profile.role === "owner" || profile.role === "advisory_member";
  return (
    <header className="portal-header">
      <div className="container portal-header-inner">
        <Link href="/portal" className="brand">
          <span className="brand-mark">G</span>
          <span className="brand-copy">GHSMTA<small>Portal</small></span>
        </Link>
        <nav className="portal-nav" aria-label="Portal navigation">
          <Link href="/portal">Dashboard</Link>
          <Link href="/portal/admin/applications">Applications</Link>
          {isAdmin && <Link href="/portal/admin/cycles">Cycles</Link>}
          {profile.role === "owner" && <Link href="/portal/admin/users">Users</Link>}
        </nav>
        <div className="user-chip">
          <span className="user-avatar">{(profile.full_name ?? profile.email ?? "U").slice(0, 1).toUpperCase()}</span>
          <span className="user-meta"><strong>{profile.full_name ?? profile.email}</strong><span>{roleLabel(profile.role)}</span></span>
          <form action={signOut}><button className="button button-secondary button-compact" type="submit">Sign out</button></form>
        </div>
      </div>
    </header>
  );
}
