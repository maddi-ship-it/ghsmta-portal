"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function NotificationCenter({
  initialNotifications,
  userId,
}: {
  initialNotifications: NotificationRow[];
  userId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState(initialNotifications);

  useEffect(() => {
    const channel = supabase
      .channel(`user-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((current) => [payload.new as NotificationRow, ...current]);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  async function markRead(id: string) {
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("id", id);
    if (!error) {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id ? { ...notification, read_at: readAt } : notification,
        ),
      );
    }
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((item) => !item.read_at).map((item) => item.id);
    if (unreadIds.length === 0) return;
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .in("id", unreadIds);
    if (!error) {
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    }
  }

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  return (
    <section className="panel notification-center">
      <div className="panel-header">
        <div><h2>Inbox</h2><p>{unreadCount} unread notification{unreadCount === 1 ? "" : "s"}</p></div>
        <button className="button button-secondary button-compact" disabled={unreadCount === 0} onClick={() => void markAllRead()} type="button">Mark all read</button>
      </div>
      <div className="notification-list">
        {notifications.length === 0 ? <div className="empty-state"><h3>No notifications</h3><p>New portal updates will appear here.</p></div> : notifications.map((notification) => {
          const content = (
            <>
              <span className="notification-dot" aria-hidden="true" />
              <span className="notification-copy"><strong>{notification.title}</strong><p>{notification.body}</p><small>{formatDate(notification.created_at)}</small></span>
            </>
          );
          return notification.href ? (
            <Link
              className={notification.read_at ? "notification-row" : "notification-row is-unread"}
              href={notification.href}
              key={notification.id}
              onClick={() => void markRead(notification.id)}
            >{content}</Link>
          ) : (
            <button
              className={notification.read_at ? "notification-row" : "notification-row is-unread"}
              key={notification.id}
              onClick={() => void markRead(notification.id)}
              type="button"
            >{content}</button>
          );
        })}
      </div>
    </section>
  );
}
