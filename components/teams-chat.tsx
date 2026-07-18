"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  createChatPost,
  createChatReply,
  moderateChatPost,
} from "@/app/portal/chat/actions";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, Profile } from "@/lib/types";

type ChannelType =
  | "school"
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

type ChannelGroup = {
  label: string;
  channels: ChatChannel[];
};

function channelGroupLabel(type: ChannelType) {
  switch (type) {
    case "school":
      return "School channels";
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

export function TeamsChat({
  profile,
  initialChannels,
  selectedChannelId,
  initialThreads,
}: {
  profile: Profile;
  initialChannels: ChatChannel[];
  selectedChannelId: string | null;
  initialThreads: ChatThread[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [channels, setChannels] = useState(initialChannels);
  const [threads, setThreads] = useState(initialThreads);
  const [channelSearch, setChannelSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeChannel = channels.find(
    (channel) => channel.channel_id === selectedChannelId,
  );

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

  const loadThreads = useCallback(async () => {
    if (!selectedChannelId) {
      return;
    }

    const { data, error } = await supabase.rpc(
      "get_chat_channel_threads",
      { p_channel_id: selectedChannelId },
    );

    if (!error) {
      setThreads((data ?? []) as ChatThread[]);
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
    }
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
        () => void loadThreads(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_replies",
          filter: `channel_id=eq.${selectedChannelId}`,
        },
        () => void loadThreads(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [loadThreads, selectedChannelId, supabase]);

  const submitPost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setStatus(null);

    startTransition(async () => {
      const result = await createChatPost(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The conversation could not be posted.");
        return;
      }

      form.reset();
      setStatus("Conversation posted.");
      await loadThreads();
    });
  };

  const submitReply = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setStatus(null);

    startTransition(async () => {
      const result = await createChatReply(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The reply could not be sent.");
        return;
      }

      form.reset();
      setStatus("Reply sent.");
      await loadThreads();
    });
  };

  const moderate = (
    postId: string,
    operation: "pin" | "lock",
  ) => {
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

      await loadThreads();
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

  return (
    <div className="teams-chat-shell">
      <aside className="teams-channel-rail">
        <div className="teams-channel-rail-heading">
          <span className="eyebrow">GHSMTA Teams</span>
          <h2>Chat</h2>
          <p>Channels and threaded conversations</p>
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
              {channelGroupLabel(activeChannel.channel_type)}
            </span>
            <h1>{activeChannel.channel_name}</h1>
            <p>
              {activeChannel.channel_description ??
                "Threaded GHSMTA portal conversation"}
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

        <form className="teams-new-post" onSubmit={submitPost}>
          <input
            name="channel_id"
            type="hidden"
            value={activeChannel.channel_id}
          />
          <div className="teams-new-post-heading">
            <div>
              <span className="user-avatar teams-avatar">
                {initials(profile.full_name ?? profile.email ?? "User")}
              </span>
            </div>
            <div>
              <strong>Start a new conversation</strong>
              <p>Post an update or question, then continue in the thread.</p>
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
            <textarea
              className="textarea teams-message-textarea"
              id="chat-body"
              maxLength={5000}
              name="body"
              placeholder="Write a message to this channel"
              required
              rows={4}
            />
          </div>
          <div className="teams-composer-footer">
            <span>{status}</span>
            <button className="button button-dark" disabled={isPending} type="submit">
              {isPending ? "Posting…" : "Post conversation"}
            </button>
          </div>
        </form>

        <div className="teams-thread-feed" aria-live="polite">
          {threads.length === 0 ? (
            <div className="empty-state teams-thread-empty">
              <h2>No conversations yet.</h2>
              <p>Start the first thread in this channel.</p>
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
                    <p className="teams-message-body">{thread.body}</p>

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
                        <p className="teams-message-body">{reply.body}</p>
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
                      <input name="post_id" type="hidden" value={thread.post_id} />
                      <label className="sr-only" htmlFor={`reply-${thread.post_id}`}>
                        Reply to {thread.subject}
                      </label>
                      <textarea
                        className="textarea"
                        id={`reply-${thread.post_id}`}
                        maxLength={5000}
                        name="body"
                        placeholder="Reply to this conversation"
                        required
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
      </section>
    </div>
  );
}
