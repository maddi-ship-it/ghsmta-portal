import Link from "next/link";

import { signOut } from "@/app/portal/actions";
import { PortalUtilities } from "@/components/portal-utilities";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: string;
  badgeCount?: number;
};

type UnreadCounts = {
  notification_count: number;
  chat_message_count: number;
  chat_channel_count: number;
};

function navItems(
  profile: Profile,
  chatMessageCount: number,
): NavItem[] {
  const items: NavItem[] = [
    {
      href: "/portal",
      label: "Dashboard",
      shortLabel: "Home",
      icon: "⌂",
    },
    {
      href: "/portal/schedule",
      label: "Scheduling",
      shortLabel: "Schedule",
      icon: "◷",
    },
    {
      href: "/portal/chat",
      label: "Chat",
      icon: "✉",
      badgeCount: chatMessageCount,
    },
    {
      href: "/portal/reference-documents",
      label: "Reference documents",
      shortLabel: "Documents",
      icon: "▱",
    },
    {
      href: "/portal/appeals",
      label: "Appeals",
      icon: "⚖",
    },
  ];

  if (profile.role === "applicant") {
    items.push(
      {
        href: "/portal/admin/applications",
        label: "My application",
        shortLabel: "Application",
        icon: "▤",
      },
      {
        href: "/portal/results",
        label: "Released results",
        shortLabel: "Results",
        icon: "★",
      },
    );

    return items;
  }

  items.push({
    href: "/portal/admin/applications",
    label: "Applications",
    icon: "▤",
  });

  items.push({
    href: "/portal/adjudication",
    label:
      profile.role === "adjudicator"
        ? "Assignments"
        : "Adjudication",
    icon: "✓",
  });

  if (profile.role === "advisory_member") {
    items.push({
      href: "/portal/admin/cycles",
      label: "Programs",
      icon: "◫",
    });
  }

  if (profile.role === "owner") {
    items.push(
      {
        href: "/portal/admin/setup",
        label: "Program setup",
        shortLabel: "Setup",
        icon: "⚙",
      },
      {
        href: "/portal/admin/users",
        label: "Users",
        icon: "♙",
      },
    );
  }

  return items;
}

function renderBadge(count: number | undefined) {
  if (!count || count < 1) {
    return null;
  }

  return (
    <span className="portal-nav-badge" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export async function PortalHeader({
  profile,
}: {
  profile: Profile;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_unread_portal_counts");

  const countRow = (
    Array.isArray(data) ? data[0] : data
  ) as UnreadCounts | null;

  const notificationCount = Number(
    countRow?.notification_count ?? 0,
  );

  const chatMessageCount = Number(
    countRow?.chat_message_count ?? 0,
  );

  const chatChannelCount = Number(
    countRow?.chat_channel_count ?? 0,
  );

  const items = navItems(profile, chatMessageCount);
  const mobileItems = items;

  return (
    <>
      <header className="portal-header">
        <div className="container portal-header-inner">
          <Link href="/portal" className="brand">
            <span className="brand-mark">G</span>
            <span className="brand-copy">
              GHSMTA
              <small>Awards Portal</small>
            </span>
          </Link>

          <nav className="portal-nav" aria-label="Portal navigation">
            {items.map((item) => (
              <Link href={item.href} key={item.href}>
                <span>{item.label}</span>
                {renderBadge(item.badgeCount)}
              </Link>
            ))}
          </nav>

          <PortalUtilities
            profile={profile}
            initialNotificationCount={notificationCount}
            initialChatMessageCount={chatMessageCount}
            initialChatChannelCount={chatChannelCount}
          />

          <div className="user-chip">
            <span className="user-avatar">
              {(profile.full_name ?? profile.email ?? "U")
                .slice(0, 1)
                .toUpperCase()}
            </span>

            <span className="user-meta">
              <strong>{profile.full_name ?? profile.email}</strong>
              <span>{roleLabel(profile.role)}</span>
            </span>

            <form action={signOut}>
              <button
                className="button button-secondary button-compact"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <nav
        className="mobile-portal-nav"
        aria-label="Mobile portal navigation"
      >
        {mobileItems.map((item) => (
          <Link href={item.href} key={item.href}>
            <span className="mobile-nav-icon" aria-hidden="true">
              {item.icon}
              {renderBadge(item.badgeCount)}
            </span>
            <small>{item.shortLabel ?? item.label}</small>
          </Link>
        ))}
      </nav>
    </>
  );
}
