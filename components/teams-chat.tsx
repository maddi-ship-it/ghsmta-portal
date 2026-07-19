"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  broadcastToActiveSchoolDms,
  createChatMessage,
  createChatPost,
  createChatReply,
  moderateChatPost,
  ownerDeleteChatMessage,
} from "@/app/portal/chat/actions";
import styles from "@/components/chat-workspace.module.css";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, Profile } from "@/lib/types";

export type ChannelType =
  | "school"
  | "school_dm"
  | "applicant_community"
  | "general"
  | "networking"
  | "advisory_committee";

export type ChatChannel = {
  channel_id: string;
  channel_type: ChannelType;
  channel_name: string;
  channel_description: string | null;
  application_id: string | null;
  school_name: string | null;
  production_title: string | null;
  application_archived: boolean;
  last_activity_at: string;
  unread_count: number;
  latest_message_preview: string | null;
  latest_author_name: string | null;
  channel_group: string;
  channel_group_label: string;
  channel_group_order: number;
  visibility_label: string;
};

export type ChatMember = {
  user_id: string;
  display_name: string;
  user_role: AppRole;
};

export type ChatReply = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  author_name: string;
  author_role: AppRole;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
};

export type ChatThread = {
  post_id: string;
  subject: string;
  body: string;
  pinned: boolean;
  locked: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  author_id: string;
  author_name: string;
  author_role: AppRole;
  post_deleted_at: string | null;
  post_deleted_by: string | null;
  post_deletion_reason: string | null;
  reply_count: number;
  replies: ChatReply[];
};

type FlatMessage = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  author_name: string;
  author_role: AppRole;
  message_kind: "post" | "reply";
  deleted_at: string | null;
  deletion_reason: string | null;
};

type ChannelGroup = {
  key: string;
  label: string;
  order: number;
  channels: ChatChannel[];
  unreadCount: number;
};

type ChatAction = (
  formData: FormData,
) => Promise<{ ok: boolean; error?: string }>;

const GROUP_FALLBACKS: Record<
  ChannelType,
  { key: string; label: string; order: number }
> = {
  applicant_community: { key: "community", label: "Community", order: 10 },
  general: { key: "staff", label: "Staff channels", order: 20 },
  networking: { key: "staff", label: "Staff channels", order: 20 },
  advisory_committee: {
    key: "committee",
    label: "Advisory Committee",
    order: 30,
  },
  school_dm: {
    key: "direct_messages",
    label: "School DMs",
    order: 40,
  },
  school: {
    key: "school_staff",
    label: "School staff channels",
    order: 50,
  },
};

function roleName(role: AppRole) {
  switch (role) {
    case "applicant":
      return "Applicant";
    case "adjudicator":
      return "Adjudicator";
    case "advisory_member":
      return "Advisory Committee";
    case "owner":
      return "Owner";
  }
}

function channelIcon(type: ChannelType) {
  switch (type) {
    case "school":
      return "ST";
    case "school_dm":
      return "DM";
    case "applicant_community":
      return "CO";
    case "general":
      return "GE";
    case "networking":
      return "NW";
    case "advisory_committee":
      return "AC";
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatChannelActivity(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return formatTime(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatFullTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function normalizeChannel(row: Partial<ChatChannel> & Pick<ChatChannel, "channel_id" | "channel_type" | "channel_name">): ChatChannel {
  const fallback = GROUP_FALLBACKS[row.channel_type];
  const archived = Boolean(row.application_archived);

  return {
    channel_id: row.channel_id,
    channel_type: row.channel_type,
    channel_name: row.channel_name,
    channel_description: row.channel_description ?? null,
    application_id: row.application_id ?? null,
    school_name: row.school_name ?? null,
    production_title: row.production_title ?? null,
    application_archived: archived,
    last_activity_at: row.last_activity_at ?? new Date(0).toISOString(),
    unread_count: Number(row.unread_count ?? 0),
    latest_message_preview: row.latest_message_preview ?? null,
    latest_author_name: row.latest_author_name ?? null,
    channel_group: archived
      ? "archived"
      : (row.channel_group ?? fallback.key),
    channel_group_label: archived
      ? "Archived conversations"
      : (row.channel_group_label ?? fallback.label),
    channel_group_order: archived
      ? 60
      : Number(row.channel_group_order ?? fallback.order),
    visibility_label: row.visibility_label ?? "Private channel",
  };
}

function MentionedMessage({
  body,
  members,
  currentUserId,
}: {
  body: string;
  members: ChatMember[];
  currentUserId: string;
}) {
  const mentionNames = members
    .map((member) => member.display_name.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  if (mentionNames.length === 0) {
    return <>{body}</>;
  }

  const pattern = new RegExp(
    `(@(?:${mentionNames.map(escapeRegularExpression).join("|")}))`,
    "gi",
  );

  const memberByMention = new Map(
    members.map((member) => [
      `@${member.display_name}`.toLowerCase(),
      member,
    ]),
  );

  return (
    <>
      {body.split(pattern).map((part, index) => {
        const member = memberByMention.get(part.toLowerCase());

        if (!member) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }

        return (
          <span
            className={
              member.user_id === currentUserId
                ? `${styles.mention} ${styles.mentionSelf}`
                : styles.mention
            }
            key={`${member.user_id}-${index}`}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

function MentionTextarea({
  id,
  name,
  members,
  placeholder,
  rows,
  className,
  submitOnEnter = false,
}: {
  id: string;
  name: string;
  members: ChatMember[];
  placeholder: string;
  rows: number;
  className?: string;
  submitOnEnter?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (query === null) {
      return [];
    }

    const normalized = query.trim().toLowerCase();

    return members
      .filter((member) =>
        member.display_name.toLowerCase().includes(normalized),
      )
      .slice(0, 8);
  }, [members, query]);

  useEffect(() => {
    const form = textareaRef.current?.form;

    if (!form) {
      return;
    }

    const reset = () => {
      setValue("");
      setQuery(null);
      setMentionStart(null);
      setActiveIndex(0);
    };

    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  const detectMention = (nextValue: string, cursor: number) => {
    const beforeCursor = nextValue.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);

    if (!match) {
      setQuery(null);
      setMentionStart(null);
      return;
    }

    setQuery(match[2] ?? "");
    setMentionStart(cursor - (match[2]?.length ?? 0) - 1);
    setActiveIndex(0);
  };

  const selectMention = (member: ChatMember) => {
    const textarea = textareaRef.current;

    if (!textarea || mentionStart === null) {
      return;
    }

    const cursor = textarea.selectionStart;
    const insertion = `@${member.display_name} `;
    const nextValue =
      value.slice(0, mentionStart) + insertion + value.slice(cursor);
    const nextCursor = mentionStart + insertion.length;

    setValue(nextValue);
    setQuery(null);
    setMentionStart(null);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % suggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (current) => (current - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }

      if (event.key === "Enter" && query !== null) {
        event.preventDefault();
        const selected = suggestions[activeIndex];

        if (selected) {
          selectMention(selected);
        }
        return;
      }

      if (event.key === "Escape") {
        setQuery(null);
        setMentionStart(null);
        return;
      }
    }

    if (
      submitOnEnter &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      textareaRef.current?.form?.requestSubmit();
    }
  };

  return (
    <div className={styles.mentionComposer}>
      <textarea
        className={`${className ?? "textarea"} ${styles.textarea}`}
        id={id}
        maxLength={5000}
        name={name}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          detectMention(nextValue, event.target.selectionStart);
        }}
        onClick={(event) =>
          detectMention(value, event.currentTarget.selectionStart)
        }
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        required
        rows={rows}
        value={value}
      />

      {suggestions.length > 0 && (
        <div className={styles.mentionSuggestions} role="listbox">
          {suggestions.map((member, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? `${styles.mentionSuggestion} ${styles.mentionSuggestionActive}`
                  : styles.mentionSuggestion
              }
              key={member.user_id}
              onClick={() => selectMention(member)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span className={`${styles.avatar} ${styles.avatarSmall}`}>
                {initials(member.display_name)}
              </span>
              <span>
                <strong>{member.display_name}</strong>
                <small>{roleName(member.user_role)}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      <small className={styles.mentionHelp}>
        Type @ to tag someone. Press Enter to send; Shift+Enter adds a line.
      </small>
    </div>
  );
}

function ChannelNavigation({
  groups,
  selectedChannelId,
}: {
  groups: ChannelGroup[];
  selectedChannelId: string | null;
}) {
  if (groups.length === 0) {
    return (
      <div className={styles.noChannelResults}>
        No channels match your search.
      </div>
    );
  }

  return (
    <nav className={styles.channelList} aria-label="Chat channels">
      {groups.map((group) => (
        <section className={styles.channelGroup} key={group.key}>
          <div className={styles.channelGroupHeading}>
            <h3>{group.label}</h3>
            {group.unreadCount > 0 && (
              <span>{group.unreadCount > 99 ? "99+" : group.unreadCount}</span>
            )}
          </div>

          <div className={styles.channelGroupItems}>
            {group.channels.map((channel) => {
              const active = channel.channel_id === selectedChannelId;
              const context =
                channel.production_title ??
                channel.latest_message_preview ??
                channel.channel_description;

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? `${styles.channelLink} ${styles.channelLinkActive}`
                      : styles.channelLink
                  }
                  href={`/portal/chat?channel=${channel.channel_id}`}
                  key={channel.channel_id}
                  scroll={false}
                >
                  <span
                    className={`${styles.channelIcon} ${styles[`channelIcon_${channel.channel_type}`]}`}
                    aria-hidden="true"
                  >
                    {channelIcon(channel.channel_type)}
                  </span>

                  <span className={styles.channelCopy}>
                    <span className={styles.channelTitleRow}>
                      <strong>{channel.channel_name}</strong>
                      <time dateTime={channel.last_activity_at}>
                        {formatChannelActivity(channel.last_activity_at)}
                      </time>
                    </span>
                    {context && (
                      <small>
                        {channel.latest_author_name &&
                        channel.latest_message_preview
                          ? `${channel.latest_author_name}: `
                          : ""}
                        {context}
                      </small>
                    )}
                  </span>

                  {channel.unread_count > 0 && (
                    <span className={styles.unreadBadge}>
                      {channel.unread_count > 99
                        ? "99+"
                        : channel.unread_count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

export function TeamsChat({
  profile,
  initialChannels,
  selectedChannelId,
  initialThreads,
  initialMembers,
}: {
  profile: Profile;
  initialChannels: ChatChannel[];
  selectedChannelId: string | null;
  initialThreads: ChatThread[];
  initialMembers: ChatMember[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [channels, setChannels] = useState(initialChannels);
  const [threads, setThreads] = useState(initialThreads);
  const [members, setMembers] = useState(initialMembers);
  const [channelSearch, setChannelSearch] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(() =>
    initialChannels.some(
      (channel) =>
        channel.channel_id === selectedChannelId && channel.application_archived,
    ),
  );
  const [showBroadcastComposer, setShowBroadcastComposer] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedEndRef = useRef<HTMLDivElement>(null);

  const activeChannel = channels.find(
    (channel) => channel.channel_id === selectedChannelId,
  );
  const isThreaded = activeChannel?.channel_type === "applicant_community";

  const archivedChannelCount = useMemo(
    () => channels.filter((channel) => channel.application_archived).length,
    [channels],
  );

  const activeSchoolDmCount = useMemo(
    () =>
      channels.filter(
        (channel) =>
          channel.channel_type === "school_dm" &&
          !channel.application_archived,
      ).length,
    [channels],
  );

  const totalUnread = useMemo(
    () =>
      channels
        .filter((channel) => !channel.application_archived)
        .reduce((sum, channel) => sum + channel.unread_count, 0),
    [channels],
  );

  const groups = useMemo<ChannelGroup[]>(() => {
    const normalizedSearch = channelSearch.trim().toLowerCase();
    const filtered = channels.filter((channel) => {
      if (!showArchived && channel.application_archived) {
        return false;
      }

      if (showUnreadOnly && channel.unread_count === 0) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        channel.channel_name,
        channel.school_name,
        channel.production_title,
        channel.latest_message_preview,
        channel.latest_author_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });

    const grouped = new Map<string, ChannelGroup>();

    for (const channel of filtered) {
      const existing = grouped.get(channel.channel_group);

      if (existing) {
        existing.channels.push(channel);
        existing.unreadCount += channel.unread_count;
      } else {
        grouped.set(channel.channel_group, {
          key: channel.channel_group,
          label: channel.channel_group_label,
          order: channel.channel_group_order,
          channels: [channel],
          unreadCount: channel.unread_count,
        });
      }
    }

    return [...grouped.values()]
      .sort((left, right) => left.order - right.order)
      .map((group) => ({
        ...group,
        channels: group.channels.sort((left, right) => {
          if (left.unread_count > 0 && right.unread_count === 0) {
            return -1;
          }

          if (right.unread_count > 0 && left.unread_count === 0) {
            return 1;
          }

          return (
            new Date(right.last_activity_at).getTime() -
            new Date(left.last_activity_at).getTime()
          );
        }),
      }));
  }, [channelSearch, channels, showArchived, showUnreadOnly]);

  const messages = useMemo<FlatMessage[]>(() => {
    return threads
      .flatMap((thread) => [
        {
          id: thread.post_id,
          body: thread.body,
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          author_id: thread.author_id,
          author_name: thread.author_name,
          author_role: thread.author_role,
          message_kind: "post" as const,
          deleted_at: thread.post_deleted_at,
          deletion_reason: thread.post_deletion_reason,
        },
        ...thread.replies.map((reply) => ({
          id: reply.id,
          body: reply.body,
          created_at: reply.created_at,
          updated_at: reply.updated_at,
          author_id: reply.author_id,
          author_name: reply.author_name,
          author_role: reply.author_role,
          message_kind: "reply" as const,
          deleted_at: reply.deleted_at,
          deletion_reason: reply.deletion_reason,
        })),
      ])
      .sort(
        (left, right) =>
          new Date(left.created_at).getTime() -
          new Date(right.created_at).getTime(),
      );
  }, [threads]);

  const reloadChannels = useCallback(async () => {
    const richResult = await supabase.rpc("get_my_chat_channels_v2");

    if (!richResult.error) {
      setChannels(
        ((richResult.data ?? []) as Array<
          Partial<ChatChannel> &
            Pick<ChatChannel, "channel_id" | "channel_type" | "channel_name">
        >).map(normalizeChannel),
      );
      return;
    }

    const legacyResult = await supabase.rpc("get_my_chat_channels");

    if (!legacyResult.error) {
      setChannels(
        ((legacyResult.data ?? []) as Array<
          Partial<ChatChannel> &
            Pick<ChatChannel, "channel_id" | "channel_type" | "channel_name">
        >).map(normalizeChannel),
      );
    }
  }, [supabase]);

  const loadChannel = useCallback(async () => {
    if (!selectedChannelId) {
      return;
    }

    const [threadResult, memberResult] = await Promise.all([
      supabase.rpc("get_chat_channel_threads", {
        p_channel_id: selectedChannelId,
      }),
      supabase.rpc("get_chat_channel_members", {
        p_channel_id: selectedChannelId,
      }),
    ]);

    if (threadResult.error) {
      setStatus(threadResult.error.message);
      return;
    }

    if (memberResult.error) {
      setStatus(memberResult.error.message);
      return;
    }

    setThreads((threadResult.data ?? []) as ChatThread[]);
    setMembers((memberResult.data ?? []) as ChatMember[]);

    await supabase.rpc("mark_chat_channel_read", {
      p_channel_id: selectedChannelId,
    });

    await reloadChannels();
  }, [reloadChannels, selectedChannelId, supabase]);

  useEffect(() => {
    const subscription = supabase
      .channel(`chat-workspace:${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_posts" },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { channel_id?: string }
            | undefined;

          if (row?.channel_id === selectedChannelId) {
            void loadChannel();
          } else {
            void reloadChannels();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_replies" },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { channel_id?: string }
            | undefined;

          if (row?.channel_id === selectedChannelId) {
            void loadChannel();
          } else {
            void reloadChannels();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [loadChannel, profile.id, reloadChannels, selectedChannelId, supabase]);

  useEffect(() => {
    if (!isThreaded) {
      feedEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [isThreaded, messages.length]);

  const runFormAction = (
    form: HTMLFormElement,
    action: ChatAction,
    successMessage: string,
  ) => {
    const formData = new FormData(form);
    setStatus(null);

    startTransition(async () => {
      const result = await action(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The message could not be sent.");
        return;
      }

      form.reset();
      setStatus(successMessage);
      await loadChannel();
    });
  };

  const submitPost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runFormAction(event.currentTarget, createChatPost, "Conversation posted.");
  };

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runFormAction(event.currentTarget, createChatReply, "Reply sent.");
  };

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runFormAction(event.currentTarget, createChatMessage, "Message sent.");
  };

  const submitBroadcast = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setStatus(null);

    startTransition(async () => {
      const result = await broadcastToActiveSchoolDms(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The broadcast could not be sent.");
        return;
      }

      form.reset();
      setShowBroadcastComposer(false);
      setStatus(
        `Message sent to ${result.count ?? 0} active school ${
          result.count === 1 ? "DM" : "DMs"
        }.`,
      );
      await reloadChannels();
    });
  };

  const moderate = (postId: string, operation: "pin" | "lock") => {
    const formData = new FormData();
    formData.set("post_id", postId);
    formData.set("operation", operation);
    setStatus(null);

    startTransition(async () => {
      const result = await moderateChatPost(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The post could not be updated.");
        return;
      }

      await loadChannel();
    });
  };

  const deleteMessage = (
    messageId: string,
    messageKind: "post" | "reply",
  ) => {
    const reason = window.prompt(
      "Optional deletion reason. The original message will remain in the audit record.",
      "",
    );

    if (reason === null) {
      return;
    }

    const confirmed = window.confirm(
      "Remove this message from the chat? Users will see a deletion placeholder.",
    );

    if (!confirmed) {
      return;
    }

    const formData = new FormData();
    formData.set("message_id", messageId);
    formData.set("message_kind", messageKind);
    formData.set("reason", reason);
    setStatus(null);

    startTransition(async () => {
      const result = await ownerDeleteChatMessage(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The message could not be removed.");
        return;
      }

      setStatus("Message removed. The original remains in the audit record.");
      await loadChannel();
    });
  };

  if (!activeChannel) {
    return (
      <section className={`panel ${styles.emptyPanel}`}>
        <div className="empty-state">
          <h2>No chat channels are available.</h2>
          <p>
            An Owner may need to run migration 018 to rebuild the school DMs
            and panel channels.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.railHeader}>
          <div>
            <span className="eyebrow">Messages</span>
            <h2>Chat workspace</h2>
          </div>
          {totalUnread > 0 && (
            <span className={styles.totalUnread}>
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>

        <div className={styles.filters}>
          <label className="sr-only" htmlFor="channel-search">
            Search channels
          </label>
          <input
            className={`input ${styles.searchInput}`}
            id="channel-search"
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder="Search schools or messages"
            type="search"
            value={channelSearch}
          />
          <div className={styles.filterButtons}>
            <button
              aria-pressed={showUnreadOnly}
              className={
                showUnreadOnly
                  ? `${styles.unreadFilter} ${styles.unreadFilterActive}`
                  : styles.unreadFilter
              }
              onClick={() => setShowUnreadOnly((current) => !current)}
              type="button"
            >
              Unread only
            </button>
            {archivedChannelCount > 0 && (
              <button
                aria-pressed={showArchived}
                className={
                  showArchived
                    ? `${styles.unreadFilter} ${styles.unreadFilterActive}`
                    : styles.unreadFilter
                }
                onClick={() => setShowArchived((current) => !current)}
                type="button"
              >
                {showArchived ? "Hide archived" : `Show archived (${archivedChannelCount})`}
              </button>
            )}
          </div>
          {profile.role === "owner" && (
            <button
              className={styles.broadcastButton}
              disabled={activeSchoolDmCount === 0}
              onClick={() => setShowBroadcastComposer(true)}
              type="button"
            >
              Message all active school DMs
            </button>
          )}
        </div>

        <ChannelNavigation
          groups={groups}
          selectedChannelId={selectedChannelId}
        />
      </aside>

      <section className={styles.conversation}>
        <header className={styles.channelHeader}>
          <div className={styles.channelIdentity}>
            <span
              className={`${styles.headerIcon} ${styles[`channelIcon_${activeChannel.channel_type}`]}`}
              aria-hidden="true"
            >
              {channelIcon(activeChannel.channel_type)}
            </span>
            <div>
              <div className={styles.channelEyebrowRow}>
                <span className="eyebrow">
                  {isThreaded ? "Threaded community" : "Live channel"}
                </span>
                {activeChannel.application_archived && (
                  <span className={styles.archivedBadge}>Archived</span>
                )}
              </div>
              <h1>{activeChannel.channel_name}</h1>
              <p>
                {activeChannel.production_title && (
                  <strong>{activeChannel.production_title} · </strong>
                )}
                {activeChannel.channel_description}
              </p>
            </div>
          </div>

          <div className={styles.headerMeta}>
            <span className={styles.visibilityPill}>
              {activeChannel.visibility_label}
            </span>
            <div className={styles.memberSummary}>
              <div className={styles.memberAvatars} aria-hidden="true">
                {members.slice(0, 4).map((member) => (
                  <span className={styles.memberAvatar} key={member.user_id}>
                    {initials(member.display_name)}
                  </span>
                ))}
              </div>
              <span>
                {members.length} {members.length === 1 ? "member" : "members"}
              </span>
            </div>
          </div>

          <label className={styles.mobilePicker}>
            <span>Conversation</span>
            <select
              className="select"
              onChange={(event) =>
                router.push(`/portal/chat?channel=${event.target.value}`)
              }
              value={activeChannel.channel_id}
            >
              {groups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.channels.map((channel) => (
                    <option value={channel.channel_id} key={channel.channel_id}>
                      {channel.channel_name}
                      {channel.unread_count > 0
                        ? ` (${channel.unread_count} unread)`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </header>

        {status && (
          <div className={styles.statusBanner} role="status">
            {status}
          </div>
        )}

        {isThreaded ? (
          <div className={styles.threadWorkspace}>
            <form className={styles.newThread} onSubmit={submitPost}>
              <div className={styles.newThreadHeading}>
                <span className={styles.avatar}>
                  {initials(profile.full_name ?? profile.email ?? "User")}
                </span>
                <div>
                  <strong>Start a conversation</strong>
                  <p>Post a topic, then continue it as a thread.</p>
                </div>
              </div>

              <div className="field">
                <label htmlFor="chat-subject">Subject</label>
                <input
                  className="input"
                  id="chat-subject"
                  maxLength={180}
                  name="subject"
                  placeholder="What is this conversation about?"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="chat-body">Message</label>
                <MentionTextarea
                  id="chat-body"
                  members={members}
                  name="body"
                  placeholder="Write a message to Community Chat"
                  rows={4}
                />
              </div>

              <div className={styles.composerFooter}>
                <span>Visible to school applicants and GHSMTA Owners.</span>
                <button
                  className="button button-dark"
                  disabled={isPending}
                  type="submit"
                >
                  {isPending ? "Posting…" : "Post conversation"}
                </button>
              </div>
            </form>

            <div className={styles.threadFeed} aria-live="polite">
              {threads.length === 0 ? (
                <div className={`empty-state ${styles.threadEmpty}`}>
                  <h2>No conversations yet.</h2>
                  <p>Start the first Community Chat topic.</p>
                </div>
              ) : (
                threads.map((thread) => (
                  <article
                    className={
                      thread.post_deleted_at
                        ? `${styles.threadCard} ${styles.deletedMessage}`
                        : styles.threadCard
                    }
                    key={thread.post_id}
                  >
                    <div className={styles.threadRoot}>
                      <span className={styles.avatar}>
                        {initials(thread.author_name)}
                      </span>
                      <div className={styles.threadContent}>
                        <div className={styles.messageMeta}>
                          <strong>{thread.author_name}</strong>
                          <span>{roleName(thread.author_role)}</span>
                          <time dateTime={thread.created_at}>
                            {formatFullTimestamp(thread.created_at)}
                          </time>
                        </div>

                        <div className={styles.threadTitleRow}>
                          <h2>{thread.subject}</h2>
                          <div className={styles.threadBadges}>
                            {thread.pinned && <span>Pinned</span>}
                            {thread.locked && <span>Locked</span>}
                          </div>
                        </div>

                        <p className={styles.messageBody}>
                          <MentionedMessage
                            body={thread.body}
                            currentUserId={profile.id}
                            members={members}
                          />
                        </p>

                        {profile.role === "owner" && (
                          <div className={styles.ownerControls}>
                            {!thread.post_deleted_at && (
                              <>
                                <button
                                  className="button button-secondary button-compact"
                                  disabled={isPending}
                                  onClick={() => moderate(thread.post_id, "pin")}
                                  type="button"
                                >
                                  {thread.pinned ? "Unpin" : "Pin"}
                                </button>
                                <button
                                  className="button button-secondary button-compact"
                                  disabled={isPending}
                                  onClick={() => moderate(thread.post_id, "lock")}
                                  type="button"
                                >
                                  {thread.locked ? "Unlock replies" : "Lock replies"}
                                </button>
                                <button
                                  className="button button-secondary button-compact danger-text"
                                  disabled={isPending}
                                  onClick={() => deleteMessage(thread.post_id, "post")}
                                  type="button"
                                >
                                  Delete message
                                </button>
                              </>
                            )}
                            {thread.post_deleted_at && thread.post_deletion_reason && (
                              <small>Reason: {thread.post_deletion_reason}</small>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={styles.replyThread}>
                      {thread.replies.map((reply) => (
                        <div
                          className={
                            reply.deleted_at
                              ? `${styles.reply} ${styles.deletedMessage}`
                              : styles.reply
                          }
                          key={reply.id}
                        >
                          <span
                            className={`${styles.avatar} ${styles.avatarSmall}`}
                          >
                            {initials(reply.author_name)}
                          </span>
                          <div>
                            <div className={styles.messageMeta}>
                              <strong>{reply.author_name}</strong>
                              <span>{roleName(reply.author_role)}</span>
                              <time dateTime={reply.created_at}>
                                {formatFullTimestamp(reply.created_at)}
                              </time>
                            </div>
                            <p className={styles.messageBody}>
                              <MentionedMessage
                                body={reply.body}
                                currentUserId={profile.id}
                                members={members}
                              />
                            </p>
                            {profile.role === "owner" && !reply.deleted_at && (
                              <button
                                className={`${styles.messageDeleteButton} danger-text`}
                                disabled={isPending}
                                onClick={() => deleteMessage(reply.id, "reply")}
                                type="button"
                              >
                                Delete
                              </button>
                            )}
                            {profile.role === "owner" && reply.deletion_reason && (
                              <small className={styles.deletionReason}>
                                Reason: {reply.deletion_reason}
                              </small>
                            )}
                          </div>
                        </div>
                      ))}

                      {!thread.locked ? (
                        <form
                          className={styles.replyForm}
                          onSubmit={submitReply}
                        >
                          <input
                            name="channel_id"
                            type="hidden"
                            value={activeChannel.channel_id}
                          />
                          <input
                            name="post_id"
                            type="hidden"
                            value={thread.post_id}
                          />
                          <label
                            className="sr-only"
                            htmlFor={`reply-${thread.post_id}`}
                          >
                            Reply to {thread.subject}
                          </label>
                          <MentionTextarea
                            id={`reply-${thread.post_id}`}
                            members={members}
                            name="body"
                            placeholder="Reply to this conversation"
                            rows={2}
                            submitOnEnter
                          />
                          <button
                            className="button button-secondary button-compact"
                            disabled={isPending}
                            type="submit"
                          >
                            Reply
                          </button>
                        </form>
                      ) : (
                        <p className={styles.lockedNote}>
                          Replies are closed for this conversation.
                        </p>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className={styles.messageWorkspace}>
            <div className={styles.messageFeed} aria-live="polite">
              {messages.length === 0 ? (
                <div className={`empty-state ${styles.messageEmpty}`}>
                  <h2>No messages yet.</h2>
                  <p>Send the first message in this conversation.</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const ownMessage = message.author_id === profile.id;
                  const previous = messages[index - 1];
                  const showDay =
                    !previous ||
                    new Date(previous.created_at).toDateString() !==
                      new Date(message.created_at).toDateString();

                  return (
                    <Fragment key={message.id}>
                      {showDay && (
                        <div className={styles.dayDivider}>
                          <span>{formatDay(message.created_at)}</span>
                        </div>
                      )}
                      <article
                        className={[
                          styles.chatMessage,
                          ownMessage ? styles.chatMessageOwn : "",
                          message.deleted_at ? styles.deletedMessage : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {!ownMessage && (
                          <span className={styles.avatar}>
                            {initials(message.author_name)}
                          </span>
                        )}
                        <div className={styles.chatMessageColumn}>
                          {!ownMessage && (
                            <div className={styles.messageMeta}>
                              <strong>{message.author_name}</strong>
                              <span>{roleName(message.author_role)}</span>
                            </div>
                          )}
                          <div className={styles.chatBubble}>
                            <MentionedMessage
                              body={message.body}
                              currentUserId={profile.id}
                              members={members}
                            />
                          </div>
                          <div className={styles.messageFooter}>
                            <time dateTime={message.created_at}>
                              {formatTime(message.created_at)}
                            </time>
                            {profile.role === "owner" && !message.deleted_at && (
                              <button
                                className={`${styles.messageDeleteButton} danger-text`}
                                disabled={isPending}
                                onClick={() =>
                                  deleteMessage(message.id, message.message_kind)
                                }
                                type="button"
                              >
                                Delete
                              </button>
                            )}
                            {profile.role === "owner" &&
                              message.deletion_reason && (
                                <small className={styles.deletionReason}>
                                  Reason: {message.deletion_reason}
                                </small>
                              )}
                          </div>
                        </div>
                      </article>
                    </Fragment>
                  );
                })
              )}
              <div ref={feedEndRef} />
            </div>

            <form className={styles.messageComposer} onSubmit={submitMessage}>
              <input
                name="channel_id"
                type="hidden"
                value={activeChannel.channel_id}
              />
              <MentionTextarea
                id="channel-message"
                members={members}
                name="body"
                placeholder={`Message ${activeChannel.channel_name}`}
                rows={2}
                submitOnEnter
              />
              <div className={styles.composerFooter}>
                <span>{activeChannel.visibility_label}</span>
                <button
                  className="button button-dark"
                  disabled={isPending}
                  type="submit"
                >
                  {isPending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          </div>
        )}
      </section>

      {showBroadcastComposer && profile.role === "owner" && (
        <div
          aria-labelledby="broadcast-title"
          aria-modal="true"
          className={styles.modalBackdrop}
          role="dialog"
        >
          <form className={styles.broadcastModal} onSubmit={submitBroadcast}>
            <div className={styles.broadcastModalHeader}>
              <div>
                <span className="eyebrow">Owner broadcast</span>
                <h2 id="broadcast-title">Message every active school DM</h2>
                <p>
                  This creates the same message in {activeSchoolDmCount} active
                  school {activeSchoolDmCount === 1 ? "DM" : "DMs"}. Archived
                  applications are excluded.
                </p>
              </div>
              <button
                aria-label="Close broadcast composer"
                className={styles.modalClose}
                onClick={() => setShowBroadcastComposer(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="field">
              <label htmlFor="broadcast-body">Message</label>
              <textarea
                autoFocus
                className="textarea"
                id="broadcast-body"
                maxLength={5000}
                name="body"
                placeholder="Write the update schools should receive"
                required
                rows={7}
              />
            </div>

            <label className={styles.broadcastConfirm}>
              <input name="confirm" required type="checkbox" />
              <span>
                I understand this sends a separate message to every active
                School Owner DM.
              </span>
            </label>

            <div className={styles.broadcastActions}>
              <button
                className="button button-secondary"
                onClick={() => setShowBroadcastComposer(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button-dark"
                disabled={isPending}
                type="submit"
              >
                {isPending ? "Sending…" : `Send to ${activeSchoolDmCount} DMs`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
