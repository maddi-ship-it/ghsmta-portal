import Link from "next/link";

import { signOut } from "@/app/portal/actions";
import { AutoClosingDetails } from "@/components/auto-closing-details";
import {
  LiveMobilePortalNavigation,
  LivePortalNavigation,
  type LiveNavItem,
} from "@/components/live-portal-navigation";
import { PortalUtilities } from "@/components/portal-utilities";
import { roleLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

type UnreadCounts = {
  notification_count: number;
  chat_message_count: number;
  chat_channel_count: number;
};

function buildNavigation(
  profile: Profile,
  chatMessageCount: number,
) {
  const primary: LiveNavItem[] = [
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

  const resources: LiveNavItem[] =
    profile.role === "program_manager"
      ? []
      : [
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
            label: "Requests & appeals",
            shortLabel: "Requests",
            icon: "⚖",
          },
        ];

  const management: LiveNavItem[] = [];

  if (profile.role === "applicant") {
    primary.push({
      href: "/portal/admin/applications",
      label: "My application",
      shortLabel: "Application",
      icon: "▤",
    });

    resources.push(
      {
        href: "/portal/invoices",
        label: "Invoices & payments",
        shortLabel: "Invoices",
        icon: "$",
      },
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
    primary.push({
      href: "/portal/admin/applications",
      label: "Applications",
      icon: "▤",
    });

    if (profile.role === "program_manager") {
      resources.push({
        href: "/portal/results",
        label: "Released results",
        shortLabel: "Results",
        icon: "★",
      });
    } else {
      primary.push({
        href: "/portal/adjudication",
        label:
          profile.role === "adjudicator"
            ? "Assignments"
            : "Adjudication",
        icon: "✓",
      });
    }
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
        href: "/portal/admin/billing",
        label: "Billing & invoices",
        shortLabel: "Billing",
        icon: "$",
      },
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
        href: "/portal/admin/reports",
        label: "Reports",
        icon: "▦",
      },
      {
        href: "/portal/admin/feedback",
        label: "Bug & feature tickets",
        shortLabel: "Tickets",
        icon: "?",
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

          <LivePortalNavigation
            userId={profile.id}
            resourcesLabel={profile.role === "applicant" ? "School" : "Resources"}
            primary={navigation.primary}
            resources={navigation.resources}
            management={navigation.management}
            initialChatMessageCount={chatMessageCount}
          />

          <div className="portal-header-actions">
            <PortalUtilities
              profile={profile}
              initialNotificationCount={notificationCount}
              initialChatMessageCount={chatMessageCount}
            />

            <AutoClosingDetails
              className="portal-account-menu"
              summaryAriaLabel="Open account menu"
              summary={
                <>
                  <span className="user-avatar">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="portal-account-summary-copy">
                    <strong>{displayName}</strong>
                    <small>{roleLabel(profile.role)}</small>
                  </span>
                  <span
                    className="portal-account-chevron"
                    aria-hidden="true"
                  >
                    ⌄
                  </span>
                </>
              }
            >
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
            </AutoClosingDetails>
          </div>
        </div>
      </header>

      <LiveMobilePortalNavigation
        userId={profile.id}
        mobile={navigation.mobile}
        initialChatMessageCount={chatMessageCount}
      />
    </>
  );
}
