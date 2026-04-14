"use client";

interface Props {
  documentUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  fileSize?: number | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mimeType: string | null, filename: string | null): string {
  const ext = filename?.split(".").pop()?.toLowerCase() || "";
  const mt = mimeType?.toLowerCase() || "";
  if (mt.includes("pdf") || ext === "pdf") return "📕";
  if (mt.includes("word") || ext === "doc" || ext === "docx") return "📘";
  if (mt.includes("sheet") || mt.includes("excel") || ext === "xls" || ext === "xlsx") return "📗";
  if (mt.includes("presentation") || ext === "ppt" || ext === "pptx") return "📙";
  if (mt.includes("zip") || ext === "zip" || ext === "rar" || ext === "7z") return "🗜️";
  return "📄";
}

export function DocumentMessage({ documentUrl, filename, mimeType, fileSize }: Props) {
  const displayName = filename || "Documento";
  const icon = iconFor(mimeType, filename);
  const subLabel = [
    mimeType?.split(";")[0].trim().split("/")[1]?.toUpperCase() || null,
    fileSize ? formatSize(fileSize) : null,
  ].filter(Boolean).join(" · ");

  if (!documentUrl) {
    return (
      <div className="wa-msg-media">
        <span className="wa-msg-media-icon">{icon}</span>
        <span>{displayName}</span>
      </div>
    );
  }

  return (
    <a
      href={documentUrl}
      target="_blank"
      rel="noopener noreferrer"
      download={filename || undefined}
      className="wa-document-card"
      title={`Baixar ${displayName}`}
    >
      <span className="wa-document-icon">{icon}</span>
      <div className="wa-document-info">
        <div className="wa-document-name">{displayName}</div>
        {subLabel && <div className="wa-document-meta">{subLabel}</div>}
      </div>
      <span className="wa-document-download" aria-hidden>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/>
        </svg>
      </span>
    </a>
  );
}
