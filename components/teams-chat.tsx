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
  createOwnerChatChannel,
  createChatMessage,
  createChatPost,
  createChatReply,
  editChatMessage,
  markChatChannelUnread,
  moderateChatPost,
  ownerDeleteChatMessage,
  startChatDirectMessage,
} from "@/app/portal/chat/actions";
import styles from "@/components/chat-workspace.module.css";
import { RegalConfirmDialog } from "@/components/regal-confirm-dialog";
import {
  ADJUDICATOR_CHANNELS_LABEL,
  SCHOOL_COMMUNITY_CHAT_LABEL,
} from "@/lib/chat-terminology";
import { OWNER_CHAT_SECTIONS } from "@/lib/chat-owner-sections";
import {
  isFeedNearBottom,
  messagesBelongTogether,
  realtimeConnectionLabel,
  type RealtimeConnectionState,
} from "@/lib/chat-presentation";
import { createClient } from "@/lib/supabase/client";
import { isAllowedPortalFile, PORTAL_FILE_ACCEPT } from "@/lib/file-upload-policy";
import type { AppRole, Profile } from "@/lib/types";

export type ChannelType =
  | "school"
  | "school_dm"
  | "scholarship_dm"
  | "applicant_community"
  | "general"
  | "networking"
  | "scheduling"
  | "advisory_committee"
  | "portal_updates"
  | "direct_message"
  | "group_direct_message";

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

export type AdjudicationVisitDetails = {
  scheduleTitle: string;
  dateLabel: string;
  timeLabel: string;
  venueName: string | null;
  venueAddress: string | null;
  arrivalEntrance: string | null;
  parkingInstructions: string | null;
  accessibilityNotes: string | null;
  wifiNetwork: string | null;
  wifiPassword: string | null;
  dayOfContactName: string | null;
  dayOfContactPhone: string | null;
  schoolInstructions: string | null;
};

type MentionSuggestion =
  | {
      kind: "channel";
      id: "channel";
      label: "@channel";
      description: string;
      insertion: "@channel";
    }
  | {
      kind: "urgent";
      id: "urgent";
      label: "@URGENT";
      description: string;
      insertion: "@URGENT";
    }
  | {
      kind: "member";
      id: string;
      label: string;
      description: string;
      insertion: string;
      member: ChatMember;
    };

const EMPTY_THREAD_IDS = new Set<string>();

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
  reply_to_message_id: string | null;
  reply_to_message_kind: "post" | "reply" | null;
  reply_to_author_name: string | null;
  reply_to_body: string | null;
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
  post_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  author_name: string;
  author_role: AppRole;
  message_kind: "post" | "reply";
  deleted_at: string | null;
  deletion_reason: string | null;
  reply_to_message_id: string | null;
  reply_to_message_kind: "post" | "reply" | null;
  reply_to_author_name: string | null;
  reply_to_body: string | null;
};

type ChannelGroup = {
  key: string;
  label: string;
  order: number;
  channels: ChatChannel[];
  unreadCount: number;
};

type SchoolConversationGroup = {
  key: string;
  schoolName: string;
  productionTitle: string | null;
  applicationArchived: boolean;
  channels: ChatChannel[];
  unreadCount: number;
};

type ChatAction = (
  formData: FormData,
) => Promise<{
  ok: boolean;
  error?: string;
  messageId?: string;
  messageKind?: "post" | "reply";
  urgentSmsStatus?:
    | "not_urgent"
    | "queued"
    | "no_recipients"
    | "not_configured"
    | "partial_failure"
    | "failed";
  urgentSmsRecipientCount?: number;
  urgentSmsQueuedCount?: number;
}>;

type ChatReaction = {
  id: string;
  channel_id: string;
  message_kind: "post" | "reply";
  message_id: string;
  user_id: string;
  emoji: string;
};

type ChatAttachment = {
  id: string;
  channel_id: string;
  message_kind: "post" | "reply";
  message_id: string;
  original_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number;
  signed_url?: string;
};

const QUICK_REACTIONS = ["👍", "❤️", "🎉", "✅", "👀", "👏"];
const MORE_REACTIONS = ["😂", "😮", "😢", "🙏", "💡", "⭐", "🚀", "🙌", "💯", "🤔", "🔥", "🎭"];
const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;

function safeFileName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-150) || "attachment";
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ChatFilePicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const removeFile = (fileIndex: number) => {
    const nextFiles = selectedFiles.filter((_, index) => index !== fileIndex);
    setSelectedFiles(nextFiles);

    if (!inputRef.current || typeof DataTransfer === "undefined") return;

    const transfer = new DataTransfer();
    nextFiles.forEach((file) => transfer.items.add(file));
    inputRef.current.files = transfer.files;
  };

  return (
    <div className={styles.filePickerGroup}>
      <label className={styles.filePicker}>
        <span aria-hidden="true">＋</span>
        <span>Attach files</span>
        <input
          accept={PORTAL_FILE_ACCEPT}
          multiple
          name="attachments"
          onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
          ref={inputRef}
          type="file"
        />
        <small>Up to 25 MB each</small>
      </label>
      {selectedFiles.length > 0 && (
        <div className={styles.selectedFiles} aria-live="polite">
          {selectedFiles.map((file, index) => (
            <span key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span>
                <strong>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </span>
              <button
                aria-label={`Remove ${file.name}`}
                onClick={() => removeFile(index)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentList({
  attachments,
}: {
  attachments: ChatAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentList}>
      {attachments.map((attachment) => {
        const isPdf =
          attachment.mime_type === "application/pdf" ||
          attachment.original_name.toLowerCase().endsWith(".pdf");
        return (
          <div className={styles.attachmentCard} key={attachment.id}>
            <a href={attachment.signed_url ?? "#"} rel="noreferrer" target="_blank">
              <span aria-hidden="true">▱</span>
              <span><strong>{attachment.original_name}</strong><small>{formatFileSize(attachment.file_size)}</small></span>
            </a>
            {isPdf && attachment.signed_url && (
              <details className={styles.pdfPreview}>
                <summary>Preview PDF</summary>
                <iframe src={`${attachment.signed_url}#toolbar=0&navpanes=0`} title={`Preview ${attachment.original_name}`} />
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReactionBar({
  reactions,
  currentUserId,
  onToggle,
}: {
  reactions: ChatReaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const grouped = new Map<string, ChatReaction[]>();
  for (const reaction of reactions) {
    const existing = grouped.get(reaction.emoji) ?? [];
    existing.push(reaction);
    grouped.set(reaction.emoji, existing);
  }
  return (
    <div className={styles.reactionBar}>
      {[...grouped.entries()].map(([emoji, entries]) => (
        <button
          aria-label={`${emoji}, ${entries.length} reaction${entries.length === 1 ? "" : "s"}`}
          aria-pressed={entries.some((entry) => entry.user_id === currentUserId)}
          key={emoji}
          onClick={() => onToggle(emoji)}
          type="button"
        >
          {emoji} <span>{entries.length}</span>
        </button>
      ))}
      <details className={styles.reactionPicker} ref={pickerRef}>
        <summary aria-label="Add a reaction">☺</summary>
        <div>
          {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
            <button
              aria-label={`React with ${emoji}`}
              key={emoji}
              onClick={() => {
                onToggle(emoji);
                pickerRef.current?.removeAttribute("open");
              }}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

const GROUP_FALLBACKS: Record<
  ChannelType,
  { key: string; label: string; order: number }
> = {
  portal_updates: { key: "portal_updates", label: "Portal Updates", order: 5 },
  applicant_community: { key: "community", label: "Community", order: 10 },
  scholarship_dm: {
    key: "scholarship_applicants",
    label: "Scholarship Applicants",
    order: 15,
  },
  general: { key: "staff", label: ADJUDICATOR_CHANNELS_LABEL, order: 20 },
  networking: { key: "staff", label: ADJUDICATOR_CHANNELS_LABEL, order: 20 },
  scheduling: { key: "staff", label: ADJUDICATOR_CHANNELS_LABEL, order: 20 },
  advisory_committee: {
    key: "committee",
    label: "Advisory Committee",
    order: 30,
  },
  school_dm: {
    key: "direct_messages",
    label: "School Messaging",
    order: 40,
  },
  direct_message: {
    key: "direct_messages",
    label: "Direct Messages",
    order: 41,
  },
  group_direct_message: {
    key: "direct_messages",
    label: "Direct Messages",
    order: 42,
  },
  school: {
    key: "school_staff",
    label: "Panel Channels",
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
    case "program_manager":
      return "Program Manager";
    case "owner":
      return "Owner";
  }
}

function channelIcon(type: ChannelType) {
  switch (type) {
    case "portal_updates":
      return "UP";
    case "school":
      return "ST";
    case "school_dm":
      return "DM";
    case "scholarship_dm":
      return "SA";
    case "applicant_community":
      return "CO";
    case "general":
      return "GA";
    case "networking":
      return "NW";
    case "scheduling":
      return "SC";
    case "advisory_committee":
      return "AC";
    case "direct_message":
      return "DM";
    case "group_direct_message":
      return "GC";
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

function useDialogFocus<T extends HTMLElement>(
  onClose: () => void,
  active = true,
) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    const dialog = dialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!dialog) return;

    const focusableSelector =
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
    const focusFirstControl = window.requestAnimationFrame(() => {
      (
        dialog.querySelector<HTMLElement>("[autofocus]") ??
        dialog.querySelector<HTMLElement>(focusableSelector)
      )?.focus();
    });

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirstControl);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);

  return dialogRef;
}

function MemberDirectoryDialog({
  allowDirectMessages,
  channel,
  currentUserId,
  error,
  members,
  pending,
  onClose,
  onMessage,
}: {
  allowDirectMessages: boolean;
  channel: ChatChannel;
  currentUserId: string;
  error: string | null;
  members: ChatMember[];
  pending: boolean;
  onClose: () => void;
  onMessage: (member: ChatMember) => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div
      aria-labelledby="chat-members-title"
      aria-modal="true"
      className={styles.modalBackdrop}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <section className={`${styles.broadcastModal} ${styles.memberModal}`}>
        <div className={styles.broadcastModalHeader}>
          <div>
            <span className="eyebrow">Chat members</span>
            <h2 id="chat-members-title">People in {channel.channel_name}</h2>
            <p>
              {members.length} {members.length === 1 ? "person has" : "people have"} access to this chat.
            </p>
          </div>
          <button
            aria-label="Close member list"
            className={styles.modalClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {error && <div className={styles.directoryError} role="alert">{error}</div>}
        <div className={styles.memberList}>
          {members.map((member) => (
            <div className={styles.memberListRow} key={member.user_id}>
              <span className={styles.memberListAvatar} aria-hidden="true">
                {initials(member.display_name)}
              </span>
              <span className={styles.memberListIdentity}>
                <strong>{member.display_name}</strong>
                <small>{roleName(member.user_role)}</small>
              </span>
              {member.user_id === currentUserId ? (
                <span className={styles.memberSelfLabel}>You</span>
              ) : allowDirectMessages && member.user_role !== "applicant" ? (
                <button
                  className="button button-secondary button-compact"
                  disabled={pending}
                  onClick={() => onMessage(member)}
                  type="button"
                >
                  Message
                </button>
              ) : (
                <span className={styles.memberSelfLabel}>Channel only</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DirectMessageDialog({
  contacts,
  error,
  loading,
  pending,
  search,
  onClose,
  onMessage,
  onSearchChange,
}: {
  contacts: ChatMember[];
  error: string | null;
  loading: boolean;
  pending: boolean;
  search: string;
  onClose: () => void;
  onMessage: (member: ChatMember) => void;
  onSearchChange: (value: string) => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div
      aria-labelledby="direct-message-title"
      aria-modal="true"
      className={styles.modalBackdrop}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <section className={`${styles.broadcastModal} ${styles.memberModal}`}>
        <div className={styles.broadcastModalHeader}>
          <div>
            <span className="eyebrow">Direct messages</span>
            <h2 id="direct-message-title">Start a private conversation</h2>
            <p>Choose someone who shares a portal chat with you.</p>
          </div>
          <button
            aria-label="Close direct message picker"
            className={styles.modalClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <label className="sr-only" htmlFor="direct-message-search">
          Search people
        </label>
        <input
          autoFocus
          className={`input ${styles.memberSearch}`}
          id="direct-message-search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by name or role"
          type="search"
          value={search}
        />

        {error && <div className={styles.directoryError} role="alert">{error}</div>}
        {loading ? (
          <div className={styles.memberListEmpty}>Loading people…</div>
        ) : contacts.length === 0 ? (
          <div className={styles.memberListEmpty}>
            No matching people are available to message.
          </div>
        ) : (
          <div className={styles.memberList}>
            {contacts.map((member) => (
              <button
                className={styles.contactListRow}
                disabled={pending}
                key={member.user_id}
                onClick={() => onMessage(member)}
                type="button"
              >
                <span className={styles.memberListAvatar} aria-hidden="true">
                  {initials(member.display_name)}
                </span>
                <span className={styles.memberListIdentity}>
                  <strong>{member.display_name}</strong>
                  <small>{roleName(member.user_role)}</small>
                </span>
                <span className={styles.contactListAction}>Message</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OwnerChannelDialog({
  candidates,
  error,
  pending,
  onClose,
  onCreate,
}: {
  candidates: ChatMember[];
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onCreate: (formData: FormData) => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const filteredCandidates = candidates.filter((candidate) =>
    `${candidate.display_name} ${roleName(candidate.user_role)}`
      .toLowerCase()
      .includes(normalizedSearch),
  );

  return (
    <div
      aria-labelledby="owner-channel-title"
      aria-modal="true"
      className={styles.modalBackdrop}
      role="dialog"
    >
      <form
        className={`${styles.broadcastModal} ${styles.memberModal}`}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(new FormData(event.currentTarget));
        }}
      >
        <div className={styles.broadcastModalHeader}>
          <div>
            <span className="eyebrow">Private channel</span>
            <h2 id="owner-channel-title">Create a new chat channel</h2>
            <p>Name the channel and choose the portal staff who can access it.</p>
          </div>
          <button
            aria-label="Close channel creator"
            className={styles.modalClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="field">
          <label htmlFor="owner-channel-name">Channel name</label>
          <input
            autoFocus
            className="input"
            id="owner-channel-name"
            maxLength={120}
            name="channel_name"
            placeholder="Example: Awards planning"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="owner-channel-description">Description (optional)</label>
          <textarea
            className="textarea"
            id="owner-channel-description"
            maxLength={500}
            name="channel_description"
            placeholder="What this channel is for"
            rows={2}
          />
        </div>
        <div className="field">
          <label htmlFor="owner-channel-section">Sidebar header</label>
          <select
            className="select"
            defaultValue="direct_messages"
            id="owner-channel-section"
            name="sidebar_section"
            required
          >
            {OWNER_CHAT_SECTIONS.map((section) => (
              <option key={section.value} value={section.value}>
                {section.label} — {section.description}
              </option>
            ))}
          </select>
          <small>
            This controls where the channel appears. Only the members you choose
            below can open it.
          </small>
        </div>
        <div className="field">
          <label htmlFor="owner-channel-member-search">Members</label>
          <input
            className={`input ${styles.memberSearch}`}
            id="owner-channel-member-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people by name or role"
            type="search"
            value={search}
          />
        </div>

        {error && <div className={styles.directoryError} role="alert">{error}</div>}
        <div className={styles.memberList}>
          {filteredCandidates.map((candidate) => (
            <label
              className={`${styles.memberListRow} ${styles.ownerChannelMemberRow}`}
              key={candidate.user_id}
            >
              <input name="user_ids" type="checkbox" value={candidate.user_id} />
              <span className={styles.memberListAvatar} aria-hidden="true">
                {initials(candidate.display_name)}
              </span>
              <span className={styles.memberListIdentity}>
                <strong>{candidate.display_name}</strong>
                <small>{roleName(candidate.user_role)}</small>
              </span>
            </label>
          ))}
          {filteredCandidates.length === 0 ? (
            <div className={styles.memberListEmpty}>No matching staff members.</div>
          ) : null}
        </div>

        <div className={styles.broadcastActions}>
          <button className="button button-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button-dark" disabled={pending} type="submit">
            {pending ? "Creating…" : "Create channel"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AdjudicationVisitDetailsDialog({
  channel,
  details,
  onClose,
}: {
  channel: ChatChannel;
  details: AdjudicationVisitDetails | null;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const detailGroups = details
    ? [
        {
          title: "Schedule",
          items: [
            ["Visit", details.scheduleTitle],
            ["Date", details.dateLabel],
            ["Time", details.timeLabel],
          ],
        },
        {
          title: "Venue & arrival",
          items: [
            ["Venue", details.venueName],
            ["Address", details.venueAddress],
            ["Entrance", details.arrivalEntrance],
            ["Parking", details.parkingInstructions],
          ],
        },
        {
          title: "Access & connectivity",
          items: [
            ["Accessibility", details.accessibilityNotes],
            ["Wi-Fi network", details.wifiNetwork],
            ["Wi-Fi password", details.wifiPassword],
          ],
        },
        {
          title: "Day-of contact",
          items: [
            ["Name", details.dayOfContactName],
            ["Phone", details.dayOfContactPhone],
            ["Instructions", details.schoolInstructions],
          ],
        },
      ]
    : [];

  return (
    <div
      aria-labelledby="adjudication-visit-details-title"
      aria-modal="true"
      className={styles.modalBackdrop}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <section className={`${styles.broadcastModal} ${styles.visitDetailsModal}`}>
        <div className={styles.broadcastModalHeader}>
          <div>
            <span className="eyebrow">Adjudication visit details</span>
            <h2 id="adjudication-visit-details-title">
              {channel.school_name ?? channel.channel_name}
            </h2>
            <p>{channel.production_title ?? "Production title not entered"}</p>
          </div>
          <button
            aria-label="Close adjudication visit details"
            className={styles.modalClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {details ? (
          <div className={styles.visitDetailsGrid}>
            {detailGroups.map((group) => (
              <section className={styles.visitDetailsCard} key={group.title}>
                <h3>{group.title}</h3>
                <dl>
                  {group.items.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value || "Not provided"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        ) : (
          <div className={styles.visitDetailsEmpty}>
            No adjudication visit has been confirmed for this school yet.
          </div>
        )}
      </section>
    </div>
  );
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

function messageExcerpt(value: string, limit = 120) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1).trimEnd()}…`
    : normalized;
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
  const mentionTokens = [
    "URGENT",
    "channel",
    ...mentionNames.filter(
      (name) => !["channel", "urgent"].includes(name.toLowerCase()),
    ),
  ];

  const pattern = new RegExp(
    `(@(?:${mentionTokens.map(escapeRegularExpression).join("|")}))`,
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
        if (part.toLowerCase() === "@urgent") {
          return (
            <span
              className={`${styles.mention} ${styles.urgentMention}`}
              key={`urgent-${index}`}
            >
              {part}
            </span>
          );
        }

        if (part.toLowerCase() === "@channel") {
          return (
            <span
              className={`${styles.mention} ${styles.channelMention}`}
              key={`channel-${index}`}
            >
              {part}
            </span>
          );
        }

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
  autoResize = false,
}: {
  id: string;
  name: string;
  members: ChatMember[];
  placeholder: string;
  rows: number;
  className?: string;
  submitOnEnter?: boolean;
  autoResize?: boolean;
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
    const nextSuggestions: MentionSuggestion[] = [];

    if ("channel".includes(normalized)) {
      nextSuggestions.push({
        kind: "channel",
        id: "channel",
        label: "@channel",
        description: "Tag everyone in this chat",
        insertion: "@channel",
      });
    }

    if ("urgent".includes(normalized)) {
      nextSuggestions.push({
        kind: "urgent",
        id: "urgent",
        label: "@URGENT",
        description: "Text all verified members in this chat",
        insertion: "@URGENT",
      });
    }

    nextSuggestions.push(
      ...members
        .filter((member) =>
          member.display_name.toLowerCase().includes(normalized),
        )
        .map((member) => ({
          kind: "member" as const,
          id: member.user_id,
          label: `@${member.display_name}`,
          description: roleName(member.user_role),
          insertion: `@${member.display_name}`,
          member,
        })),
    );

    return nextSuggestions.slice(0, 8);
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
      const textarea = textareaRef.current;
      if (autoResize && textarea) {
        textarea.style.height = "";
        textarea.style.overflowY = "hidden";
      }
    };

    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [autoResize]);

  const resizeTextarea = (textarea: HTMLTextAreaElement) => {
    if (!autoResize) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 180);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  };

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

  const selectMention = (suggestion: MentionSuggestion) => {
    const textarea = textareaRef.current;

    if (!textarea || mentionStart === null) {
      return;
    }

    const cursor = textarea.selectionStart;
    const insertion = `${suggestion.insertion} `;
    const nextValue =
      value.slice(0, mentionStart) + insertion + value.slice(cursor);
    const nextCursor = mentionStart + insertion.length;

    setValue(nextValue);
    setQuery(null);
    setMentionStart(null);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextarea(textarea);
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
          resizeTextarea(event.target);
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
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? `${styles.mentionSuggestion} ${styles.mentionSuggestionActive}`
                  : styles.mentionSuggestion
              }
              key={suggestion.id}
              onClick={() => selectMention(suggestion)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span
                className={
                  suggestion.kind === "channel"
                    ? `${styles.avatar} ${styles.avatarSmall} ${styles.channelMentionAvatar}`
                    : suggestion.kind === "urgent"
                      ? `${styles.avatar} ${styles.avatarSmall} ${styles.urgentMentionAvatar}`
                    : `${styles.avatar} ${styles.avatarSmall}`
                }
              >
                {suggestion.kind === "member"
                  ? initials(suggestion.member.display_name)
                  : suggestion.kind === "urgent"
                    ? "!"
                    : "@"}
              </span>
              <span>
                <strong>{suggestion.label}</strong>
                <small>{suggestion.description}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      <small className={styles.mentionHelp}>
        Type @ to tag someone, @channel, or @URGENT for a text alert. Press Enter to send; Shift+Enter adds a line.
      </small>
    </div>
  );
}

function ChannelNavigation({
  groups,
  selectedChannelId,
  defaultOpenSchoolGroups = false,
  expandSchoolList = false,
  flattenSchoolGroups = false,
  schoolSectionLabel = "Schools",
}: {
  groups: ChannelGroup[];
  selectedChannelId: string | null;
  defaultOpenSchoolGroups?: boolean;
  expandSchoolList?: boolean;
  flattenSchoolGroups?: boolean;
  schoolSectionLabel?: string;
}) {
  const [showAllSchools, setShowAllSchools] = useState(false);
  const { standardGroups, schoolGroups } = splitChannelGroups(groups);
  const activeSchoolGroup = schoolGroups.find((group) =>
    group.channels.some((channel) => channel.channel_id === selectedChannelId),
  );
  const [schoolsOpen, setSchoolsOpen] = useState(Boolean(activeSchoolGroup));
  const prioritizedSchoolKeys = new Set<string>();

  if (activeSchoolGroup) prioritizedSchoolKeys.add(activeSchoolGroup.key);

  schoolGroups
    .filter((group) => group.unreadCount > 0)
    .forEach((group) => prioritizedSchoolKeys.add(group.key));

  [...schoolGroups]
    .sort((left, right) => schoolGroupActivity(right) - schoolGroupActivity(left))
    .forEach((group) => {
      if (prioritizedSchoolKeys.size < 10) prioritizedSchoolKeys.add(group.key);
    });

  const schoolListExpanded = expandSchoolList || showAllSchools;
  const visibleSchoolGroups = schoolListExpanded
    ? schoolGroups
    : schoolGroups.filter((group) => prioritizedSchoolKeys.has(group.key));
  const schoolUnreadCount = schoolGroups.reduce(
    (sum, group) => sum + group.unreadCount,
    0,
  );
  const schoolSectionExpanded = expandSchoolList || schoolsOpen;

  if (groups.length === 0) {
    return (
      <div className={styles.noChannelResults}>
        No channels match your search.
      </div>
    );
  }

  return (
    <nav className={styles.channelList} aria-label="Chat channels">
      {standardGroups.map((group) => (
        <StandardChannelGroupNavigation
          collapsible={
            group.key === "owner_direct_messages" ||
            group.key === "direct_messages"
          }
          forceOpen={expandSchoolList}
          group={group}
          key={group.key}
          selectedChannelId={selectedChannelId}
        />
      ))}

      {schoolGroups.length > 0 && (
        <section className={styles.channelGroup}>
          <button
            aria-expanded={schoolSectionExpanded}
            className={styles.channelGroupDisclosure}
            onClick={() => setSchoolsOpen((current) => !current)}
            type="button"
          >
            <span className={styles.channelGroupDisclosureIcon} aria-hidden="true">
              {schoolSectionExpanded ? "−" : "+"}
            </span>
            <h3>{schoolSectionLabel}</h3>
            {schoolUnreadCount > 0 && (
              <span className={styles.channelGroupDisclosureUnread}>
                {formatUnreadCount(schoolUnreadCount)}
              </span>
            )}
          </button>

          {schoolSectionExpanded && (
            <>
              {flattenSchoolGroups ? (
                <div className={styles.channelGroupItems}>
                  {visibleSchoolGroups.flatMap((group) =>
                    group.channels.map((channel) => (
                      <ChannelNavigationLink
                        channel={channel}
                        groupedBySchool
                        key={channel.channel_id}
                        navigationLabel={
                          channel.channel_type === "school_dm"
                            ? "Messaging"
                            : schoolChannelLabel(channel)
                        }
                        selectedChannelId={selectedChannelId}
                      />
                    )),
                  )}
                </div>
              ) : (
                <div className={styles.schoolGroupList}>
                  {visibleSchoolGroups.map((group) => (
                    <SchoolConversationNavigation
                      defaultOpen={defaultOpenSchoolGroups}
                      group={group}
                      key={group.key}
                      selectedChannelId={selectedChannelId}
                    />
                  ))}
                </div>
              )}

              {!expandSchoolList && schoolGroups.length > 10 && (
                <button
                  aria-expanded={showAllSchools}
                  className={styles.schoolListToggle}
                  onClick={() => setShowAllSchools((current) => !current)}
                  type="button"
                >
                  {showAllSchools
                    ? "Show active, unread & recent schools"
                    : `Show all ${schoolGroups.length} schools`}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </nav>
  );
}

function StandardChannelGroupNavigation({
  collapsible,
  forceOpen,
  group,
  selectedChannelId,
}: {
  collapsible: boolean;
  forceOpen: boolean;
  group: ChannelGroup;
  selectedChannelId: string | null;
}) {
  const [isOpen, setIsOpen] = useState(!collapsible);

  const expanded = !collapsible || forceOpen || isOpen;

  return (
    <section className={styles.channelGroup}>
      {collapsible ? (
        <button
          aria-expanded={expanded}
          className={styles.channelGroupDisclosure}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span className={styles.channelGroupDisclosureIcon} aria-hidden="true">
            {expanded ? "−" : "+"}
          </span>
          <h3>{group.label}</h3>
          {group.unreadCount > 0 && (
            <span className={styles.channelGroupDisclosureUnread}>
              {formatUnreadCount(group.unreadCount)}
            </span>
          )}
        </button>
      ) : (
        <div className={styles.channelGroupHeading}>
          <h3>{group.label}</h3>
          {group.unreadCount > 0 && (
            <span>{formatUnreadCount(group.unreadCount)}</span>
          )}
        </div>
      )}

      {expanded && (
        <div className={styles.channelGroupItems}>
          {group.channels.map((channel) => (
            <ChannelNavigationLink
              channel={channel}
              key={channel.channel_id}
              selectedChannelId={selectedChannelId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function schoolGroupActivity(group: SchoolConversationGroup) {
  return Math.max(
    ...group.channels.map((channel) =>
      new Date(channel.last_activity_at).getTime(),
    ),
  );
}

function isSchoolConversation(channel: ChatChannel) {
  return channel.channel_type === "school" || channel.channel_type === "school_dm";
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : count;
}

function schoolChannelLabel(channel: ChatChannel) {
  return channel.channel_type === "school_dm"
    ? "School Messaging"
    : "Panel Channel";
}

function splitChannelGroups(groups: ChannelGroup[]) {
  const schoolMap = new Map<string, SchoolConversationGroup>();
  const standardGroups = groups
    .map((group) => ({
      ...group,
      channels: group.channels.filter((channel) => !isSchoolConversation(channel)),
    }))
    .filter((group) => group.channels.length > 0)
    .map((group) => ({
      ...group,
      unreadCount: group.channels.reduce(
        (sum, channel) => sum + channel.unread_count,
        0,
      ),
    }));

  for (const channel of groups.flatMap((group) => group.channels)) {
    if (!isSchoolConversation(channel)) continue;

    const key = channel.application_id
      ? `application:${channel.application_id}`
      : channel.school_name
        ? `school:${channel.school_name.toLocaleLowerCase()}`
        : `channel:${channel.channel_id}`;
    const existing = schoolMap.get(key);

    if (existing) {
      existing.channels.push(channel);
      existing.unreadCount += channel.unread_count;
      continue;
    }

    schoolMap.set(key, {
      key,
      schoolName: channel.school_name ?? channel.channel_name,
      productionTitle: channel.production_title,
      applicationArchived: channel.application_archived,
      channels: [channel],
      unreadCount: channel.unread_count,
    });
  }

  const schoolGroups = [...schoolMap.values()]
    .map((group) => ({
      ...group,
      channels: group.channels.sort((left, right) => {
        if (left.channel_type === right.channel_type) return 0;
        return left.channel_type === "school_dm" ? -1 : 1;
      }),
    }))
    .sort((left, right) =>
      left.schoolName.localeCompare(right.schoolName, undefined, {
        sensitivity: "base",
      }),
    );

  return { standardGroups, schoolGroups };
}

function ChannelNavigationLink({
  channel,
  selectedChannelId,
  groupedBySchool = false,
  navigationLabel,
}: {
  channel: ChatChannel;
  selectedChannelId: string | null;
  groupedBySchool?: boolean;
  navigationLabel?: string;
}) {
  const active = channel.channel_id === selectedChannelId;
  const context = groupedBySchool
    ? channel.latest_message_preview ?? channel.channel_description
    : channel.production_title ??
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
          <strong>
            {navigationLabel ??
              (groupedBySchool
                ? schoolChannelLabel(channel)
                : channel.channel_name)}
          </strong>
          <time dateTime={channel.last_activity_at}>
            {formatChannelActivity(channel.last_activity_at)}
          </time>
        </span>
        {context && (
          <small>
            {channel.latest_author_name && channel.latest_message_preview
              ? `${channel.latest_author_name}: `
              : ""}
            {context}
          </small>
        )}
      </span>

      {channel.unread_count > 0 && (
        <span className={styles.unreadBadge}>
          {formatUnreadCount(channel.unread_count)}
        </span>
      )}
    </Link>
  );
}

function SchoolConversationNavigation({
  defaultOpen = false,
  group,
  selectedChannelId,
}: {
  defaultOpen?: boolean;
  group: SchoolConversationGroup;
  selectedChannelId: string | null;
}) {
  const containsActiveChannel = group.channels.some(
    (channel) => channel.channel_id === selectedChannelId,
  );
  const [isOpen, setIsOpen] = useState(
    defaultOpen || containsActiveChannel || group.unreadCount > 0,
  );

  return (
    <section
      className={
        containsActiveChannel
          ? `${styles.schoolGroup} ${styles.schoolGroupActive}`
          : styles.schoolGroup
      }
    >
      <button
        aria-expanded={isOpen}
        className={styles.schoolGroupToggle}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className={styles.schoolGroupChevron} aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
        <span className={styles.schoolGroupCopy}>
          <strong>{group.schoolName}</strong>
          <small>
            {group.productionTitle ?? "School conversations"}
            {group.applicationArchived ? " · Archived" : ""}
          </small>
        </span>
        {group.unreadCount > 0 && (
          <span className={styles.schoolGroupUnread}>
            {formatUnreadCount(group.unreadCount)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.schoolGroupChannels}>
          {group.channels.map((channel) => (
            <ChannelNavigationLink
              channel={channel}
              groupedBySchool
              key={channel.channel_id}
              selectedChannelId={selectedChannelId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function TeamsChat({
  profile,
  initialChannels,
  selectedChannelId,
  initialThreads,
  initialMembers,
  ownerChannelCandidates,
  adjudicationVisitDetails,
  previewMode = false,
}: {
  profile: Profile;
  initialChannels: ChatChannel[];
  selectedChannelId: string | null;
  initialThreads: ChatThread[];
  initialMembers: ChatMember[];
  ownerChannelCandidates: ChatMember[];
  adjudicationVisitDetails: AdjudicationVisitDetails | null;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [channels, setChannels] = useState(initialChannels);
  const [threads, setThreads] = useState(initialThreads);
  const [members, setMembers] = useState(initialMembers);
  const [reactions, setReactions] = useState<ChatReaction[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [channelSearch, setChannelSearch] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [openThreadState, setOpenThreadState] = useState<{
    channelId: string | null;
    ids: Set<string>;
  }>(() => ({ channelId: selectedChannelId, ids: new Set() }));
  const [showArchived, setShowArchived] = useState(() =>
    initialChannels.some(
      (channel) =>
        channel.channel_id === selectedChannelId && channel.application_archived,
    ),
  );
  const [showBroadcastComposer, setShowBroadcastComposer] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showDirectMessagePicker, setShowDirectMessagePicker] = useState(false);
  const [showOwnerChannelCreator, setShowOwnerChannelCreator] = useState(false);
  const [showVisitDetails, setShowVisitDetails] = useState(false);
  const [directMessageContacts, setDirectMessageContacts] = useState<ChatMember[]>([]);
  const [directMessageContactsLoaded, setDirectMessageContactsLoaded] = useState(false);
  const [directMessageSearch, setDirectMessageSearch] = useState("");
  const [directMessageError, setDirectMessageError] = useState<string | null>(null);
  const [ownerChannelError, setOwnerChannelError] = useState<string | null>(null);
  const [loadingDirectMessageContacts, setLoadingDirectMessageContacts] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>(previewMode ? "connected" : "connecting");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<{
    messageId: string;
    messageKind: "post" | "reply";
  } | null>(null);
  const [deletionReason, setDeletionReason] = useState("");
  const [attachmentPickerVersion, setAttachmentPickerVersion] = useState(0);
  const [replyingTo, setReplyingTo] = useState<{
    messageId: string;
    messageKind: "post" | "reply";
    postId: string;
    authorName: string;
    body: string;
  } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    kind: "post" | "reply";
    body: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);
  const broadcastDialogRef = useDialogFocus<HTMLDivElement>(
    () => setShowBroadcastComposer(false),
    showBroadcastComposer,
  );

  const activeChannel = channels.find(
    (channel) => channel.channel_id === selectedChannelId,
  );
  const isThreaded = activeChannel?.channel_type === "applicant_community";
  const isPortalUpdates = activeChannel?.channel_type === "portal_updates";
  const canPostToActiveChannel = !isPortalUpdates || profile.role === "owner";
  const canSeeActiveChannelMembers = !isPortalUpdates || profile.role === "owner";
  const allowDirectMessages = profile.role !== "applicant";
  const activeChannelTitle =
    activeChannel && isSchoolConversation(activeChannel)
      ? (activeChannel.school_name ?? activeChannel.channel_name)
      : (activeChannel?.channel_name ?? "Conversation");
  const openThreadIds =
    openThreadState.channelId === selectedChannelId
      ? openThreadState.ids
      : EMPTY_THREAD_IDS;

  const toggleThreadOpen = useCallback((postId: string) => {
    setOpenThreadState((current) => {
      const currentIds =
        current.channelId === selectedChannelId
          ? current.ids
          : EMPTY_THREAD_IDS;
      const next = new Set(currentIds);

      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }

      return { channelId: selectedChannelId, ids: next };
    });
  }, [selectedChannelId]);

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

  const filteredDirectMessageContacts = useMemo(() => {
    const query = directMessageSearch.trim().toLowerCase();
    if (!query) return directMessageContacts;

    return directMessageContacts.filter((member) =>
      `${member.display_name} ${roleName(member.user_role)}`
        .toLowerCase()
        .includes(query),
    );
  }, [directMessageContacts, directMessageSearch]);

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

  const mobileChannelGroups = useMemo(() => {
    const { standardGroups, schoolGroups } = splitChannelGroups(groups);

    return [
      ...standardGroups.map((group) => ({
        key: group.key,
        label: group.label,
        channels: group.channels.map((channel) => ({
          ...channel,
          navigationLabel: channel.channel_name,
        })),
      })),
      ...schoolGroups.map((group) => ({
        key: group.key,
        label: `${group.schoolName}${group.applicationArchived ? " — Archived" : ""}`,
        channels: group.channels.map((channel) => ({
          ...channel,
          navigationLabel: schoolChannelLabel(channel),
        })),
      })),
    ];
  }, [groups]);

  const messages = useMemo<FlatMessage[]>(() => {
    return threads
      .flatMap((thread) => [
        {
          id: thread.post_id,
          post_id: thread.post_id,
          body: thread.body,
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          author_id: thread.author_id,
          author_name: thread.author_name,
          author_role: thread.author_role,
          message_kind: "post" as const,
          deleted_at: thread.post_deleted_at,
          deletion_reason: thread.post_deletion_reason,
          reply_to_message_id: null,
          reply_to_message_kind: null,
          reply_to_author_name: null,
          reply_to_body: null,
        },
        ...thread.replies.map((reply) => ({
          id: reply.id,
          post_id: thread.post_id,
          body: reply.body,
          created_at: reply.created_at,
          updated_at: reply.updated_at,
          author_id: reply.author_id,
          author_name: reply.author_name,
          author_role: reply.author_role,
          message_kind: "reply" as const,
          deleted_at: reply.deleted_at,
          deletion_reason: reply.deletion_reason,
          reply_to_message_id: reply.reply_to_message_id ?? null,
          reply_to_message_kind: reply.reply_to_message_kind ?? null,
          reply_to_author_name: reply.reply_to_author_name ?? null,
          reply_to_body: reply.reply_to_body ?? null,
        })),
      ])
      .sort(
        (left, right) =>
          new Date(left.created_at).getTime() -
          new Date(right.created_at).getTime(),
      );
  }, [threads]);

  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const scrollToMessage = useCallback((messageId: string) => {
    const target = document.getElementById(`chat-message-${messageId}`);

    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === messageId ? null : current,
      );
    }, 1800);
  }, []);

  const reloadChannels = useCallback(async () => {
    const personalizedResult = await supabase.rpc("get_my_chat_channels_v4");

    if (!personalizedResult.error) {
      setChannels(
        ((personalizedResult.data ?? []) as Array<
          Partial<ChatChannel> &
            Pick<ChatChannel, "channel_id" | "channel_type" | "channel_name">
        >).map(normalizeChannel),
      );
      return;
    }

    const richResult = await supabase.rpc("get_my_chat_channels_v3");

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

  const loadEnhancements = useCallback(async () => {
    if (!selectedChannelId) {
      setReactions([]);
      setAttachments([]);
      return;
    }
    const [reactionResult, attachmentResult] = await Promise.all([
      supabase
        .from("chat_reactions")
        .select("id,channel_id,message_kind,message_id,user_id,emoji")
        .eq("channel_id", selectedChannelId),
      supabase
        .from("chat_attachments")
        .select("id,channel_id,message_kind,message_id,original_name,storage_path,mime_type,file_size")
        .eq("channel_id", selectedChannelId)
        .order("created_at"),
    ]);
    if (reactionResult.error) {
      setStatus(reactionResult.error.message);
      return;
    }
    if (attachmentResult.error) {
      setStatus(attachmentResult.error.message);
      return;
    }
    setReactions((reactionResult.data ?? []) as ChatReaction[]);
    const withUrls = await Promise.all(
      ((attachmentResult.data ?? []) as ChatAttachment[]).map(async (attachment) => {
        const { data } = await supabase.storage
          .from("chat-files")
          .createSignedUrl(attachment.storage_path, 60 * 60);
        return { ...attachment, signed_url: data?.signedUrl };
      }),
    );
    setAttachments(withUrls);
  }, [selectedChannelId, supabase]);

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
    await loadEnhancements();

    await supabase.rpc("mark_chat_channel_read", {
      p_channel_id: selectedChannelId,
    });

    await reloadChannels();
  }, [loadEnhancements, reloadChannels, selectedChannelId, supabase]);

  useEffect(() => {
    if (previewMode) return;
    const timeout = window.setTimeout(() => void loadEnhancements(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadEnhancements, previewMode]);

  useEffect(() => {
    if (previewMode) return;
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reactions" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { channel_id?: string } | undefined;
          if (row?.channel_id === selectedChannelId) void loadEnhancements();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_attachments" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { channel_id?: string } | undefined;
          if (row?.channel_id === selectedChannelId) void loadEnhancements();
        },
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setRealtimeState("connected");
          return;
        }

        if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT" ||
          subscriptionStatus === "CLOSED"
        ) {
          setRealtimeState("reconnecting");
        }
      });

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [
    loadChannel,
    loadEnhancements,
    previewMode,
    profile.id,
    reloadChannels,
    selectedChannelId,
    supabase,
  ]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTo({ top: feed.scrollHeight, behavior });
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    if (isThreaded) return;

    hasInitialScrollRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      scrollToLatest("auto");
      hasInitialScrollRef.current = true;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isThreaded, scrollToLatest, selectedChannelId]);

  useEffect(() => {
    if (isThreaded || !hasInitialScrollRef.current) return;

    const feed = feedRef.current;
    if (!feed) return;

    if (isFeedNearBottom(feed, 220)) {
      scrollToLatest("smooth");
    } else {
      setShowJumpToLatest(true);
    }
  }, [isThreaded, messages.length, scrollToLatest]);

  const uploadAttachments = async (
    files: File[],
    messageId: string,
    messageKind: "post" | "reply",
    channelId: string,
  ) => {
    for (const file of files) {
      const storagePath = `${profile.id}/${channelId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const uploadResult = await supabase.storage
        .from("chat-files")
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadResult.error) throw new Error(uploadResult.error.message);

      const metadataResult = await supabase.from("chat_attachments").insert({
        channel_id: channelId,
        message_kind: messageKind,
        message_id: messageId,
        original_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: profile.id,
      });
      if (metadataResult.error) {
        await supabase.storage.from("chat-files").remove([storagePath]);
        throw new Error(metadataResult.error.message);
      }
    }
  };

  const blockPreviewMutation = () => {
    if (!previewMode) return false;
    setStatus("Sample-data preview only — changes are disabled.");
    return true;
  };

  const toggleReaction = async (
    messageId: string,
    messageKind: "post" | "reply",
    emoji: string,
  ) => {
    if (blockPreviewMutation()) return;
    if (!selectedChannelId) return;
    const existing = reactions.find(
      (reaction) =>
        reaction.message_id === messageId &&
        reaction.message_kind === messageKind &&
        reaction.emoji === emoji &&
        reaction.user_id === profile.id,
    );
    const result = existing
      ? await supabase.from("chat_reactions").delete().eq("id", existing.id)
      : await supabase.from("chat_reactions").insert({
          channel_id: selectedChannelId,
          message_kind: messageKind,
          message_id: messageId,
          emoji,
          user_id: profile.id,
        });
    if (result.error) setStatus(result.error.message);
    await loadEnhancements();
  };

  const runFormAction = (
    form: HTMLFormElement,
    action: ChatAction,
    successMessage: string,
    onSuccess?: () => void,
  ) => {
    if (blockPreviewMutation()) return;
    const formData = new FormData(form);
    const files = formData
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (files.some((file) => file.size > MAX_CHAT_FILE_BYTES)) {
      setStatus("Each chat attachment must be 25 MB or smaller.");
      return;
    }
    if (files.some((file) => !isAllowedPortalFile(file))) {
      setStatus("One or more attachments use an unsupported file type.");
      return;
    }
    if (files.length > 10) {
      setStatus("Attach no more than 10 files to one message.");
      return;
    }
    formData.delete("attachments");
    const channelId = String(formData.get("channel_id") ?? selectedChannelId ?? "");
    const threadPostId = String(formData.get("post_id") ?? "");
    setStatus(null);

    startTransition(async () => {
      const result = await action(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The message could not be sent.");
        return;
      }

      const urgentStatus = (() => {
        if (!result.urgentSmsStatus || result.urgentSmsStatus === "not_urgent") {
          return "";
        }
        if (result.urgentSmsStatus === "queued") {
          const count = result.urgentSmsQueuedCount ?? 0;
          return ` Urgent text alert queued for ${count} verified ${count === 1 ? "member" : "members"}.`;
        }
        if (result.urgentSmsStatus === "partial_failure") {
          return ` Urgent text alert queued for ${result.urgentSmsQueuedCount ?? 0} of ${result.urgentSmsRecipientCount ?? 0} verified members; some texts could not be queued.`;
        }
        if (result.urgentSmsStatus === "no_recipients") {
          return " No other members of this chat have a verified phone number for the urgent text alert.";
        }
        if (result.urgentSmsStatus === "not_configured") {
          return " The urgent tag was added, but Twilio text delivery is not configured yet.";
        }
        return " The urgent text alert could not be queued.";
      })();

      if (files.length > 0 && result.messageId && result.messageKind) {
        try {
          await uploadAttachments(
            files,
            result.messageId,
            result.messageKind,
            channelId,
          );
        } catch (uploadError) {
          setStatus(
            `Message sent.${urgentStatus} A file could not be attached: ${uploadError instanceof Error ? uploadError.message : "upload failed"}`,
          );
          await loadChannel();
          return;
        }
      }
      if (isThreaded && result.messageKind === "post" && result.messageId) {
        setOpenThreadState({
          channelId: selectedChannelId,
          ids: new Set([result.messageId]),
        });
      }
      if (isThreaded && result.messageKind === "reply" && threadPostId) {
        setOpenThreadState((current) => {
          const currentIds =
            current.channelId === selectedChannelId
              ? current.ids
              : EMPTY_THREAD_IDS;

          return {
            channelId: selectedChannelId,
            ids: new Set(currentIds).add(threadPostId),
          };
        });
      }
      form.reset();
      setAttachmentPickerVersion((version) => version + 1);
      setStatus(
        `${files.length > 0 ? `${successMessage} Files attached.` : successMessage}${urgentStatus}`,
      );
      await loadChannel();
      onSuccess?.();
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
    runFormAction(
      event.currentTarget,
      replyingTo ? createChatReply : createChatMessage,
      replyingTo ? "Reply sent." : "Message sent.",
      replyingTo ? () => setReplyingTo(null) : undefined,
    );
  };

  const submitMessageEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runFormAction(
      event.currentTarget,
      editChatMessage,
      "Message updated.",
      () => setEditingMessage(null),
    );
  };

  const submitBroadcast = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blockPreviewMutation()) return;
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
    if (blockPreviewMutation()) return;
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
    if (blockPreviewMutation()) return;
    setDeletionReason("");
    setPendingDeletion({ messageId, messageKind });
  };

  const confirmMessageDeletion = () => {
    if (blockPreviewMutation()) return;
    if (!pendingDeletion) return;
    const formData = new FormData();
    formData.set("message_id", pendingDeletion.messageId);
    formData.set("message_kind", pendingDeletion.messageKind);
    formData.set("reason", deletionReason.trim());
    setStatus(null);

    startTransition(async () => {
      const result = await ownerDeleteChatMessage(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The message could not be removed.");
        return;
      }

      setPendingDeletion(null);
      setDeletionReason("");
      setStatus("Message removed. The original remains in the audit record.");
      await loadChannel();
    });
  };

  const markActiveChannelUnread = () => {
    if (blockPreviewMutation()) return;
    if (!activeChannel) return;
    const formData = new FormData();
    formData.set("channel_id", activeChannel.channel_id);
    setStatus(null);

    startTransition(async () => {
      const result = await markChatChannelUnread(formData);

      if (!result.ok) {
        setStatus(result.error ?? "The chat could not be marked unread.");
        return;
      }

      setStatus("Chat marked unread.");
      await reloadChannels();
    });
  };

  const openDirectMessagePicker = async () => {
    if (blockPreviewMutation()) return;
    if (!allowDirectMessages) {
      setStatus("Applicant conversations must use School Messaging.");
      return;
    }

    setShowMembers(false);
    setShowDirectMessagePicker(true);
    setDirectMessageError(null);

    if (directMessageContactsLoaded) return;

    setLoadingDirectMessageContacts(true);
    const { data, error } = await supabase.rpc(
      "get_chat_direct_message_contacts",
    );
    setLoadingDirectMessageContacts(false);

    if (error) {
      setDirectMessageError(error.message);
      return;
    }

    setDirectMessageContacts((data ?? []) as ChatMember[]);
    setDirectMessageContactsLoaded(true);
  };

  const openMemberDirectory = () => {
    setDirectMessageError(null);
    setShowDirectMessagePicker(false);
    setShowMembers(true);
  };

  const beginDirectMessage = (member: ChatMember) => {
    if (blockPreviewMutation()) return;
    if (!allowDirectMessages || member.user_role === "applicant") {
      setDirectMessageError(
        "Applicant conversations must use School Messaging.",
      );
      return;
    }

    const formData = new FormData();
    formData.set("user_id", member.user_id);
    setDirectMessageError(null);

    startTransition(async () => {
      const result = await startChatDirectMessage(formData);

      if (!result.ok || !result.channelId) {
        setDirectMessageError(
          result.error ?? "The direct message could not be opened.",
        );
        return;
      }

      setShowMembers(false);
      setShowDirectMessagePicker(false);
      setDirectMessageSearch("");
      router.push(`/portal/chat?channel=${result.channelId}`);
      router.refresh();
    });
  };

  const createOwnerChannel = (formData: FormData) => {
    setOwnerChannelError(null);
    startTransition(async () => {
      const result = await createOwnerChatChannel(formData);

      if (!result.ok || !result.channelId) {
        setOwnerChannelError(
          result.error ?? "The channel could not be created.",
        );
        return;
      }

      setShowOwnerChannelCreator(false);
      setStatus("Channel created.");
      router.push(`/portal/chat?channel=${result.channelId}`);
      router.refresh();
    });
  };

  if (!activeChannel) {
    return (
      <section className={`panel ${styles.emptyPanel}`} data-writing-assist="off">
        <div className="empty-state">
          <h2>No chat channels are available.</h2>
          <p>
            An Owner may need to run migration 018 to rebuild the School Messaging
            and panel channels.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.shell} data-writing-assist="off">
      <aside className={styles.rail}>
        <div className={styles.railHeader}>
          <div>
            <span className="eyebrow">Inbox</span>
            <h2>Conversations</h2>
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
            placeholder={
              profile.role === "applicant"
                ? "Search conversations"
                : "Search schools or conversations"
            }
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
          <div className={styles.railActions}>
            {profile.role === "owner" && (
              <button
                className={styles.newMessageButton}
                disabled={isPending}
                onClick={() => {
                  setOwnerChannelError(null);
                  setShowOwnerChannelCreator(true);
                }}
                type="button"
              >
                <span aria-hidden="true">＋</span>
                New channel
              </button>
            )}
            {allowDirectMessages && (
              <button
                className={styles.newMessageButton}
                disabled={isPending}
                onClick={() => void openDirectMessagePicker()}
                type="button"
              >
                <span aria-hidden="true">＋</span>
                New message
              </button>
            )}
            {profile.role === "owner" && (
              <button
                className={`${styles.broadcastButton} ${styles.broadcastAllButton}`}
                disabled={activeSchoolDmCount === 0}
                onClick={() => setShowBroadcastComposer(true)}
                type="button"
              >
                Message all active schools
              </button>
            )}
          </div>
        </div>

        <ChannelNavigation
          defaultOpenSchoolGroups={profile.role === "applicant"}
          expandSchoolList={channelSearch.trim().length > 0 || showUnreadOnly}
          flattenSchoolGroups={profile.role === "applicant"}
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
              <div className={styles.channelHeadingLine}>
                <h1>{activeChannelTitle}</h1>
                {activeChannel.application_archived && (
                  <span className={styles.archivedBadge}>Archived</span>
                )}
                <span
                  aria-live="polite"
                  className={`${styles.realtimeIndicator} ${styles[`realtimeIndicator_${realtimeState}`]}`}
                  role="status"
                >
                  <span aria-hidden="true" />
                  {realtimeConnectionLabel(realtimeState)}
                </span>
              </div>
              <p>
                {activeChannel.production_title && (
                  <strong>{activeChannel.production_title} · </strong>
                )}
                {activeChannel.channel_description}
              </p>
            </div>
          </div>

          <div className={styles.headerMeta}>
            <span
              className={styles.visibilityPill}
              title={activeChannel.visibility_label}
            >
              {activeChannel.visibility_label}
            </span>
            {activeChannel.channel_type === "school" && (
              <button
                className={styles.visitDetailsButton}
                onClick={() => setShowVisitDetails(true)}
                type="button"
              >
                Visit details
              </button>
            )}
            <button
              aria-label="Mark this conversation unread"
              className={`button button-secondary button-compact ${styles.headerActionButton}`}
              disabled={isPending}
              onClick={markActiveChannelUnread}
              type="button"
            >
              Mark unread
            </button>
            {canSeeActiveChannelMembers && (
              <button
                aria-haspopup="dialog"
                className={styles.memberSummary}
                onClick={openMemberDirectory}
                type="button"
              >
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
              </button>
            )}
          </div>

          <div className={styles.mobilePicker}>
            <label htmlFor="mobile-channel-picker">Conversation</label>
            <select
              className="select"
              id="mobile-channel-picker"
              onChange={(event) =>
                router.push(`/portal/chat?channel=${event.target.value}`)
              }
              value={activeChannel.channel_id}
            >
              {mobileChannelGroups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.channels.map((channel) => (
                    <option value={channel.channel_id} key={channel.channel_id}>
                      {channel.navigationLabel}
                      {channel.unread_count > 0
                        ? ` (${channel.unread_count} unread)`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {activeChannel.channel_type === "school" && (
              <button
                className="button button-secondary button-compact"
                onClick={() => setShowVisitDetails(true)}
                type="button"
              >
                Visit details
              </button>
            )}
            <button
              className="button button-secondary button-compact"
              disabled={isPending}
              onClick={markActiveChannelUnread}
              type="button"
            >
              Mark current chat unread
            </button>
            {canSeeActiveChannelMembers && (
              <button
                aria-haspopup="dialog"
                className="button button-secondary button-compact"
                onClick={openMemberDirectory}
                type="button"
              >
                View {members.length} {members.length === 1 ? "member" : "members"}
              </button>
            )}
          </div>
        </header>

        {status && (
          <div className={styles.statusBanner} role="status">
            {status}
          </div>
        )}

        {isThreaded ? (
          <div className={styles.threadWorkspace}>
            <form className={styles.newThread} onSubmit={submitPost}>
              <input
                name="channel_id"
                type="hidden"
                value={activeChannel.channel_id}
              />
              <div className={styles.newThreadHeading}>
                <span className={styles.avatar}>
                  {initials(profile.full_name ?? profile.email ?? "User")}
                </span>
                <div>
                  <strong>Share an update</strong>
                  <p>Post to this group and continue the conversation in comments.</p>
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
                  placeholder={`Write a message to ${SCHOOL_COMMUNITY_CHAT_LABEL}`}
                  rows={4}
                />
              </div>

              <div className={styles.composerFooter}>
                <div><ChatFilePicker key={`thread-files-${attachmentPickerVersion}`} /><span>Visible to school applicants and GHSMTA Owners.</span></div>
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
                  <p>Start the first {SCHOOL_COMMUNITY_CHAT_LABEL} topic.</p>
                </div>
              ) : (
                threads.map((thread) => {
                  const isThreadOpen = openThreadIds.has(thread.post_id);
                  const latestReply = thread.replies[thread.replies.length - 1];
                  const replyTotal = thread.reply_count ?? thread.replies.length;
                  const replyLabel =
                    replyTotal === 1 ? "1 reply" : `${replyTotal} replies`;
                  const threadClassName = [
                    styles.threadCard,
                    isThreadOpen ? styles.threadCardOpen : "",
                    thread.post_deleted_at ? styles.deletedMessage : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  if (!isThreadOpen) {
                    return (
                      <article
                        className={`${threadClassName} ${styles.threadCardCompact}`}
                        key={thread.post_id}
                      >
                        <button
                          aria-controls={`thread-replies-${thread.post_id}`}
                          aria-expanded={false}
                          className={styles.threadCardButton}
                          onClick={() => toggleThreadOpen(thread.post_id)}
                          type="button"
                        >
                          <span
                            className={`${styles.avatar} ${styles.avatarSmall}`}
                          >
                            {initials(thread.author_name)}
                          </span>
                          <span className={styles.threadCardMain}>
                            <span className={styles.threadCardKicker}>
                              <strong>{thread.author_name}</strong>
                              <span>{roleName(thread.author_role)}</span>
                              <time dateTime={thread.created_at}>
                                {formatChannelActivity(thread.created_at)}
                              </time>
                            </span>
                            <span className={styles.threadCardTitle}>
                              <span>{thread.subject}</span>
                              {(thread.pinned || thread.locked) && (
                                <span className={styles.threadBadges}>
                                  {thread.pinned && <span>Pinned</span>}
                                  {thread.locked && <span>Locked</span>}
                                </span>
                              )}
                            </span>
                            <span className={styles.threadCardPreview}>
                              <MentionedMessage
                                body={thread.body}
                                currentUserId={profile.id}
                                members={members}
                              />
                            </span>
                          </span>
                          <span className={styles.threadCardMeta}>
                            <span className={styles.threadCardReplyCount}>
                              {replyLabel}
                            </span>
                            <span>
                              {latestReply
                                ? `Latest: ${latestReply.author_name}`
                                : "Open to reply"}
                            </span>
                            <span className={styles.threadCardOpenCue}>
                              Open
                            </span>
                          </span>
                        </button>
                      </article>
                    );
                  }

                  return (
                    <article className={threadClassName} key={thread.post_id}>
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
                            <div>
                              <h2>{thread.subject}</h2>
                              <small className={styles.threadSummary}>
                                {replyTotal > 0
                                  ? `${replyLabel}${
                                      latestReply
                                        ? ` · latest from ${latestReply.author_name}`
                                        : ""
                                    }`
                                  : "No replies yet"}
                              </small>
                            </div>
                            <div className={styles.threadTitleActions}>
                              {(thread.pinned || thread.locked) && (
                                <div className={styles.threadBadges}>
                                  {thread.pinned && <span>Pinned</span>}
                                  {thread.locked && <span>Locked</span>}
                                </div>
                              )}
                              <button
                                aria-controls={`thread-replies-${thread.post_id}`}
                                aria-expanded={isThreadOpen}
                                className={styles.threadToggleButton}
                                onClick={() => toggleThreadOpen(thread.post_id)}
                                type="button"
                              >
                                <span aria-hidden="true">
                                  {isThreadOpen ? "−" : "+"}
                                </span>
                                {isThreadOpen ? "Collapse" : "Open thread"}
                              </button>
                            </div>
                          </div>

                          {editingMessage?.id === thread.post_id && editingMessage.kind === "post" ? (
                            <form className={styles.inlineEditForm} onSubmit={submitMessageEdit}>
                              <input name="message_id" type="hidden" value={thread.post_id} />
                              <input name="message_kind" type="hidden" value="post" />
                              <textarea autoFocus className="textarea" defaultValue={thread.body} maxLength={5000} name="body" required rows={4} />
                              <div>
                                <button className="button button-dark button-compact" disabled={isPending} type="submit">Save</button>
                                <button className="button button-secondary button-compact" onClick={() => setEditingMessage(null)} type="button">Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <p className={styles.messageBody}>
                              <MentionedMessage body={thread.body} currentUserId={profile.id} members={members} />
                            </p>
                          )}
                          <AttachmentList
                            attachments={attachments.filter(
                              (attachment) =>
                                attachment.message_kind === "post" &&
                                attachment.message_id === thread.post_id,
                            )}
                          />
                          {!thread.post_deleted_at && (
                            <ReactionBar
                              currentUserId={profile.id}
                              onToggle={(emoji) =>
                                void toggleReaction(thread.post_id, "post", emoji)
                              }
                              reactions={reactions.filter(
                                (reaction) =>
                                  reaction.message_kind === "post" &&
                                  reaction.message_id === thread.post_id,
                              )}
                            />
                          )}

                          {!thread.post_deleted_at && thread.author_id === profile.id && (
                            <div className={styles.messageFooter}>
                              <button
                                className={styles.messageActionButton}
                                disabled={isPending}
                                onClick={() => setEditingMessage({ id: thread.post_id, kind: "post", body: thread.body })}
                                type="button"
                              >
                                Edit
                              </button>
                            </div>
                          )}

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
                              {thread.post_deleted_at &&
                                thread.post_deletion_reason && (
                                  <small>
                                    Reason: {thread.post_deletion_reason}
                                  </small>
                                )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        className={styles.replyThread}
                        id={`thread-replies-${thread.post_id}`}
                      >
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
                                {editingMessage?.id === reply.id && editingMessage.kind === "reply" ? (
                                  <form className={styles.inlineEditForm} onSubmit={submitMessageEdit}>
                                    <input name="message_id" type="hidden" value={reply.id} />
                                    <input name="message_kind" type="hidden" value="reply" />
                                    <textarea autoFocus className="textarea" defaultValue={reply.body} maxLength={5000} name="body" required rows={3} />
                                    <div>
                                      <button className="button button-dark button-compact" disabled={isPending} type="submit">Save</button>
                                      <button className="button button-secondary button-compact" onClick={() => setEditingMessage(null)} type="button">Cancel</button>
                                    </div>
                                  </form>
                                ) : (
                                  <p className={styles.messageBody}>
                                    <MentionedMessage body={reply.body} currentUserId={profile.id} members={members} />
                                  </p>
                                )}
                                <AttachmentList
                                  attachments={attachments.filter(
                                    (attachment) =>
                                      attachment.message_kind === "reply" &&
                                      attachment.message_id === reply.id,
                                  )}
                                />
                                {!reply.deleted_at && (
                                  <ReactionBar
                                    currentUserId={profile.id}
                                    onToggle={(emoji) =>
                                      void toggleReaction(reply.id, "reply", emoji)
                                    }
                                    reactions={reactions.filter(
                                      (reaction) =>
                                        reaction.message_kind === "reply" &&
                                        reaction.message_id === reply.id,
                                    )}
                                  />
                                )}
                                {!reply.deleted_at && reply.author_id === profile.id && (
                                  <div className={styles.messageFooter}>
                                    <button
                                      className={styles.messageActionButton}
                                      disabled={isPending}
                                      onClick={() => setEditingMessage({ id: reply.id, kind: "reply", body: reply.body })}
                                      type="button"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )}
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
                                {profile.role === "owner" &&
                                  reply.deletion_reason && (
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
                              <ChatFilePicker key={`reply-files-${thread.post_id}-${attachmentPickerVersion}`} />
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
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className={styles.messageWorkspace}>
            <div
              aria-label={`Messages in ${activeChannelTitle}`}
              className={styles.messageFeed}
              onScroll={(event) => {
                const nearBottom = isFeedNearBottom(event.currentTarget);
                setShowJumpToLatest(!nearBottom);
              }}
              ref={feedRef}
              role="log"
            >
              <div className={styles.messageFeedInner}>
              {messages.length === 0 ? (
                <div className={`empty-state ${styles.messageEmpty}`}>
                  <h2>No messages yet.</h2>
                  <p>Send the first message in this conversation.</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const ownMessage = message.author_id === profile.id;
                  const previous = messages[index - 1];
                  const next = messages[index + 1];
                  const startsGroup = !messagesBelongTogether(previous, message);
                  const endsGroup = !messagesBelongTogether(message, next);
                  const showDay =
                    !previous ||
                    new Date(previous.created_at).toDateString() !==
                      new Date(message.created_at).toDateString();
                  const quotedMessage = message.reply_to_message_id
                    ? messageById.get(message.reply_to_message_id)
                    : undefined;
                  const quotedAuthor =
                    quotedMessage?.author_name ?? message.reply_to_author_name;
                  const quotedBody = quotedMessage?.body ?? message.reply_to_body;
                  const messageAttachments = attachments.filter(
                    (attachment) =>
                      attachment.message_kind === message.message_kind &&
                      attachment.message_id === message.id,
                  );
                  const messageReactions = reactions.filter(
                    (reaction) =>
                      reaction.message_kind === message.message_kind &&
                      reaction.message_id === message.id,
                  );

                  return (
                    <Fragment key={message.id}>
                      {showDay && (
                        <div className={styles.dayDivider}>
                          <span>{formatDay(message.created_at)}</span>
                        </div>
                      )}
                      <article
                        id={`chat-message-${message.id}`}
                        className={[
                          styles.chatMessage,
                          ownMessage ? styles.chatMessageOwn : "",
                          startsGroup ? styles.chatMessageGroupStart : "",
                          endsGroup ? styles.chatMessageGroupEnd : "",
                          highlightedMessageId === message.id
                            ? styles.chatMessageHighlighted
                            : "",
                          message.deleted_at ? styles.deletedMessage : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {!ownMessage && endsGroup ? (
                          <span className={styles.avatar}>
                            {initials(message.author_name)}
                          </span>
                        ) : !ownMessage ? (
                          <span className={styles.avatarSpacer} aria-hidden="true" />
                        ) : null}
                        <div className={styles.chatMessageColumn}>
                          {!ownMessage && startsGroup && (
                            <div className={styles.messageMeta}>
                              <strong>{message.author_name}</strong>
                              <span>{roleName(message.author_role)}</span>
                            </div>
                          )}
                          {editingMessage?.id === message.id && editingMessage.kind === message.message_kind ? (
                            <form className={styles.inlineEditForm} onSubmit={submitMessageEdit}>
                              <input name="message_id" type="hidden" value={message.id} />
                              <input name="message_kind" type="hidden" value={message.message_kind} />
                              <textarea autoFocus className="textarea" defaultValue={message.body} maxLength={5000} name="body" required rows={3} />
                              <div>
                                <button className="button button-dark button-compact" disabled={isPending} type="submit">Save</button>
                                <button className="button button-secondary button-compact" onClick={() => setEditingMessage(null)} type="button">Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <div className={styles.chatBubble}>
                              {quotedAuthor && quotedBody && (
                                <button
                                  className={styles.quotedMessage}
                                  disabled={!quotedMessage}
                                  onClick={() =>
                                    quotedMessage && scrollToMessage(quotedMessage.id)
                                  }
                                  type="button"
                                >
                                  <strong>{quotedAuthor}</strong>
                                  <span>{messageExcerpt(quotedBody)}</span>
                                </button>
                              )}
                              <div className={styles.messageBody}>
                                <MentionedMessage
                                  body={message.body}
                                  currentUserId={profile.id}
                                  members={members}
                                />
                              </div>
                              <AttachmentList attachments={messageAttachments} />
                            </div>
                          )}
                          {!message.deleted_at && (
                            <ReactionBar
                              currentUserId={profile.id}
                              onToggle={(emoji) => void toggleReaction(message.id, message.message_kind, emoji)}
                              reactions={messageReactions}
                            />
                          )}
                          <div className={styles.messageFooter}>
                            {endsGroup && (
                              <time dateTime={message.created_at}>
                                {formatTime(message.created_at)}
                              </time>
                            )}
                            {!message.deleted_at && (
                              <details className={styles.messageMenu}>
                                <summary aria-label="Message actions">•••</summary>
                                <div>
                                  {canPostToActiveChannel && (
                                    <button
                                      disabled={isPending}
                                      onClick={() =>
                                        setReplyingTo({
                                          messageId: message.id,
                                          messageKind: message.message_kind,
                                          postId: message.post_id,
                                          authorName: message.author_name,
                                          body: message.body,
                                        })
                                      }
                                      type="button"
                                    >
                                      Reply
                                    </button>
                                  )}
                                  {ownMessage && (
                                    <button
                                      disabled={isPending}
                                      onClick={() =>
                                        setEditingMessage({
                                          id: message.id,
                                          kind: message.message_kind,
                                          body: message.body,
                                        })
                                      }
                                      type="button"
                                    >
                                      Edit
                                    </button>
                                  )}
                                  {profile.role === "owner" && (
                                    <button
                                      className="danger-text"
                                      disabled={isPending}
                                      onClick={() =>
                                        deleteMessage(
                                          message.id,
                                          message.message_kind,
                                        )
                                      }
                                      type="button"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </details>
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
              </div>
            </div>

            {showJumpToLatest && (
              <button
                className={styles.jumpToLatest}
                onClick={() => scrollToLatest()}
                type="button"
              >
                <span aria-hidden="true">↓</span>
                Jump to latest
              </button>
            )}

            {canPostToActiveChannel ? (
            <form className={styles.messageComposer} onSubmit={submitMessage}>
              <input
                name="channel_id"
                type="hidden"
                value={activeChannel.channel_id}
              />
              {replyingTo && (
                <>
                  <input name="post_id" type="hidden" value={replyingTo.postId} />
                  <input
                    name="reply_to_message_id"
                    type="hidden"
                    value={replyingTo.messageId}
                  />
                  <input
                    name="reply_to_message_kind"
                    type="hidden"
                    value={replyingTo.messageKind}
                  />
                  <div className={styles.composerReplyPreview}>
                    <div>
                      <strong>Replying to {replyingTo.authorName}</strong>
                      <span>{messageExcerpt(replyingTo.body)}</span>
                    </div>
                    <button
                      aria-label="Cancel reply"
                      onClick={() => setReplyingTo(null)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </>
              )}
              <div className={styles.composerSurface}>
                <MentionTextarea
                  autoResize
                  className={styles.composerTextarea}
                  id="channel-message"
                  members={members}
                  name="body"
                  placeholder={
                    replyingTo
                      ? `Reply to ${replyingTo.authorName}`
                      : `Message ${activeChannelTitle}`
                  }
                  rows={2}
                  submitOnEnter
                />
                <div className={styles.composerFooter}>
                  <div>
                    <ChatFilePicker key={`message-files-${attachmentPickerVersion}`} />
                    <span>{activeChannel.visibility_label}</span>
                  </div>
                  <button
                    aria-label={replyingTo ? "Send reply" : "Send message"}
                    className={styles.sendButton}
                    disabled={isPending}
                    type="submit"
                  >
                    {isPending ? "…" : <span aria-hidden="true">↑</span>}
                  </button>
                </div>
              </div>
            </form>
            ) : (
              <div className={styles.readOnlyComposer}>
                <strong>Portal Updates is read-only.</strong>
                <span>Only GHSMTA Owners can post. New updates will appear here automatically.</span>
              </div>
            )}
          </div>
        )}
      </section>

      {showMembers && canSeeActiveChannelMembers && (
        <MemberDirectoryDialog
          allowDirectMessages={allowDirectMessages}
          channel={activeChannel}
          currentUserId={profile.id}
          error={directMessageError}
          members={members}
          onClose={() => setShowMembers(false)}
          onMessage={beginDirectMessage}
          pending={isPending}
        />
      )}

      {showDirectMessagePicker && allowDirectMessages && (
        <DirectMessageDialog
          contacts={filteredDirectMessageContacts}
          error={directMessageError}
          loading={loadingDirectMessageContacts}
          onClose={() => {
            setShowDirectMessagePicker(false);
            setDirectMessageError(null);
            setDirectMessageSearch("");
          }}
          onMessage={beginDirectMessage}
          onSearchChange={setDirectMessageSearch}
          pending={isPending}
          search={directMessageSearch}
        />
      )}

      {showOwnerChannelCreator && profile.role === "owner" && (
        <OwnerChannelDialog
          candidates={ownerChannelCandidates}
          error={ownerChannelError}
          onClose={() => {
            setShowOwnerChannelCreator(false);
            setOwnerChannelError(null);
          }}
          onCreate={createOwnerChannel}
          pending={isPending}
        />
      )}

      {showVisitDetails && activeChannel.channel_type === "school" && (
        <AdjudicationVisitDetailsDialog
          channel={activeChannel}
          details={adjudicationVisitDetails}
          onClose={() => setShowVisitDetails(false)}
        />
      )}

      {showBroadcastComposer && profile.role === "owner" && (
        <div
          aria-labelledby="broadcast-title"
          aria-modal="true"
          className={styles.modalBackdrop}
          ref={broadcastDialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <form className={styles.broadcastModal} onSubmit={submitBroadcast}>
            <div className={styles.broadcastModalHeader}>
              <div>
                <span className="eyebrow">Owner broadcast</span>
                <h2 id="broadcast-title">Message every active School Messaging</h2>
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
                School Messaging.
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
      <RegalConfirmDialog
        confirmLabel="Remove message"
        description="Users will see a deletion placeholder. The original message remains available in the Owner audit record."
        destructive
        onCancel={() => {
          setPendingDeletion(null);
          setDeletionReason("");
        }}
        onConfirm={confirmMessageDeletion}
        open={Boolean(pendingDeletion)}
        pending={isPending}
        title="Remove this message from chat?"
      >
        <div className="field regal-dialog-reason">
          <label htmlFor="chat-deletion-reason">Deletion reason (optional)</label>
          <textarea
            className="textarea"
            id="chat-deletion-reason"
            maxLength={500}
            onChange={(event) => setDeletionReason(event.target.value)}
            placeholder="Add context for the audit record"
            rows={3}
            value={deletionReason}
          />
        </div>
      </RegalConfirmDialog>
    </div>
  );
}
