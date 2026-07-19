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

function buildNavigation(
  profile: Profile,
  chatMessageCount: number,
) {
  const primary: NavItem[] = [
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
  ];

  const resources: NavItem[] = [
    {
      href: "/portal/files",
      label: "School files",
      shortLabel: "Files",
      icon: "▱",
    },
    {
      href: "/portal/reference-documents",
      label: "Reference documents",
      shortLabel: "Reference",
      icon: "◫",
    },
    {
      href: "/portal/appeals",
      label: "Eligibility appeals",
      shortLabel: "Appeals",
      icon: "⚖",
    },
  ];

  const management: NavItem[] = [];

  if (profile.role === "applicant") {
    primary.push({
      href: "/portal/admin/applications",
      label: "My application",
      shortLabel: "Application",
      icon: "▤",
    });

    resources.push(
      {
        href: "/portal/school-team",
        label: "School team",
        shortLabel: "Team",
        icon: "♟",
      },
      {
        href: "/portal/results",
        label: "Released results",
        shortLabel: "Results",
        icon: "★",
      },
    );
  } else {
    primary.push(
      {
        href: "/portal/admin/applications",
        label: "Applications",
        icon: "▤",
      },
      {
        href: "/portal/adjudication",
        label:
          profile.role === "adjudicator"
            ? "Assignments"
            : "Adjudication",
        icon: "✓",
      },
    );
  }

  if (profile.role === "advisory_member") {
    management.push({
      href: "/portal/admin/cycles",
      label: "Programs",
      icon: "◫",
    });
  }

  if (profile.role === "owner") {
    management.push(
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
      {
        href: "/portal/admin/archive",
        label: "View archive",
        shortLabel: "Archive",
        icon: "▥",
      },
    );
  }

  return {
    primary,
    resources,
    management,
    mobile: [
      ...primary,
      ...resources,
      ...management,
      {
        href: "/portal/account",
        label: "Account",
        icon: "♙",
      },
    ],
  };
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

function DesktopLink({ item }: { item: NavItem }) {
  return (
    <Link href={item.href} className="portal-desktop-link">
      <span>{item.label}</span>
      {renderBadge(item.badgeCount)}
    </Link>
  );
}

function DesktopMenu({
  label,
  items,
}: {
  label: string;
  items: NavItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <details className="portal-nav-menu">
      <summary>
        {label}
        <span aria-hidden="true">⌄</span>
      </summary>

      <div className="portal-nav-menu-popover">
        {items.map((item) => (
          <Link href={item.href} key={item.href}>
            <span className="portal-nav-menu-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
            {renderBadge(item.badgeCount)}
          </Link>
        ))}
      </div>
    </details>
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

  const navigation = buildNavigation(profile, chatMessageCount);
  const displayName =
    profile.preferred_name ??
    profile.full_name ??
    profile.email ??
    "Account";

  return (
    <>
      <header className="portal-header">
        <div className="portal-header-inner">
          <Link href="/portal" className="brand portal-brand">
            <span className="brand-mark">G</span>
            <span className="brand-copy">
              GHSMTA
              <small>Awards Portal</small>
            </span>
          </Link>

          <nav className="portal-nav" aria-label="Portal navigation">
            {navigation.primary.map((item) => (
              <DesktopLink item={item} key={item.href} />
            ))}

            <DesktopMenu
              label={profile.role === "applicant" ? "School" : "Resources"}
              items={navigation.resources}
            />

            <DesktopMenu label="Admin" items={navigation.management} />
          </nav>

          <div className="portal-header-actions">
            <PortalUtilities
              profile={profile}
              initialNotificationCount={notificationCount}
              initialChatMessageCount={chatMessageCount}
              initialChatChannelCount={chatChannelCount}
            />

            <details className="portal-account-menu">
              <summary aria-label="Open account menu">
                <span className="user-avatar">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="portal-account-summary-copy">
                  <strong>{displayName}</strong>
                  <small>{roleLabel(profile.role)}</small>
                </span>
                <span className="portal-account-chevron" aria-hidden="true">
                  ⌄
                </span>
              </summary>

              <div className="portal-account-popover">
                <div className="portal-account-popover-heading">
                  <strong>{displayName}</strong>
                  <span>{profile.email}</span>
                </div>

                <Link href="/portal/account">Account settings</Link>

                <form action={signOut}>
                  <button type="submit">Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>

      <nav
        className="mobile-portal-nav"
        aria-label="Mobile portal navigation"
      >
        {navigation.mobile.map((item) => (
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
