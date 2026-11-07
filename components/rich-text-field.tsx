"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  richTextHasContent,
  richTextToPlainText,
  sanitizeRichTextHtml,
} from "@/lib/rich-text";
import {
  APPLY_ADJUDICATION_BRAIN_DUMP_EVENT,
  type ApplyAdjudicationBrainDumpDetail,
} from "@/lib/adjudication-brain-dump";
import { resolveFocusSafeRemoteUpdate } from "@/lib/focus-safe-remote-value";

type RichTextCommand =
  | "bold"
  | "italic"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "removeFormat";

function toolbarLabel(
  command: RichTextCommand,
) {
  switch (command) {
    case "bold":
      return "Bold";

    case "italic":
      return "Italic";

    case "insertUnorderedList":
      return "Bullets";

    case "insertOrderedList":
      return "Numbered list";

    case "removeFormat":
      return "Clear formatting";
  }
}

export function RichTextField({
  id,
  name,
  label,
  defaultValue = "",
  disabled = false,
  placeholder,
  helpText,
  onValueChange,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  disabled?: boolean;
  placeholder?: string;
  helpText?: string;
  onValueChange?: (value: string) => void;
}) {
  const editorRef =
    useRef<HTMLDivElement>(null);

  const initialValue =
    sanitizeRichTextHtml(defaultValue);
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const onValueChangeRef = useRef(onValueChange);
  const remoteValueRef = useRef(initialValue);

  const [value, setValue] =
    useState(initialValue);
  const [pendingRemoteValue, setPendingRemoteValue] =
    useState<string | null>(null);

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const nextValue =
      sanitizeRichTextHtml(defaultValue);
    const currentValue =
      sanitizeRichTextHtml(editor.innerHTML);
    const decision = resolveFocusSafeRemoteUpdate({
      currentValue,
      dirty: dirtyRef.current,
      focused: focusedRef.current,
      remoteValue: nextValue,
    });

    remoteValueRef.current = nextValue;

    if (decision === "acknowledge") {
      dirtyRef.current = false;
      setPendingRemoteValue(null);
      setValue(nextValue);
      return;
    }

    if (decision === "queue") {
      dirtyRef.current = true;
      setPendingRemoteValue(nextValue);
      return;
    }

    editor.innerHTML = nextValue;
    dirtyRef.current = false;
    setPendingRemoteValue(null);
    setValue(nextValue);
  }, [defaultValue]);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const restoreDraftValue = (event: Event) => {
      const detail = (event as CustomEvent<{ values?: Record<string, string> }>).detail;
      const restoredValue = detail?.values?.[name];

      if (restoredValue === undefined) {
        return;
      }

      const nextValue = sanitizeRichTextHtml(restoredValue);
      editor.innerHTML = nextValue;
      dirtyRef.current = nextValue !== remoteValueRef.current;
      setValue(nextValue);
      onValueChangeRef.current?.(nextValue);
      window.setTimeout(() => {
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }, 0);
    };

    window.addEventListener("ghsmta:offline-draft-restore", restoreDraftValue);

    return () => {
      window.removeEventListener("ghsmta:offline-draft-restore", restoreDraftValue);
    };
  }, [name]);

  useEffect(() => {
    if (!name.startsWith("observation_") || disabled) {
      return;
    }

    const applySortedNotes = (event: Event) => {
      const editor = editorRef.current;
      if (!editor) return;

      const detail = (event as CustomEvent<ApplyAdjudicationBrainDumpDetail>)
        .detail;
      const criterionId = name.slice("observation_".length);
      const assignments = detail?.assignments?.filter(
        (item) => item.criterionId === criterionId,
      );
      if (!assignments?.length) return;

      const current = sanitizeRichTextHtml(editor.innerHTML);
      const existingText = richTextToPlainText(current)
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/\s+/g, " ");
      const additions = assignments
        .map((assignment) => assignment.text.trim())
        .filter(Boolean)
        .filter((text, index, allTexts) => {
          const normalized = text
            .normalize("NFKC")
            .toLocaleLowerCase()
            .replace(/\s+/g, " ");
          return (
            !existingText.includes(normalized) &&
            allTexts.findIndex(
              (candidate) =>
                candidate
                  .normalize("NFKC")
                  .toLocaleLowerCase()
                  .replace(/\s+/g, " ") === normalized,
            ) === index
          );
        })
        .map((text) => sanitizeRichTextHtml(text));
      if (additions.length === 0) return;

      const addition = additions.join("");
      const nextValue = richTextHasContent(current)
        ? `${current}${addition}`
        : addition;

      editor.innerHTML = nextValue;
      dirtyRef.current = nextValue !== remoteValueRef.current;
      setValue(nextValue);
      onValueChangeRef.current?.(nextValue);
      window.setTimeout(() => {
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }, 0);
    };

    window.addEventListener(
      APPLY_ADJUDICATION_BRAIN_DUMP_EVENT,
      applySortedNotes,
    );

    return () => {
      window.removeEventListener(
        APPLY_ADJUDICATION_BRAIN_DUMP_EVENT,
        applySortedNotes,
      );
    };
  }, [disabled, name]);

  const syncValue = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const nextValue = sanitizeRichTextHtml(editor.innerHTML);
    dirtyRef.current = nextValue !== remoteValueRef.current;
    if (!dirtyRef.current) {
      setPendingRemoteValue(null);
    }
    setValue(nextValue);
    onValueChangeRef.current?.(nextValue);
  };

  const loadSavedVersion = () => {
    const editor = editorRef.current;

    if (!editor || pendingRemoteValue === null) {
      return;
    }

    editor.innerHTML = pendingRemoteValue;
    remoteValueRef.current = pendingRemoteValue;
    dirtyRef.current = false;
    setValue(pendingRemoteValue);
    setPendingRemoteValue(null);
    onValueChangeRef.current?.(pendingRemoteValue);
  };

  const runCommand = (
    command: RichTextCommand,
  ) => {
    if (disabled) {
      return;
    }

    editorRef.current?.focus();

    document.execCommand(
      command,
      false,
    );

    syncValue();
  };

  const commands: RichTextCommand[] = [
    "bold",
    "italic",
    "insertUnorderedList",
    "insertOrderedList",
    "removeFormat",
  ];

  return (
    <div className="field rich-text-field">
      <label htmlFor={id}>
        {label}
      </label>

      <div
        className={[
          "rich-text-shell",
          disabled
            ? "rich-text-shell-disabled"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className="rich-text-toolbar"
          role="toolbar"
          aria-label={`${label} formatting`}
        >
          {commands.map((command) => (
            <button
              aria-label={
                toolbarLabel(command)
              }
              className="rich-text-toolbar-button"
              disabled={disabled}
              key={command}
              onClick={() =>
                runCommand(command)
              }
              onMouseDown={(event) =>
                event.preventDefault()
              }
              type="button"
            >
              {command === "bold" && (
                <strong>B</strong>
              )}

              {command === "italic" && (
                <em>I</em>
              )}

              {command ===
                "insertUnorderedList" &&
                "• List"}

              {command ===
                "insertOrderedList" &&
                "1. List"}

              {command ===
                "removeFormat" &&
                "Clear"}
            </button>
          ))}
        </div>

        <div
          aria-describedby={
            pendingRemoteValue !== null
              ? `${id}-remote-update`
              : undefined
          }
          aria-label={label}
          aria-multiline="true"
          className="rich-text-editor"
          contentEditable={!disabled}
          data-empty={
            !richTextHasContent(value)
              ? "true"
              : "false"
          }
          data-placeholder={
            placeholder ??
            "Enter comments"
          }
          id={id}
          onBlur={() => {
            focusedRef.current = false;
            syncValue();
          }}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onInput={syncValue}
          onPaste={(event) => {
            if (disabled) {
              return;
            }

            event.preventDefault();

            const text =
              event.clipboardData.getData(
                "text/plain",
              );

            document.execCommand(
              "insertText",
              false,
              text,
            );

            syncValue();
          }}
          ref={editorRef}
          role="textbox"
          suppressContentEditableWarning
        />
      </div>

      {pendingRemoteValue !== null ? (
        <div
          aria-live="polite"
          className="remote-edit-conflict"
          id={`${id}-remote-update`}
          role="status"
        >
          <span>
            Saved content changed while you were editing. Your draft was kept.
          </span>
          <div className="remote-edit-conflict-actions">
            <button
              className="button button-secondary"
              onClick={() => setPendingRemoteValue(null)}
              type="button"
            >
              Keep my draft
            </button>
            <button
              className="button button-secondary"
              onClick={loadSavedVersion}
              type="button"
            >
              Load saved version
            </button>
          </div>
        </div>
      ) : null}

      <input
        name={name}
        readOnly
        type="hidden"
        value={value}
      />

      {helpText && (
        <small className="field-help">
          {helpText}
        </small>
      )}
    </div>
  );
}
