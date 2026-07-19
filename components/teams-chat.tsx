"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  createChatMessage,
  createChatPost,
  createChatReply,
  moderateChatPost,
} from "@/app/portal/chat/actions";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, Profile } from "@/lib/types";

type ChannelType =
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
  last_activity_at: string;
  unread_count: number;
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
};

type ChannelGroup = {
  label: string;
  channels: ChatChannel[];
};

function channelGroupLabel(type: ChannelType) {
  switch (type) {
    case "school":
      return "School staff channels";
    case "school_dm":
      return "School owner DMs";
    case "applicant_community":
      return "Community";
    case "general":
    case "networking":
      return "Staff channels";
    case "advisory_committee":
      return "Committee";
  }
}

function channelIcon(type: ChannelType) {
  switch (type) {
    case "school":
      return "S";
    case "school_dm":
      return "D";
    case "applicant_community":
      return "A";
    case "general":
      return "G";
    case "networking":
      return "N";
    case "advisory_committee":
      return "C";
  }
}

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

function formatTimestamp(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  return new Intl.DateTimeFormat("en-US", {
    month: sameDay ? undefined : "short",
    day: sameDay ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
                ? "chat-mention chat-mention-self"
                : "chat-mention"
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
  required = true,
  className = "textarea",
}: {
  id: string;
  name: string;
  members: ChatMember[];
  placeholder: string;
  rows: number;
  required?: boolean;
  className?: string;
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
    if (suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (current) => (current - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter" && query !== null) {
      event.preventDefault();
      const selected = suggestions[activeIndex];

      if (selected) {
        selectMention(selected);
      }
    } else if (event.key === "Escape") {
      setQuery(null);
      setMentionStart(null);
    }
  };

  return (
    <div className="mention-composer">
      <textarea
        className={className}
        id={id}
        maxLength={5000}
        name={name}
        onChange={(event) => {
          const nextValue = event.target.value;
          const cursor = event.target.selectionStart;
          setValue(nextValue);
          detectMention(nextValue, cursor);
        }}
        onClick={(event) => {
          detectMention(value, event.currentTarget.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        required={required}
        rows={rows}
        value={value}
      />

      {suggestions.length > 0 && (
        <div className="mention-suggestions" role="listbox">
          {suggestions.map((member, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? "mention-suggestion mention-suggestion-active"
                  : "mention-suggestion"
              }
              key={member.user_id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectMention(member)}
              role="option"
              type="button"
            >
              <span className="user-avatar teams-avatar teams-avatar-small">
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

      <small className="mention-help">Type @ to tag someone in this channel.</small>
    </div>
  );
}

function MessageBody({
  children,
  members,
  currentUserId,
}: {
  children: string;
  members: ChatMember[];
  currentUserId: string;
}) {
  return (
    <p className="teams-message-body">
      <MentionedMessage
        body={children}
        currentUserId={currentUserId}
        members={members}
      />
    </p>
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
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedEndRef = useRef<HTMLDivElement>(null);

  const activeChannel = channels.find(
    (channel) => channel.channel_id === selectedChannelId,
  );
  const isThreaded = activeChannel?.channel_type === "applicant_community";

  const groups = useMemo<ChannelGroup[]>(() => {
    const filtered = channels.filter((channel) => {
      const haystack = [
        channel.channel_name,
        channel.school_name,
        channel.production_title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(channelSearch.trim().toLowerCase());
    });

    const labels = [
      "Community",
      "Staff channels",
      "Committee",
      "School channels",
    ];

    return labels
      .map((label) => ({
        label,
        channels: filtered.filter(
          (channel) => channelGroupLabel(channel.channel_type) === label,
        ),
      }))
      .filter((group) => group.channels.length > 0);
  }, [channelSearch, channels]);

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
        },
        ...thread.replies.map((reply) => ({
          id: reply.id,
          body: reply.body,
          created_at: reply.created_at,
          updated_at: reply.updated_at,
          author_id: reply.author_id,
          author_name: reply.author_name,
          author_role: reply.author_role,
        })),
      ])
      .sort(
        (left, right) =>
          new Date(left.created_at).getTime() -
          new Date(right.created_at).getTime(),
      );
  }, [threads]);

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

    if (!threadResult.error) {
      setThreads((threadResult.data ?? []) as ChatThread[]);
    }

    if (!memberResult.error) {
      setMembers((memberResult.data ?? []) as ChatMember[]);
    }

    await supabase.rpc("mark_chat_channel_read", {
      p_channel_id: selectedChannelId,
    });

    setChannels((current) =>
      current.map((channel) =>
        channel.channel_id === selectedChannelId
          ? { ...channel, unread_count: 0 }
          : channel,
      ),
    );
  }, [selectedChannelId, supabase]);

  useEffect(() => {
    if (!selectedChannelId) {
      return;
    }

    const subscription = supabase
      .channel(`chat:${selectedChannelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_posts",
          filter: `channel_id=eq.${selectedChannelId}`,
        },
        () => void loadChannel(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_replies",
          filter: `channel_id=eq.${selectedChannelId}`,
        },
        () => void loadChannel(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [loadChannel, selectedChannelId, supabase]);

  useEffect(() => {
    if (!isThreaded) {
      feedEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [isThreaded, messages.length]);

  const runFormAction = (
    form: HTMLFormElement,
    action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>,
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

  if (!activeChannel) {
    return (
      <section className="panel chat-empty-panel">
        <div className="empty-state">
          <h2>No chat channels are available yet.</h2>
          <p>
            School channels appear after an application is created and an
            applicant or adjudicator is connected to it.
          </p>
        </div>
      </section>
    );
  }

  let channelContent: ReactNode;

  if (isThreaded) {
    channelContent = (
      <>
        <form className="teams-new-post" onSubmit={submitPost}>
          <input
            name="channel_id"
            type="hidden"
            value={activeChannel.channel_id}
          />
          <div className="teams-new-post-heading">
            <span className="user-avatar teams-avatar">
              {initials(profile.full_name ?? profile.email ?? "User")}
            </span>
            <div>
              <strong>Start a new conversation</strong>
              <p>Post a topic, then continue the discussion in its thread.</p>
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
              className="textarea teams-message-textarea"
              id="chat-body"
              members={members}
              name="body"
              placeholder="Write a message to Applicant Community"
              rows={4}
            />
          </div>
          <div className="teams-composer-footer">
            <span>{status}</span>
            <button
              className="button button-dark"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Posting…" : "Post conversation"}
            </button>
          </div>
        </form>

        <div className="teams-thread-feed" aria-live="polite">
          {threads.length === 0 ? (
            <div className="empty-state teams-thread-empty">
              <h2>No conversations yet.</h2>
              <p>Start the first thread in Applicant Community.</p>
            </div>
          ) : (
            threads.map((thread) => (
              <article className="teams-thread-card" key={thread.post_id}>
                <div className="teams-thread-root">
                  <span className="user-avatar teams-avatar">
                    {initials(thread.author_name)}
                  </span>
                  <div className="teams-thread-content">
                    <div className="teams-message-meta">
                      <strong>{thread.author_name}</strong>
                      <span>{roleName(thread.author_role)}</span>
                      <time dateTime={thread.created_at}>
                        {formatTimestamp(thread.created_at)}
                      </time>
                    </div>
                    <div className="teams-thread-subject-row">
                      <h2>{thread.subject}</h2>
                      <div className="teams-thread-badges">
                        {thread.pinned && <span className="badge">Pinned</span>}
                        {thread.locked && <span className="badge">Locked</span>}
                      </div>
                    </div>
                    <MessageBody
                      currentUserId={profile.id}
                      members={members}
                    >
                      {thread.body}
                    </MessageBody>

                    {profile.role === "owner" && (
                      <div className="teams-owner-controls">
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
                      </div>
                    )}
                  </div>
                </div>

                <div className="teams-reply-thread">
                  {thread.replies.map((reply) => (
                    <div className="teams-reply" key={reply.id}>
                      <span className="user-avatar teams-avatar teams-avatar-small">
                        {initials(reply.author_name)}
                      </span>
                      <div>
                        <div className="teams-message-meta">
                          <strong>{reply.author_name}</strong>
                          <span>{roleName(reply.author_role)}</span>
                          <time dateTime={reply.created_at}>
                            {formatTimestamp(reply.created_at)}
                          </time>
                        </div>
                        <MessageBody
                          currentUserId={profile.id}
                          members={members}
                        >
                          {reply.body}
                        </MessageBody>
                      </div>
                    </div>
                  ))}

                  {!thread.locked ? (
                    <form className="teams-reply-form" onSubmit={submitReply}>
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
                    <p className="teams-thread-locked-note">
                      Replies are closed for this conversation.
                    </p>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </>
    );
  } else {
    channelContent = (
      <div className="teams-message-channel">
        <div className="teams-message-feed" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state teams-message-empty">
              <h2>No messages yet.</h2>
              <p>Send the first message in this channel.</p>
            </div>
          ) : (
            messages.map((message) => {
              const ownMessage = message.author_id === profile.id;

              return (
                <article
                  className={
                    ownMessage
                      ? "teams-chat-message teams-chat-message-own"
                      : "teams-chat-message"
                  }
                  key={message.id}
                >
                  {!ownMessage && (
                    <span className="user-avatar teams-avatar">
                      {initials(message.author_name)}
                    </span>
                  )}
                  <div className="teams-chat-message-column">
                    {!ownMessage && (
                      <div className="teams-message-meta">
                        <strong>{message.author_name}</strong>
                        <span>{roleName(message.author_role)}</span>
                      </div>
                    )}
                    <div className="teams-chat-bubble">
                      <MentionedMessage
                        body={message.body}
                        currentUserId={profile.id}
                        members={members}
                      />
                    </div>
                    <time dateTime={message.created_at}>
                      {formatTimestamp(message.created_at)}
                    </time>
                  </div>
                </article>
              );
            })
          )}
          <div ref={feedEndRef} />
        </div>

        <form className="teams-message-composer" onSubmit={submitMessage}>
          <input
            name="channel_id"
            type="hidden"
            value={activeChannel.channel_id}
          />
          <MentionTextarea
            className="textarea teams-message-composer-textarea"
            id="channel-message"
            members={members}
            name="body"
            placeholder={`Message ${activeChannel.channel_name}`}
            rows={2}
          />
          <div className="teams-message-composer-actions">
            <span>{status}</span>
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
    );
  }

  return (
    <div className="teams-chat-shell">
      <aside className="teams-channel-rail">
        <div className="teams-channel-rail-heading">
          <span className="eyebrow">GHSMTA Teams</span>
          <h2>Chat</h2>
          <p>Community threads and channel messages</p>
        </div>

        <div className="teams-channel-search field">
          <label htmlFor="channel-search">Find a channel</label>
          <input
            className="input"
            id="channel-search"
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder="School or channel name"
            type="search"
            value={channelSearch}
          />
        </div>

        <nav className="teams-channel-list" aria-label="Chat channels">
          {groups.map((group) => (
            <section className="teams-channel-group" key={group.label}>
              <h3>{group.label}</h3>
              {group.channels.map((channel) => (
                <Link
                  className={
                    channel.channel_id === selectedChannelId
                      ? "teams-channel-link teams-channel-link-active"
                      : "teams-channel-link"
                  }
                  href={`/portal/chat?channel=${channel.channel_id}`}
                  key={channel.channel_id}
                >
                  <span className="teams-channel-icon" aria-hidden="true">
                    {channelIcon(channel.channel_type)}
                  </span>
                  <span className="teams-channel-link-copy">
                    <strong>{channel.channel_name}</strong>
                    {channel.channel_type === "school" &&
                      channel.production_title && (
                        <small>{channel.production_title}</small>
                      )}
                  </span>
                  {channel.unread_count > 0 && (
                    <span className="teams-unread-badge">
                      {channel.unread_count > 99 ? "99+" : channel.unread_count}
                    </span>
                  )}
                </Link>
              ))}
            </section>
          ))}
        </nav>
      </aside>

      <section className="teams-conversation-panel">
        <header className="teams-channel-header">
          <div>
            <span className="eyebrow">
              {isThreaded ? "Threaded community" : "Channel messages"}
            </span>
            <h1>{activeChannel.channel_name}</h1>
            <p>
              {activeChannel.channel_description ??
                (isThreaded
                  ? "Start topics and continue the discussion in threads."
                  : "A chronological message feed for this channel.")}
            </p>
          </div>

          <label className="teams-mobile-channel-picker">
            <span>Channel</span>
            <select
              className="select"
              onChange={(event) => {
                router.push(`/portal/chat?channel=${event.target.value}`);
              }}
              value={activeChannel.channel_id}
            >
              {channels.map((channel) => (
                <option value={channel.channel_id} key={channel.channel_id}>
                  {channel.channel_name}
                </option>
              ))}
            </select>
          </label>
        </header>

        {channelContent}
      </section>
    </div>
  );
}
