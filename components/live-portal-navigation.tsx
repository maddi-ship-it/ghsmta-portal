"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AutoClosingDetails } from "@/components/auto-closing-details";
import { createClient } from "@/lib/supabase/client";

export type LiveNavItem = {
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

function withChatBadge(items: LiveNavItem[], chatMessageCount: number) {
  return items.map((item) =>
    item.href === "/portal/chat"
      ? { ...item, badgeCount: chatMessageCount }
      : item,
  );
}

function DesktopLink({ item }: { item: LiveNavItem }) {
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
  items: LiveNavItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <AutoClosingDetails
      className="portal-nav-menu"
      summary={
        <>
          {label}
          <span className="portal-menu-chevron" aria-hidden="true">
            ⌄
          </span>
        </>
      }
      summaryAriaLabel={`Open ${label} menu`}
    >
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
    </AutoClosingDetails>
  );
}

export function LivePortalNavigation({
  userId,
  resourcesLabel,
  primary,
  resources,
  management,
  initialChatMessageCount,
}: {
  userId: string;
  resourcesLabel: string;
  primary: LiveNavItem[];
  resources: LiveNavItem[];
  management: LiveNavItem[];
  initialChatMessageCount: number;
}) {
  const chatMessageCount = useLiveChatMessageCount(
    userId,
    initialChatMessageCount,
  );

  const livePrimary = withChatBadge(primary, chatMessageCount);
  const liveResources = withChatBadge(resources, chatMessageCount);
  const liveManagement = withChatBadge(management, chatMessageCount);

  return (
    <nav className="portal-nav" aria-label="Portal navigation">
      {livePrimary.map((item) => (
        <DesktopLink item={item} key={item.href} />
      ))}

      <DesktopMenu label={resourcesLabel} items={liveResources} />
      <DesktopMenu label="Admin" items={liveManagement} />
    </nav>
  );
}

export function LiveMobilePortalNavigation({
  userId,
  mobile,
  initialChatMessageCount,
}: {
  userId: string;
  mobile: LiveNavItem[];
  initialChatMessageCount: number;
}) {
  const chatMessageCount = useLiveChatMessageCount(
    userId,
    initialChatMessageCount,
  );
  const liveMobile = withChatBadge(mobile, chatMessageCount);

  return (
    <nav
      className="mobile-portal-nav"
      aria-label="Mobile portal navigation"
    >
      {liveMobile.map((item) => (
        <Link href={item.href} key={item.href}>
          <span className="mobile-nav-icon" aria-hidden="true">
            {item.icon}
            {renderBadge(item.badgeCount)}
          </span>
          <small>{item.shortLabel ?? item.label}</small>
        </Link>
      ))}
    </nav>
  );
}

function useLiveChatMessageCount(
  userId: string,
  initialChatMessageCount: number,
) {
  const supabase = useMemo(() => createClient(), []);
  const [chatMessageCount, setChatMessageCount] = useState(
    initialChatMessageCount,
  );

  const refreshUnreadCounts = useCallback(async () => {
    const { data } = await supabase.rpc("get_unread_portal_counts");
    const row = (Array.isArray(data) ? data[0] : data) as
      | UnreadCounts
      | null;
    setChatMessageCount(Number(row?.chat_message_count ?? 0));
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`portal-nav-unread-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_posts" },
        () => void refreshUnreadCounts(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_replies" },
        () => void refreshUnreadCounts(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_channel_reads",
          filter: `user_id=eq.${userId}`,
        },
        () => void refreshUnreadCounts(),
      )
      .subscribe();

    const onFocus = () => void refreshUnreadCounts();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [refreshUnreadCounts, supabase, userId]);

  return chatMessageCount;
}
