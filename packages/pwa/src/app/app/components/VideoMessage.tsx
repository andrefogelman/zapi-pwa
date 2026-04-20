"use client";

import { useState } from "react";
import { linkify } from "../lib/linkify";

interface Props {
  videoUrl: string | null;
  caption: string | null;
  mimeType: string | null;
}

export function VideoMessage({ videoUrl, caption, mimeType }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!videoUrl) {
    return (
      <div className="wa-msg-media">
        <span className="wa-msg-media-icon">🎬</span>
        <span>{caption || "Vídeo"}</span>
      </div>
    );
  }

  return (
    <div className="wa-video-wrap">
      {error ? (
        <div className="wa-image-error">🎬 Vídeo não disponível</div>
      ) : (
        <video
          src={videoUrl}
          controls
          preload="metadata"
          className="wa-video-player"
          onLoadedMetadata={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
        >
          {mimeType && <source src={videoUrl} type={mimeType.split(";")[0].trim()} />}
          Seu navegador não suporta vídeo.
        </video>
      )}
      {loading && !error && (
        <div className="wa-image-loading">Carregando vídeo...</div>
      )}
      {caption && <div className="wa-image-caption">{linkify(caption)}</div>}
    </div>
  );
}
