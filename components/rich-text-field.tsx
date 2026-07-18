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
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  disabled?: boolean;
  placeholder?: string;
  helpText?: string;
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

  const syncValue = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    setValue(
      sanitizeRichTextHtml(
        editor.innerHTML,
      ),
    );
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
