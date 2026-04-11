"use client";

import { useState, useRef } from "react";

interface Props {
  audioUrl: string | null;
  transcription: string | null;
  transcriptionStatus: string | null;
  fromMe: boolean;
}

export function AudioMessage({ audioUrl, transcription, transcriptionStatus, fromMe }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else el.play();
    setPlaying(!playing);
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  }

  function fmt(t: number) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const showExpander = transcription && transcription.length > 120;

  return (
    <div className="wa-audio-wrap">
      {audioUrl ? (
        <>
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
            onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
            onEnded={() => setPlaying(false)}
          />
          <div className="wa-audio-player">
            <button className="wa-audio-play" onClick={togglePlay}>
              {playing ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>
            <div className="wa-audio-track" onClick={handleSeek}>
              <div className="wa-audio-bar">
                <div className="wa-audio-progress" style={{ width: `${progress}%` }} />
              </div>
              {/* Waveform dots */}
              <div className="wa-audio-wave">
                {Array.from({ length: 28 }, (_, i) => {
                  const h = 4 + Math.sin(i * 0.7) * 8 + Math.random() * 4;
                  return <span key={i} className="wa-audio-wave-bar" style={{ height: `${h}px` }} />;
                })}
              </div>
            </div>
            <span className="wa-audio-time">{fmt(playing ? currentTime : duration)}</span>
          </div>
        </>
      ) : (
        <div className="wa-audio-player">
          <span className="wa-audio-icon">🎵</span>
          <span className="wa-audio-fallback">Mensagem de voz</span>
        </div>
      )}

      {transcriptionStatus === "processing" && (
        <div className="wa-transcription-status">
          <span className="wa-spinner" /> Transcrevendo...
        </div>
      )}

      {transcriptionStatus === "failed" && (
        <div className="wa-transcription-status wa-transcription-failed">
          Falha na transcrição
        </div>
      )}

      {transcription && transcriptionStatus !== "processing" && (
        <div className={`wa-transcription ${expanded ? "expanded" : ""}`}>
          <div className={`wa-transcription-text ${!expanded && showExpander ? "clamped" : ""}`}>
            {transcription}
          </div>
          {showExpander && (
            <button className="wa-transcription-toggle" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Mostrar menos ▲" : "Mostrar mais ▼"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
