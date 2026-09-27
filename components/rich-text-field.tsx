"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  richTextHasContent,
  sanitizeRichTextHtml,
} from "@/lib/rich-text";
import {
  APPLY_ADJUDICATION_BRAIN_DUMP_EVENT,
  type ApplyAdjudicationBrainDumpDetail,
} from "@/lib/adjudication-brain-dump";

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

  const [value, setValue] =
    useState(initialValue);

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const nextValue =
      sanitizeRichTextHtml(defaultValue);

    if (editor.innerHTML !== nextValue) {
      editor.innerHTML = nextValue;
      setValue(nextValue);
    }
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
      setValue(nextValue);
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
      const assignment = detail?.assignments?.find(
        (item) => item.criterionId === criterionId,
      );
      if (!assignment?.text.trim()) return;

      const addition = sanitizeRichTextHtml(assignment.text);
      const current = sanitizeRichTextHtml(editor.innerHTML);
      const nextValue = richTextHasContent(current)
        ? `${current}${addition}`
        : addition;

      editor.innerHTML = nextValue;
      setValue(nextValue);
      onValueChange?.(nextValue);
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
  }, [disabled, name, onValueChange]);

  const syncValue = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const nextValue = sanitizeRichTextHtml(editor.innerHTML);
    setValue(nextValue);
    onValueChange?.(nextValue);
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
          onBlur={syncValue}
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
