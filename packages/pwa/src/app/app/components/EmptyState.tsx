interface Props {
  onOpenTasks?: () => void;
}

export function EmptyState({ onOpenTasks }: Props) {
  return (
    <div className="wa-empty">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="falabem" width={120} height={120} style={{ opacity: 0.9 }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-wordmark-light.svg" alt="falabem" style={{ height: 52, width: "auto", marginTop: 24 }} />
      <p style={{ fontSize: 14, color: "#8696a0", marginTop: 8 }}>
        Envie e receba mensagens. Selecione uma conversa para começar.
      </p>
      {onOpenTasks && (
        <button
          onClick={onOpenTasks}
          style={{
            marginTop: 20,
            background: "rgba(0,168,132,0.15)",
            border: "1px solid #00a884",
            color: "#00a884",
            padding: "10px 24px",
            borderRadius: 8,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Gerenciar Tarefas
        </button>
      )}
    </div>
  );
}
