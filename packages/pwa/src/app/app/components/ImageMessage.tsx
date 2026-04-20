"use client";

import { useState } from "react";
import { linkify } from "../lib/linkify";

interface Props {
  imageUrl: string | null;
  caption: string | null;
}

export function ImageMessage({ imageUrl, caption }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!imageUrl) {
    return (
      <div className="wa-msg-media">
        <span className="wa-msg-media-icon">📷</span>
        <span>{caption || "Foto"}</span>
      </div>
    );
  }

  return (
    <>
      <div className="wa-image-wrap">
        <div
          className="wa-image-thumb"
          onClick={() => !error && setOpen(true)}
        >
          {loading && !error && <div className="wa-image-loading">Carregando...</div>}
          {error ? (
            <div className="wa-image-error">📷 Imagem não disponível</div>
          ) : (
            <img
              src={imageUrl}
              alt="Foto"
              className={`wa-image-img ${loading ? "loading" : ""}`}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError(true); }}
            />
          )}
        </div>
        {caption && <div className="wa-image-caption">{linkify(caption)}</div>}
      </div>

      {open && (
        <div className="wa-lightbox" onClick={() => setOpen(false)}>
          <button className="wa-lightbox-close" onClick={() => setOpen(false)}>✕</button>
          <img src={imageUrl} alt="Foto ampliada" className="wa-lightbox-img" />
          {caption && <div className="wa-lightbox-caption">{caption}</div>}
        </div>
      )}
    </>
  );
}
