"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onSend: (file: File) => Promise<void>;
  disabled?: boolean;
}

type State = "idle" | "recording" | "sending";

// Prefer ogg/opus if the browser can produce it (matches WhatsApp voice
// format). Fall back to webm/opus which Chrome produces by default, then
// mp4 for Safari. wacli send file accepts any of these.
function pickMimeType(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return { mime: "", ext: "webm" };
}

export function VoiceRecorder({ onSend, disabled }: Props) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // If true, the user cancelled; onstop should drop the recording
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function start() {
    setError(null);
    cancelledRef.current = false;
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { mime } = pickMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (cancelledRef.current) {
          setState("idle");
          setSeconds(0);
          return;
        }
        const chunks = chunksRef.current;
        if (chunks.length === 0) {
          setState("idle");
          setSeconds(0);
          return;
        }
        const { mime, ext } = pickMimeType();
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        const file = new File([blob], `voz-${Date.now()}.${ext}`, {
          type: mime || "audio/webm",
        });
        setState("sending");
        try {
          await onSend(file);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setState("idle");
          setSeconds(0);
        }
      };

      startedAtRef.current = Date.now();
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      recorder.start();
      setState("recording");
    } catch (err) {
      const msg = (err as Error).message || "Microfone indisponível";
      setError(msg);
      setState("idle");
    }
  }

  function stopAndSend() {
    const rec = recorderRef.current;
    if (!rec) return;
    cancelledRef.current = false;
    if (rec.state !== "inactive") rec.stop();
  }

  function cancel() {
    const rec = recorderRef.current;
    if (!rec) return;
    cancelledRef.current = true;
    if (rec.state !== "inactive") rec.stop();
  }

  const timeLabel = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

  if (state === "recording") {
    return (
      <div className="wa-voice-bar">
        <button className="wa-voice-cancel" onClick={cancel} title="Cancelar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
        <span className="wa-voice-dot" />
        <span className="wa-voice-time">{timeLabel}</span>
        <div className="wa-voice-spacer" />
        <button className="wa-voice-send" onClick={stopAndSend} title="Enviar">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      className="wa-mic-btn"
      onClick={start}
      disabled={disabled || state === "sending"}
      title={state === "sending" ? "Enviando..." : "Gravar mensagem de voz"}
    >
      {state === "sending" ? (
        <span className="wa-spinner" />
      ) : (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.42 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
        </svg>
      )}
      {error && <span className="wa-voice-error-tip">{error}</span>}
    </button>
  );
}
