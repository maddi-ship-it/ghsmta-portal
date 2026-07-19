"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type NotificationRow = {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
  related_application_id: string | null;
};

type ChatChannelRow = {
  channel_id: string;
  channel_type: string;
  channel_name: string;
  channel_description: string | null;
  application_id: string | null;
  school_name: string | null;
  production_title: string | null;
  last_activity_at: string;
  unread_count: number;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function chatChannelLabel(channel: ChatChannelRow) {
  if (channel.channel_type === "school") {
    return "School Staff";
  }

  if (channel.channel_type === "school_dm") {
    return "School Owner DM";
  }

  return channel.channel_name;
}

export function NotificationCenter({
  initialNotifications,
  initialChatChannels,
  userId,
}: {
  initialNotifications: NotificationRow[];
  initialChatChannels: ChatChannelRow[];
  userId: string;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [notifications, setNotifications] = useState(
    initialNotifications,
  );

  const [chatChannels, setChatChannels] = useState(
    initialChatChannels,
  );

  const refreshChatChannels = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_my_chat_channels",
    );

    if (!error) {
      setChatChannels((data ?? []) as ChatChannelRow[]);
    }
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`notification-center-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((current) => [
            payload.new as NotificationRow,
            ...current,
          ]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_posts",
        },
        () => {
          void refreshChatChannels();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_replies",
        },
        () => {
          void refreshChatChannels();
        },
      )
      .subscribe();

    const onFocus = () => {
      void refreshChatChannels();
    };

    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [refreshChatChannels, supabase, userId]);

  async function markRead(id: string) {
    const readAt = new Date().toISOString();

    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("id", id);

    if (!error) {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id
            ? { ...notification, read_at: readAt }
            : notification,
        ),
      );
    }
  }

  async function markAllRead() {
    const unreadIds = notifications
      .filter((item) => !item.read_at)
      .map((item) => item.id);

    if (unreadIds.length === 0) {
      return;
    }

    const readAt = new Date().toISOString();

    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .in("id", unreadIds);

    if (!error) {
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          read_at: item.read_at ?? readAt,
        })),
      );
    }
  }

  const unreadCount = notifications.filter(
    (notification) => !notification.read_at,
  ).length;

  const unreadChatChannels = chatChannels.filter(
    (channel) => Number(channel.unread_count) > 0,
  );

  const unreadChatMessageCount = unreadChatChannels.reduce(
    (total, channel) => total + Number(channel.unread_count),
    0,
  );

  return (
    <div className="notification-page-stack">
      <section className="panel notification-center chat-notification-summary">
        <div className="panel-header">
          <div>
            <h2>Unread messages</h2>
            <p>
              {unreadChatMessageCount} unread message
              {unreadChatMessageCount === 1 ? "" : "s"} across{" "}
              {unreadChatChannels.length} channel
              {unreadChatChannels.length === 1 ? "" : "s"}
            </p>
          </div>

          <Link
            className="button button-secondary button-compact"
            href="/portal/chat"
          >
            Open Chat
          </Link>
        </div>

        <div className="notification-list chat-unread-list">
          {unreadChatChannels.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <h3>You are caught up</h3>
              <p>No unread chat messages.</p>
            </div>
          ) : (
            unreadChatChannels.map((channel) => (
              <Link
                className="notification-row is-unread chat-unread-row"
                href={`/portal/chat?channel=${channel.channel_id}`}
                key={channel.channel_id}
              >
                <span className="chat-unread-icon" aria-hidden="true">
                  ✉
                </span>

                <span className="notification-copy">
                  <strong>
                    {channel.school_name
                      ? `${channel.school_name} — ${chatChannelLabel(channel)}`
                      : chatChannelLabel(channel)}
                  </strong>

                  {channel.production_title && (
                    <p>{channel.production_title}</p>
                  )}

                  <small>
                    Last activity {formatDate(channel.last_activity_at)}
                  </small>
                </span>

                <span className="notification-count-badge">
                  {Number(channel.unread_count) > 99
                    ? "99+"
                    : Number(channel.unread_count)}
                </span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="panel notification-center">
        <div className="panel-header">
          <div>
            <h2>Portal inbox</h2>
            <p>
              {unreadCount} unread notification
              {unreadCount === 1 ? "" : "s"}
            </p>
          </div>

          <button
            className="button button-secondary button-compact"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            Mark all read
          </button>
        </div>

        <div className="notification-list">
          {notifications.length === 0 ? (
            <div className="empty-state">
              <h3>No portal notifications</h3>
              <p>New portal updates will appear here.</p>
            </div>
          ) : (
            notifications.map((notification) => {
              const content = (
                <>
                  <span className="notification-dot" aria-hidden="true" />
                  <span className="notification-copy">
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <small>{formatDate(notification.created_at)}</small>
                  </span>
                </>
              );

              return notification.href ? (
                <Link
                  className={
                    notification.read_at
                      ? "notification-row"
                      : "notification-row is-unread"
                  }
                  href={notification.href}
                  key={notification.id}
                  onClick={() => void markRead(notification.id)}
                >
                  {content}
                </Link>
              ) : (
                <button
                  className={
                    notification.read_at
                      ? "notification-row"
                      : "notification-row is-unread"
                  }
                  key={notification.id}
                  onClick={() => void markRead(notification.id)}
                  type="button"
                >
                  {content}
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
