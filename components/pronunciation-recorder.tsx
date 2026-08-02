"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "./pronunciation-recorder.module.css";

const PRONUNCIATION_LABELS = new Set([
  "name pronunciation",
  "pronunciation",
]);

const MAX_RECORDING_SECONDS = 60;

type RecordingState =
  | "idle"
  | "requesting"
  | "recording"
  | "preview"
  | "attached"
  | "error";

type PhoneticState =
  | "idle"
  | "generating"
  | "success"
  | "preserved"
  | "error";

type PhoneticResponse = {
  phoneticSpelling?: string;
  transcript?: string;
  error?: string;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function chooseMimeType() {
  if (
    typeof window === "undefined" ||
    typeof MediaRecorder === "undefined"
  ) {
    return "";
  }

  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  return (
    candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
  );
}

function extensionForMimeType(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "m4a";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

function findFileTypeSelect(form: HTMLFormElement | null) {
  if (!form) return null;

  const preferredNames = [
    "file_type",
    "fileType",
    "document_type",
    "documentType",
    "category",
  ];

  for (const name of preferredNames) {
    const select = form.querySelector<HTMLSelectElement>(
      `select[name="${name}"]`,
    );
    if (select) return select;
  }

  return (
    Array.from(form.querySelectorAll<HTMLSelectElement>("select")).find(
      (select) =>
        Array.from(select.options).some((option) =>
          PRONUNCIATION_LABELS.has(normalize(option.textContent)),
        ),
    ) ?? null
  );
}

function findFileInput(form: HTMLFormElement | null) {
  if (!form) return null;

  const preferredNames = [
    "files",
    "file",
    "upload",
    "attachment",
    "document",
  ];

  for (const name of preferredNames) {
    const input = form.querySelector<HTMLInputElement>(
      `input[type="file"][name="${name}"]`,
    );
    if (input) return input;
  }

  return form.querySelector<HTMLInputElement>('input[type="file"]');
}

function findTextInput(
  form: HTMLFormElement | null,
  name: string,
) {
  if (!form) return null;
  return form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

function setInputFile(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearInputFile(input: HTMLInputElement | null) {
  if (!input) return;
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function PronunciationRecorder() {
  const rootRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const phoneticRequestRef = useRef<AbortController | null>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<RecordingState>("idle");
  const [phoneticState, setPhoneticState] =
    useState<PhoneticState>("idle");
  const [phoneticMessage, setPhoneticMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [recordingName, setRecordingName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const getForm = useCallback(
    () => rootRef.current?.closest("form") ?? null,
    [],
  );

  const releasePreview = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetPhonetic = useCallback(() => {
    phoneticRequestRef.current?.abort();
    phoneticRequestRef.current = null;
    setPhoneticState("idle");
    setPhoneticMessage("");
  }, []);

  const discardRecording = useCallback(
    (clearFile = true) => {
      stopTimer();
      stopStream();
      resetPhonetic();
      recorderRef.current = null;
      chunksRef.current = [];
      releasePreview();
      setRecordingBlob(null);
      setRecordingName("");
      setSeconds(0);
      setErrorMessage("");
      setState("idle");

      if (clearFile) {
        clearInputFile(findFileInput(getForm()));
      }
    },
    [getForm, releasePreview, resetPhonetic, stopStream, stopTimer],
  );

  useEffect(() => {
    mountedRef.current = true;
    const form = getForm();
    const select = findFileTypeSelect(form);

    if (!select) {
      return () => {
        mountedRef.current = false;
      };
    }

    const updateVisibility = () => {
      const selectedText =
        select.selectedOptions.item(0)?.textContent ?? select.value;
      const shouldShow =
        PRONUNCIATION_LABELS.has(normalize(selectedText)) ||
        PRONUNCIATION_LABELS.has(normalize(select.value));

      setVisible(shouldShow);
      if (!shouldShow) discardRecording(true);
    };

    updateVisibility();
    select.addEventListener("change", updateVisibility);
    select.addEventListener("input", updateVisibility);

    return () => {
      mountedRef.current = false;
      select.removeEventListener("change", updateVisibility);
      select.removeEventListener("input", updateVisibility);
    };
  }, [discardRecording, getForm]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      phoneticRequestRef.current?.abort();
      stopTimer();
      stopStream();
      releasePreview();
    },
    [releasePreview, stopStream, stopTimer],
  );

  const finishRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    discardRecording(true);
    setState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      const selectedMimeType = chooseMimeType();
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, {
            mimeType: selectedMimeType,
            audioBitsPerSecond: 128_000,
          })
        : new MediaRecorder(stream, {
            audioBitsPerSecond: 128_000,
          });

      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        stopTimer();
        stopStream();
        const type =
          recorder.mimeType || selectedMimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];

        if (blob.size === 0) {
          setState("error");
          setErrorMessage(
            "No audio was captured. Check the microphone and try again.",
          );
          return;
        }

        releasePreview();
        setRecordingBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        setState("preview");
      });

      recorder.addEventListener("error", () => {
        stopTimer();
        stopStream();
        setState("error");
        setErrorMessage(
          "The browser could not finish the recording. Please try again.",
        );
      });

      recorder.start(250);
      setState("recording");
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          const next = current + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            window.setTimeout(finishRecording, 0);
          }
          return Math.min(next, MAX_RECORDING_SECONDS);
        });
      }, 1_000);
    } catch (error) {
      stopTimer();
      stopStream();
      setState("error");

      if (
        error instanceof DOMException &&
        error.name === "NotAllowedError"
      ) {
        setErrorMessage(
          "Microphone access was blocked. Allow microphone access for this site and try again.",
        );
      } else if (
        error instanceof DOMException &&
        error.name === "NotFoundError"
      ) {
        setErrorMessage(
          "No microphone was found. Connect a microphone or upload an audio file instead.",
        );
      } else {
        setErrorMessage(
          "The microphone could not be opened. You may still upload an existing audio file.",
        );
      }
    }
  }, [
    discardRecording,
    finishRecording,
    releasePreview,
    stopStream,
    stopTimer,
  ]);

  const generatePhoneticSpelling = useCallback(
    async (file: File) => {
      const form = getForm();
      const personInput = findTextInput(form, "person_name");
      const phoneticInput = findTextInput(form, "phonetic_spelling");

      if (!phoneticInput) {
        setPhoneticState("error");
        setPhoneticMessage(
          "The phonetic-spelling field could not be found. Your recording is still attached and can be uploaded.",
        );
        return;
      }

      const controller = new AbortController();
      phoneticRequestRef.current?.abort();
      phoneticRequestRef.current = controller;
      setPhoneticState("generating");
      setPhoneticMessage("Generating an editable phonetic suggestion…");

      const body = new FormData();
      body.set("audio", file, file.name);
      body.set("person_name", personInput?.value.trim() ?? "");

      try {
        const response = await fetch("/api/pronunciation/phonetic", {
          method: "POST",
          body,
          signal: controller.signal,
        });
        const payload = (await response
          .json()
          .catch(() => null)) as PhoneticResponse | null;

        if (!response.ok || !payload?.phoneticSpelling?.trim()) {
          throw new Error(
            payload?.error ||
              "A phonetic suggestion could not be generated.",
          );
        }

        if (phoneticInput.value.trim()) {
          setPhoneticState("preserved");
          setPhoneticMessage(
            `Suggestion: ${payload.phoneticSpelling.trim()}. Your existing phonetic spelling was kept.`,
          );
          return;
        }

        setInputValue(phoneticInput, payload.phoneticSpelling.trim());
        setPhoneticState("success");
        setPhoneticMessage(
          `Suggested spelling added: ${payload.phoneticSpelling.trim()}. Review and edit it before uploading.`,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPhoneticState("error");
        const reason =
          error instanceof Error
            ? error.message.replace(/[.\s]+$/, "")
            : "The automatic phonetic suggestion is temporarily unavailable";
        setPhoneticMessage(
          `${reason}. You can enter it manually if you want; the recording is still attached and can be uploaded.`,
        );
      } finally {
        if (phoneticRequestRef.current === controller) {
          phoneticRequestRef.current = null;
        }
      }
    },
    [getForm],
  );

  const useRecording = useCallback(() => {
    if (!recordingBlob) return;

    const input = findFileInput(getForm());
    if (!input) {
      setState("error");
      setErrorMessage(
        "The School Files upload field could not be found.",
      );
      return;
    }

    const extension = extensionForMimeType(recordingBlob.type);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `name-pronunciation-${timestamp}.${extension}`;
    const file = new File([recordingBlob], fileName, {
      type: recordingBlob.type,
      lastModified: Date.now(),
    });

    setInputFile(input, file);
    setRecordingName(fileName);
    setState("attached");
    void generatePhoneticSpelling(file);
  }, [generatePhoneticSpelling, getForm, recordingBlob]);

  if (!visible) {
    return <div ref={rootRef} hidden aria-hidden="true" />;
  }

  const recordingSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  return (
    <div className={styles.recorder} ref={rootRef}>
      <div className={styles.heading}>
        <div>
          <strong>Record pronunciation</strong>
          <p>
            Record in the browser, listen back, and attach the recording
            only when it sounds right.
          </p>
        </div>
        {state === "recording" ? (
          <span className={styles.recordingBadge}>
            Recording {seconds}s / {MAX_RECORDING_SECONDS}s
          </span>
        ) : null}
      </div>

      {!recordingSupported ? (
        <div className={styles.notice}>
          Browser recording is unavailable here. Use the normal audio-file
          upload field below.
        </div>
      ) : null}

      {state === "error" ? (
        <div className={styles.error} role="alert">
          {errorMessage}
        </div>
      ) : null}

      {recordingSupported && (state === "idle" || state === "error") ? (
        <button
          className={styles.primaryButton}
          type="button"
          onClick={startRecording}
        >
          Start recording
        </button>
      ) : null}

      {state === "requesting" ? (
        <button className={styles.primaryButton} type="button" disabled>
          Opening microphone…
        </button>
      ) : null}

      {state === "recording" ? (
        <button
          className={styles.stopButton}
          type="button"
          onClick={finishRecording}
        >
          Stop recording
        </button>
      ) : null}

      {previewUrl ? (
        <div className={styles.preview}>
          <label htmlFor="pronunciation-recording-preview">
            Recording preview
          </label>
          <audio
            id="pronunciation-recording-preview"
            controls
            preload="metadata"
            src={previewUrl}
          >
            Your browser does not support audio playback.
          </audio>
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => discardRecording(true)}
            >
              Re-record
            </button>
            {state !== "attached" ? (
              <button
                className={styles.primaryButton}
                type="button"
                onClick={useRecording}
              >
                Use this recording
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {state === "attached" ? (
        <div className={styles.ready} role="status" aria-live="polite">
          <strong>Ready to upload</strong>
          <span>
            {recordingName} is attached to the School File form. Complete
            the remaining fields and select the normal upload button.
          </span>
        </div>
      ) : null}

      {phoneticState !== "idle" ? (
        <div
          className={
            phoneticState === "error"
              ? styles.phoneticError
              : phoneticState === "generating"
                ? styles.phoneticWorking
                : styles.phoneticSuccess
          }
          role={phoneticState === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <strong>
            {phoneticState === "generating"
              ? "Creating phonetic spelling"
              : phoneticState === "error"
                ? "Automatic suggestion unavailable"
                : "Phonetic suggestion ready"}
          </strong>
          <span>{phoneticMessage}</span>
        </div>
      ) : null}

      <p className={styles.privacy}>
        Nothing is uploaded while recording or playing the preview. When
        you choose Use this recording, a temporary copy is securely
        analyzed to create the editable phonetic suggestion. The School
        File itself is stored only after you submit the normal upload form.
      </p>
    </div>
  );
}
