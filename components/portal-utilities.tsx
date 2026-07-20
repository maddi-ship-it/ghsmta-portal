"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { FEEDBACK_DIALOG_EVENT } from "@/components/global-feedback-dialog";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

type UnreadCounts = {
  notification_count: number;
  chat_message_count: number;
  chat_channel_count: number;
};

type PortalUtilitiesProps = {
  profile: Profile;
  initialNotificationCount?: number;
  initialChatMessageCount?: number;
  initialChatChannelCount?: number;
};

function BellIcon() {
  return (
    <svg
      className="portal-utility-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M10 21h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function PortalUtilities({
  profile,
  initialNotificationCount = 0,
  initialChatMessageCount = 0,
  initialChatChannelCount = 0,
}: PortalUtilitiesProps) {
  const supabase = useMemo(() => createClient(), []);
  const [notificationCount, setNotificationCount] = useState(
    initialNotificationCount,
  );
  const [chatMessageCount, setChatMessageCount] = useState(
    initialChatMessageCount,
  );
  const [chatChannelCount, setChatChannelCount] = useState(
    initialChatChannelCount,
  );

  const refreshUnreadCounts = useCallback(async () => {
    const { data } = await supabase.rpc("get_unread_portal_counts");
    const row = (Array.isArray(data) ? data[0] : data) as
      | UnreadCounts
      | null;

    setNotificationCount(Number(row?.notification_count ?? 0));
    setChatMessageCount(Number(row?.chat_message_count ?? 0));
    setChatChannelCount(Number(row?.chat_channel_count ?? 0));
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`portal-unread-counts-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${profile.id}`,
        },
        () => void refreshUnreadCounts(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_posts",
        },
        () => void refreshUnreadCounts(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_replies",
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
  }, [profile.id, refreshUnreadCounts, supabase]);

  const bellCount = notificationCount + chatChannelCount;

  return (
    <div className="portal-utilities">
      <Link
        className="portal-utility-link portal-utility-link-with-badge"
        href="/portal/notifications"
        aria-label={`Notifications. ${notificationCount} portal notifications and ${chatMessageCount} unread chat messages.`}
      >
        <BellIcon />
        {bellCount > 0 ? (
          <span className="portal-utility-badge">
            {bellCount > 99 ? "99+" : bellCount}
          </span>
        ) : null}
      </Link>

      <button
        className="portal-utility-link"
        type="button"
        aria-label="Report a bug or request a feature"
        onClick={() =>
          window.dispatchEvent(new Event(FEEDBACK_DIALOG_EVENT))
        }
      >
        ?
      </button>
    </div>
  );
}
