interface Props {
  value: string;
  type?: "status" | "priority";
}

const STATUS_COLORS: Record<string, string> = {
  open: "#00a884",
  in_progress: "#f7c948",
  resolved: "#53bdeb",
  closed: "#8696a0",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#8696a0",
  medium: "#53bdeb",
  high: "#f7c948",
  urgent: "#ef4444",
};

const LABELS: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  resolved: "Resolvida",
  closed: "Fechada",
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export function TaskStatusBadge({ value, type = "status" }: Props) {
  const colors = type === "priority" ? PRIORITY_COLORS : STATUS_COLORS;
  const color = colors[value] || "#8696a0";

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 500,
        color: "#111b21",
        background: color,
        whiteSpace: "nowrap",
      }}
    >
      {LABELS[value] || value}
    </span>
  );
}
