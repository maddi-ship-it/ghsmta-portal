"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { uploadPortalFiles } from "@/lib/portal-file-client";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

type UnreadCounts = {
  notification_count: number;
  chat_message_count: number;
  chat_channel_count: number;
};

export function PortalUtilities({
  profile,
  initialNotificationCount = 0,
  initialChatMessageCount = 0,
  initialChatChannelCount = 0,
}: {
  profile: Profile;
  initialNotificationCount?: number;
  initialChatMessageCount?: number;
  initialChatChannelCount?: number;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const { data, error: countError } = await supabase.rpc(
      "get_unread_portal_counts",
    );

    if (countError) {
      return;
    }

    const row = (
      Array.isArray(data) ? data[0] : data
    ) as UnreadCounts | null;

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
        () => {
          void refreshUnreadCounts();
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
        },
      )
      .subscribe();

    const onFocus = () => {
      void refreshUnreadCounts();
    };

    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [profile.id, refreshUnreadCounts, supabase]);

  async function submitFeedback(formData: FormData) {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const requestType = String(
        formData.get("request_type") ?? "bug_report",
      ) as "bug_report" | "feature_request";

      const title = String(formData.get("title") ?? "").trim();
      const description = String(
        formData.get("description") ?? "",
      ).trim();

      if (title.length < 3 || description.length < 10) {
        throw new Error(
          "Add a clear title and a detailed description.",
        );
      }

      const { data, error: insertError } = await supabase
        .from("portal_feedback_requests")
        .insert({
          request_type: requestType,
          title,
          description,
          priority: String(formData.get("priority") ?? "normal"),
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          submitted_by: profile.id,
        })
        .select("id")
        .single();

      if (insertError || !data) {
        throw new Error(
          insertError?.message ?? "Could not submit request.",
        );
      }

      const files = formData
        .getAll("files")
        .filter(
          (value): value is File =>
            value instanceof File && value.size > 0,
        );

      if (files.length > 0) {
        await uploadPortalFiles({
          files,
          contextType: requestType,
          contextId: data.id as string,
          userId: profile.id,
          documentType:
            requestType === "bug_report"
              ? "Bug-Report"
              : "Feature-Request",
        });
      }

      setMessage(
        requestType === "bug_report"
          ? "Bug report submitted."
          : "Feature request submitted.",
      );

      router.refresh();
      window.setTimeout(() => setOpen(false), 900);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not submit request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const bellCount = notificationCount + chatChannelCount;

  return (
    <div className="portal-utilities">
      <Link
        className="portal-utility-link portal-utility-link-with-badge"
        href="/portal/notifications"
        aria-label={`Notifications. ${notificationCount} portal notifications and ${chatMessageCount} unread chat messages.`}
      >
        <span aria-hidden="true">🔔</span>
        {bellCount > 0 && (
          <span className="portal-utility-badge">
            {bellCount > 99 ? "99+" : bellCount}
          </span>
        )}
      </Link>

      <button
        className="portal-utility-link"
        onClick={() => setOpen(true)}
        type="button"
        aria-label="Report a bug or request a feature"
      >
        ?
      </button>

      {open && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <div
            className="modal-card feedback-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Portal feedback</span>
                <h2 id="feedback-title">
                  Report an issue or request a feature
                </h2>
              </div>

              <button
                className="modal-close"
                onClick={() => setOpen(false)}
                type="button"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void submitFeedback(new FormData(event.currentTarget));
              }}
            >
              <div className="form-grid two-column-form">
                <div className="field">
                  <label htmlFor="feedback_type">Type</label>
                  <select
                    className="select"
                    id="feedback_type"
                    name="request_type"
                  >
                    <option value="bug_report">Bug report</option>
                    <option value="feature_request">
                      Feature request
                    </option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="feedback_priority">Priority</label>
                  <select
                    className="select"
                    id="feedback_priority"
                    name="priority"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="feedback_title_input">Title</label>
                <input
                  className="input"
                  id="feedback_title_input"
                  name="title"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="feedback_description">
                  Description
                </label>
                <textarea
                  className="textarea"
                  id="feedback_description"
                  name="description"
                  required
                  rows={7}
                  placeholder="What happened, what did you expect, and how can we reproduce it?"
                />
              </div>

              <div className="field">
                <label htmlFor="feedback_files">
                  Screenshot or attachment
                </label>
                <input
                  className="input"
                  id="feedback_files"
                  multiple
                  name="files"
                  type="file"
                />
              </div>

              {error && <div className="form-error">{error}</div>}
              {message && <div className="notice">{message}</div>}

              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Cancel
                </button>

                <button
                  className="button button-dark"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
