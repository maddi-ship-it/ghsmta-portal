"use client";

import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createChatMessage } from "@/app/portal/chat/actions";
import { FEEDBACK_DIALOG_EVENT } from "@/components/global-feedback-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ChatThread } from "@/components/teams-chat";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

type UnreadCounts = {
  notification_count: number;
  chat_message_count: number;
  chat_channel_count: number;
};

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

type ChatChannelRow = {
  channel_id: string;
  channel_type: string;
  channel_name: string;
  school_name: string | null;
  production_title: string | null;
  last_activity_at: string;
  unread_count: number;
  latest_message_preview: string | null;
  latest_author_name: string | null;
};

type FlyoutMessage = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  deleted_at: string | null;
};

type PortalUtilitiesProps = {
  profile: Profile;
  initialNotificationCount?: number;
  initialChatMessageCount?: number;
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

function ChatIcon() {
  return (
    <svg
      className="portal-utility-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M4 5.5h16v10.8H9.2L5 19.6v-3.3H4z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8 9h8M8 12.6h5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function chatChannelLabel(channel: ChatChannelRow) {
  if (channel.channel_type === "school") return "Panel Channel";
  if (channel.channel_type === "school_dm") return "School Messaging";
  return channel.channel_name;
}

function chatChannelTitle(channel: ChatChannelRow) {
  return channel.school_name
    ? `${channel.school_name} — ${chatChannelLabel(channel)}`
    : chatChannelLabel(channel);
}

function sortChatChannelsNewestFirst(channels: ChatChannelRow[]) {
  return channels.toSorted((left, right) => {
    const rightTime = new Date(right.last_activity_at).getTime();
    const leftTime = new Date(left.last_activity_at).getTime();
    return rightTime - leftTime;
  });
}

function flattenChatThreads(threads: ChatThread[]): FlyoutMessage[] {
  return threads
    .flatMap((thread) => [
      {
        id: `post-${thread.post_id}`,
        body: thread.body,
        created_at: thread.created_at,
        author_id: thread.author_id,
        author_name: thread.author_name,
        deleted_at: thread.post_deleted_at,
      },
      ...thread.replies.map((reply) => ({
        id: `reply-${reply.id}`,
        body: reply.body,
        created_at: reply.created_at,
        author_id: reply.author_id,
        author_name: reply.author_name,
        deleted_at: reply.deleted_at,
      })),
    ])
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() -
        new Date(right.created_at).getTime(),
    )
    .slice(-80);
}

export function PortalUtilities({
  profile,
  initialNotificationCount = 0,
  initialChatMessageCount = 0,
}: PortalUtilitiesProps) {
  const supabase = useMemo(() => createClient(), []);
  const [notificationCount, setNotificationCount] = useState(
    initialNotificationCount,
  );
  const [chatMessageCount, setChatMessageCount] = useState(
    initialChatMessageCount,
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatChannels, setChatChannels] = useState<ChatChannelRow[]>([]);
  const [selectedChatChannelId, setSelectedChatChannelId] = useState<
    string | null
  >(null);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [chatMessagesLoading, setChatMessagesLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const notificationPopoverRef = useRef<HTMLDivElement>(null);
  const chatPopoverRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCounts = useCallback(async () => {
    const { data } = await supabase.rpc("get_unread_portal_counts");
    const row = (Array.isArray(data) ? data[0] : data) as
      | UnreadCounts
      | null;

    setNotificationCount(Number(row?.notification_count ?? 0));
    setChatMessageCount(Number(row?.chat_message_count ?? 0));
  }, [supabase]);

  const refreshNotificationList = useCallback(async () => {
    setNotificationsLoading(true);

    const notificationResult = await supabase
      .from("user_notifications")
      .select("id,title,body,href,read_at,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!notificationResult.error) {
      setNotifications((notificationResult.data ?? []) as NotificationRow[]);
    }

    setNotificationsLoading(false);
  }, [profile.id, supabase]);

  const refreshChatChannels = useCallback(async () => {
    setChatLoading(true);
    const richChannelResult = await supabase.rpc("get_my_chat_channels_v4");
    let channelRows = richChannelResult.data;
    let channelError = richChannelResult.error;

    if (channelError) {
      const fallbackResult = await supabase.rpc("get_my_chat_channels_v3");
      channelRows = fallbackResult.data;
      channelError = fallbackResult.error;
    }

    if (channelError) {
      const legacyResult = await supabase.rpc("get_my_chat_channels");
      channelRows = legacyResult.data;
      channelError = legacyResult.error;
    }

    if (!channelError) {
      setChatChannels(
        sortChatChannelsNewestFirst(
          (channelRows ?? []) as ChatChannelRow[],
        ),
      );
      setChatError(null);
    } else {
      setChatError("Chat conversations could not be loaded.");
    }

    setChatLoading(false);
  }, [supabase]);

  const refreshChatMessages = useCallback(async (channelId: string) => {
    setChatMessagesLoading(true);
    setChatError(null);

    const threadResult = await supabase.rpc("get_chat_channel_threads", {
      p_channel_id: channelId,
    });

    if (threadResult.error) {
      setChatError("Messages could not be loaded. Try opening the full chat page.");
      setChatMessagesLoading(false);
      return;
    }

    setChatThreads((threadResult.data ?? []) as ChatThread[]);
    setChatMessagesLoading(false);

    const readResult = await supabase.rpc("mark_chat_channel_read", {
      p_channel_id: channelId,
    });

    if (!readResult.error) {
      setChatChannels((current) =>
        current.map((channel) =>
          channel.channel_id === channelId
            ? { ...channel, unread_count: 0 }
            : channel,
        ),
      );
      await refreshUnreadCounts();
    }
  }, [refreshUnreadCounts, supabase]);

  const markRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .eq("user_id", profile.id);

    if (!error) {
      setNotifications((current) =>
        current.map((item) =>
          item.id === id ? { ...item, read_at: readAt } : item,
        ),
      );
      await refreshUnreadCounts();
    }
  }, [profile.id, refreshUnreadCounts, supabase]);

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("user_id", profile.id)
      .is("read_at", null);

    if (!error) {
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          read_at: item.read_at ?? readAt,
        })),
      );
      await refreshUnreadCounts();
    }
  }, [profile.id, refreshUnreadCounts, supabase]);

  const handleChatSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = chatDraft.trim();
    if (!selectedChatChannelId || !body || chatSending) return;

    setChatSending(true);
    setChatError(null);
    try {
      const formData = new FormData();
      formData.set("channel_id", selectedChatChannelId);
      formData.set("body", body);
      const result = await createChatMessage(formData);

      if (!result.ok) {
        setChatError(result.error ?? "The message could not be sent.");
        return;
      }

      setChatDraft("");
      await Promise.all([
        refreshChatMessages(selectedChatChannelId),
        refreshChatChannels(),
      ]);
    } catch {
      setChatError("The message could not be sent. Please try again.");
    } finally {
      setChatSending(false);
    }
  }, [
    chatDraft,
    chatSending,
    refreshChatChannels,
    refreshChatMessages,
    selectedChatChannelId,
  ]);

  useEffect(() => {
    if (!notificationsOpen && !chatOpen) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        notificationsOpen &&
        notificationPopoverRef.current &&
        !notificationPopoverRef.current.contains(target)
      ) {
        setNotificationsOpen(false);
      }
      if (
        chatOpen &&
        chatPopoverRef.current &&
        !chatPopoverRef.current.contains(target)
      ) {
        setChatOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setChatOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatOpen, notificationsOpen]);

  useEffect(() => {
    const messageList = chatMessagesRef.current;
    if (!chatOpen || !selectedChatChannelId || !messageList) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [chatOpen, chatThreads, selectedChatChannelId]);

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
        () => {
          void refreshUnreadCounts();
          if (notificationsOpen) void refreshNotificationList();
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
          void refreshUnreadCounts();
          if (chatOpen) {
            void refreshChatChannels();
            if (selectedChatChannelId) {
              void refreshChatMessages(selectedChatChannelId);
            }
          }
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
          void refreshUnreadCounts();
          if (chatOpen) {
            void refreshChatChannels();
            if (selectedChatChannelId) {
              void refreshChatMessages(selectedChatChannelId);
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_channel_reads",
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          void refreshUnreadCounts();
          if (chatOpen) void refreshChatChannels();
        },
      )
      .subscribe();

    const onFocus = () => void refreshUnreadCounts();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [
    chatOpen,
    notificationsOpen,
    profile.id,
    refreshChatChannels,
    refreshChatMessages,
    refreshNotificationList,
    refreshUnreadCounts,
    selectedChatChannelId,
    supabase,
  ]);

  const selectedChatChannel = chatChannels.find(
    (channel) => channel.channel_id === selectedChatChannelId,
  ) ?? null;
  const flyoutMessages = useMemo(
    () => flattenChatThreads(chatThreads),
    [chatThreads],
  );
  const bellCount = notificationCount;
  const unreadNotifications = notifications.filter((item) => !item.read_at);

  return (
    <div className="portal-utilities">
      <div className="header-chat-popover-shell" ref={chatPopoverRef}>
        <button
          aria-expanded={chatOpen}
          aria-haspopup="dialog"
          aria-label={`Chat. ${chatMessageCount} unread message${chatMessageCount === 1 ? "" : "s"}.`}
          className="portal-utility-link portal-utility-link-with-badge"
          onClick={() => {
            const nextOpen = !chatOpen;
            setChatOpen(nextOpen);
            setNotificationsOpen(false);
            if (nextOpen) {
              void refreshChatChannels();
              if (selectedChatChannelId) {
                void refreshChatMessages(selectedChatChannelId);
              }
            }
          }}
          type="button"
        >
          <ChatIcon />
          {chatMessageCount > 0 ? (
            <span className="portal-utility-badge">
              {chatMessageCount > 99 ? "99+" : chatMessageCount}
            </span>
          ) : null}
        </button>

        {chatOpen ? (
          <section
            aria-label="Chat messages"
            className={`header-chat-popover${selectedChatChannel ? " is-conversation" : ""}`}
            role="dialog"
          >
            <header className="header-chat-popover-header">
              {selectedChatChannel ? (
                <button
                  aria-label="Back to conversations"
                  className="header-chat-back"
                  onClick={() => {
                    setSelectedChatChannelId(null);
                    setChatThreads([]);
                    setChatError(null);
                  }}
                  type="button"
                >
                  ←
                </button>
              ) : (
                <span className="header-chat-heading-icon" aria-hidden="true">
                  <ChatIcon />
                </span>
              )}

              <div>
                <strong>
                  {selectedChatChannel
                    ? chatChannelTitle(selectedChatChannel)
                    : "Chat"}
                </strong>
                <small>
                  {selectedChatChannel
                    ? selectedChatChannel.production_title ?? "Portal conversation"
                    : chatMessageCount > 0
                      ? `${chatMessageCount} unread message${chatMessageCount === 1 ? "" : "s"}`
                      : "Your portal conversations"}
                </small>
              </div>

              <Link
                aria-label={selectedChatChannel ? "Open this conversation in full chat" : "Open full chat"}
                className="header-chat-open-full"
                href={selectedChatChannel
                  ? `/portal/chat?channel=${selectedChatChannel.channel_id}`
                  : "/portal/chat"}
                onClick={() => setChatOpen(false)}
              >
                Open full chat
              </Link>
            </header>

            {selectedChatChannel ? (
              <>
                <div
                  aria-live="polite"
                  className="header-chat-messages"
                  ref={chatMessagesRef}
                >
                  {chatMessagesLoading && flyoutMessages.length === 0 ? (
                    <p className="header-chat-empty">Loading messages…</p>
                  ) : null}

                  {!chatMessagesLoading && flyoutMessages.length === 0 ? (
                    <p className="header-chat-empty">
                      No messages yet. Start the conversation here.
                    </p>
                  ) : null}

                  {flyoutMessages.map((message) => {
                    const isOwn = message.author_id === profile.id;
                    return (
                      <article
                        className={`header-chat-message${isOwn ? " is-own" : ""}${message.deleted_at ? " is-deleted" : ""}`}
                        key={message.id}
                      >
                        {!isOwn ? (
                          <span className="header-chat-avatar" aria-hidden="true">
                            {message.author_name.slice(0, 1).toUpperCase()}
                          </span>
                        ) : null}
                        <div>
                          <span className="header-chat-message-meta">
                            <strong>{isOwn ? "You" : message.author_name}</strong>
                            <time dateTime={message.created_at}>
                              {formatNotificationDate(message.created_at)}
                            </time>
                          </span>
                          <p>{message.body}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {chatError ? (
                  <p className="header-chat-error" role="alert">{chatError}</p>
                ) : null}

                {selectedChatChannel.channel_type === "applicant_community" ? (
                  <div className="header-chat-threaded-note">
                    <span>This conversation uses topics and replies.</span>
                    <Link
                      href={`/portal/chat?channel=${selectedChatChannel.channel_id}`}
                      onClick={() => setChatOpen(false)}
                    >
                      Reply in full chat
                    </Link>
                  </div>
                ) : (
                  <form className="header-chat-composer" onSubmit={handleChatSubmit}>
                    <label className="sr-only" htmlFor="header-chat-message">
                      Message
                    </label>
                    <textarea
                      id="header-chat-message"
                      maxLength={5000}
                      onChange={(event) => setChatDraft(event.target.value)}
                      placeholder="Write a message…"
                      rows={2}
                      value={chatDraft}
                    />
                    <button
                      disabled={chatSending || chatDraft.trim().length === 0}
                      type="submit"
                    >
                      {chatSending ? "Sending…" : "Send"}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className="header-chat-channel-list">
                {chatLoading && chatChannels.length === 0 ? (
                  <p className="header-chat-empty">Loading conversations…</p>
                ) : null}

                {!chatLoading && chatChannels.length === 0 ? (
                  <p className="header-chat-empty">
                    No conversations are available for this account yet.
                  </p>
                ) : null}

                {chatChannels.map((channel) => (
                  <button
                    className={`header-chat-channel${Number(channel.unread_count) > 0 ? " is-unread" : ""}`}
                    key={channel.channel_id}
                    onClick={() => {
                      setSelectedChatChannelId(channel.channel_id);
                      setChatThreads([]);
                      setChatDraft("");
                      void refreshChatMessages(channel.channel_id);
                    }}
                    type="button"
                  >
                    <span className="header-chat-channel-avatar" aria-hidden="true">
                      {(channel.school_name ?? chatChannelLabel(channel))
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <span className="header-chat-channel-copy">
                      <span>
                        <strong>{chatChannelTitle(channel)}</strong>
                        <time dateTime={channel.last_activity_at}>
                          {formatNotificationDate(channel.last_activity_at)}
                        </time>
                      </span>
                      <small>
                        {channel.latest_author_name
                          ? `${channel.latest_author_name}: `
                          : ""}
                        {channel.latest_message_preview ?? "No messages yet"}
                      </small>
                    </span>
                    {Number(channel.unread_count) > 0 ? (
                      <b>
                        {Number(channel.unread_count) > 99
                          ? "99+"
                          : channel.unread_count}
                      </b>
                    ) : null}
                  </button>
                ))}

                {chatError ? (
                  <p className="header-chat-error" role="alert">{chatError}</p>
                ) : null}
              </div>
            )}
          </section>
        ) : null}
      </div>

      <div className="notification-popover-shell" ref={notificationPopoverRef}>
        <button
          aria-expanded={notificationsOpen}
          aria-haspopup="dialog"
          aria-label={`Notifications. ${notificationCount} unread portal notification${notificationCount === 1 ? "" : "s"}.`}
          className="portal-utility-link portal-utility-link-with-badge"
          onClick={() => {
            const nextOpen = !notificationsOpen;
            setNotificationsOpen(nextOpen);
            setChatOpen(false);
            if (nextOpen) void refreshNotificationList();
          }}
          type="button"
        >
          <BellIcon />
          {bellCount > 0 ? (
            <span className="portal-utility-badge">
              {bellCount > 99 ? "99+" : bellCount}
            </span>
          ) : null}
        </button>

        {notificationsOpen && (
          <section
            aria-label="Notifications"
            className="notification-popover"
            role="dialog"
          >
            <header className="notification-popover-header">
              <div>
                <strong>Notifications</strong>
                <small>
                  {bellCount > 0 ? `${bellCount} unread update${bellCount === 1 ? "" : "s"}` : "You are caught up"}
                </small>
              </div>
              <button
                disabled={unreadNotifications.length === 0}
                onClick={() => void markAllRead()}
                type="button"
              >
                Mark all read
              </button>
            </header>

            <div className="notification-popover-list">
              {notificationsLoading && notifications.length === 0 ? (
                <p className="notification-popover-empty">Loading updates…</p>
              ) : null}

              {notifications.map((notification) => {
                const content = (
                  <>
                    <span className="notification-popover-dot" aria-hidden="true" />
                    <span>
                      <strong>{notification.title}</strong>
                      <p>{notification.body}</p>
                      <small>{formatNotificationDate(notification.created_at)}</small>
                    </span>
                  </>
                );

                return notification.href ? (
                  <Link
                    className={`notification-popover-row${notification.read_at ? "" : " is-unread"}`}
                    href={notification.href}
                    key={notification.id}
                    onClick={() => {
                      void markRead(notification.id);
                      setNotificationsOpen(false);
                    }}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    className={`notification-popover-row${notification.read_at ? "" : " is-unread"}`}
                    key={notification.id}
                    onClick={() => void markRead(notification.id)}
                    type="button"
                  >
                    {content}
                  </button>
                );
              })}

              {!notificationsLoading && notifications.length === 0 ? (
                <p className="notification-popover-empty">New portal updates will appear here.</p>
              ) : null}
            </div>

            <footer className="notification-popover-footer">
              <Link href="/portal/notifications" onClick={() => setNotificationsOpen(false)}>
                View notification history
              </Link>
              <Link href="/portal/feedback" onClick={() => setNotificationsOpen(false)}>
                My requests
              </Link>
            </footer>
          </section>
        )}
      </div>

      <ThemeToggle />

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
