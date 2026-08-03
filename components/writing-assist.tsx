"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import styles from "./writing-assist.module.css";

type WritableTarget = HTMLTextAreaElement | HTMLDivElement;
type AssistMode = "idle" | "recording" | "processing";

function isWritableTarget(element: Element | null): element is WritableTarget {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  return element instanceof HTMLDivElement && element.isContentEditable;
}

function chooseMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function setTextareaValue(target: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

export function WritingAssist() {
  const rootRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<WritableTarget | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<AssistMode>("idle");
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<"Voice dictation" | "Handwritten notes">("Voice dictation");
  const [error, setError] = useState("");

  useEffect(() => {
    const handleFocus = (event: FocusEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (rootRef.current?.contains(element)) return;
      if (isWritableTarget(element)) {
        targetRef.current = element;
        setVisible(true);
        setError("");
      } else {
        setVisible(false);
      }
    };
    document.addEventListener("focusin", handleFocus);
    return () => document.removeEventListener("focusin", handleFocus);
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => releaseStream(), [releaseStream]);

  const transcribeRecording = useCallback(async (blob: Blob) => {
    setMode("processing");
    const body = new FormData();
    body.set("audio", new File([blob], "dictation.webm", { type: blob.type || "audio/webm" }));
    try {
      const response = await fetch("/api/writing-assist/transcribe", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok || !payload?.text) throw new Error(payload?.error || "Dictation failed.");
      setSource("Voice dictation");
      setDraft(payload.text);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dictation failed.");
    } finally {
      setMode("idle");
    }
  }, []);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = chooseMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        releaseStream();
        if (blob.size > 0) void transcribeRecording(blob);
      };
      recorder.start();
      setError("");
      setMode("recording");
    } catch (recordError) {
      releaseStream();
      setError(recordError instanceof Error ? recordError.message : "Microphone access was denied.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const scanImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image) return;
    if (image.size > 15 * 1024 * 1024) {
      setError("The note image must be 15 MB or smaller.");
      return;
    }
    setMode("processing");
    const body = new FormData();
    body.set("image", image);
    try {
      const response = await fetch("/api/writing-assist/handwriting", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok || !payload?.text) throw new Error(payload?.error || "The notes could not be scanned.");
      setSource("Handwritten notes");
      setDraft(payload.text);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The notes could not be scanned.");
    } finally {
      setMode("idle");
    }
  };

  const applyDraft = (replace: boolean) => {
    const target = targetRef.current;
    if (!target || !document.contains(target)) {
      setError("Return to a comment or text field, then try again.");
      return;
    }
    if (target instanceof HTMLTextAreaElement) {
      const current = target.value;
      const value = replace ? draft : `${current}${current.trim() ? "\n" : ""}${draft}`;
      setTextareaValue(target, value);
    } else {
      const current = target.innerText;
      target.innerText = replace ? draft : `${current}${current.trim() ? "\n" : ""}${draft}`;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: draft }));
    }
    setDraft("");
    setVisible(false);
    target.focus();
  };

  return (
    <div className={styles.root} ref={rootRef}>
      {visible && !draft && (
        <div className={styles.toolbar} role="toolbar" aria-label="Writing assistance">
          <button disabled={mode === "processing"} onClick={mode === "recording" ? stopRecording : startRecording} type="button">
            <span aria-hidden="true">{mode === "recording" ? "■" : "●"}</span>
            {mode === "recording" ? "Stop dictation" : "Dictate"}
          </button>
          <button disabled={mode !== "idle"} onClick={() => imageInputRef.current?.click()} type="button">
            <span aria-hidden="true">▣</span> Scan notes
          </button>
          {mode === "processing" && <span className={styles.progress}>Processing…</span>}
          <span className={styles.disclosure}>AI transcription · review before inserting</span>
          <input accept="image/*" capture="environment" hidden onChange={scanImage} ref={imageInputRef} type="file" />
        </div>
      )}

      {error && visible && <div className={styles.error} role="alert">{error}<button aria-label="Dismiss" onClick={() => setError("")} type="button">×</button></div>}

      {draft && (
        <div aria-labelledby="writing-review-title" aria-modal="true" className={styles.backdrop} role="dialog">
          <div className={styles.dialog}>
            <span className="eyebrow">{source}</span>
            <h2 id="writing-review-title">Review before adding</h2>
            <p>Edit the text below. Nothing is inserted until you choose an action. The portal does not retain the source audio or image.</p>
            <textarea autoFocus className="textarea" onChange={(event) => setDraft(event.target.value)} rows={10} value={draft} />
            <div className={styles.actions}>
              <button className="button button-secondary" onClick={() => setDraft("")} type="button">Cancel</button>
              <button className="button button-secondary" onClick={() => applyDraft(true)} type="button">Replace field</button>
              <button className="button button-primary" onClick={() => applyDraft(false)} type="button">Append to field</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
