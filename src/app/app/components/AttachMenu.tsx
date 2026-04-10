"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onPickPhoto: () => void;
  onPickDocument: () => void;
  onPickContact: () => void;
  onPickAIImage: () => void;
}

export function AttachMenu({ open, onClose, onPickPhoto, onPickDocument, onPickContact, onPickAIImage }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Defer so the click that opens the menu doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, onClose]);

  if (!open) return null;

  function pick(fn: () => void) {
    return () => {
      onClose();
      fn();
    };
  }

  return (
    <div className="wa-attach-menu" ref={menuRef}>
      <button className="wa-attach-item" onClick={pick(onPickDocument)}>
        <span className="wa-attach-icon wa-attach-doc">📄</span>
        <span>Documento</span>
      </button>
      <button className="wa-attach-item" onClick={pick(onPickPhoto)}>
        <span className="wa-attach-icon wa-attach-photo">🖼️</span>
        <span>Fotos e vídeos</span>
      </button>
      <button className="wa-attach-item" onClick={pick(onPickContact)}>
        <span className="wa-attach-icon wa-attach-contact">👤</span>
        <span>Contato</span>
      </button>
      <button className="wa-attach-item" onClick={pick(onPickAIImage)}>
        <span className="wa-attach-icon wa-attach-ai">✨</span>
        <span>Imagem IA</span>
      </button>
      <button className="wa-attach-item disabled" disabled title="Em breve">
        <span className="wa-attach-icon wa-attach-poll">📊</span>
        <span>Enquete</span>
      </button>
    </div>
  );
}
