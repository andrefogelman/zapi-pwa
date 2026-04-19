interface Props {
  onOpenTasks?: () => void;
}

export function EmptyState({ onOpenTasks }: Props) {
  return (
    <div className="wa-empty">
      <svg width="250" height="250" viewBox="0 0 303 172" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M229.565 160.229C262.212 149.245 286.931 118.241 283.39 73.4194C278.009 5.31929 212.365 -11.5738 171.472 8.48325C115.998 37.3257 88.7055 11.5765 63.0143 15.408C22.0384 21.5924 -17.4431 58.3243 8.40709 106.39C25.1393 137.604 41.9002 146.975 76.1347 155.478C110.369 163.981 131.442 155.02 161.636 163.039C191.83 171.057 196.918 171.213 229.565 160.229Z" fill="#364147"/>
        <path d="M131.589 68.9422C131.589 44.8882 151.634 25.3862 176.353 25.3862C201.072 25.3862 221.117 44.8882 221.117 68.9422C221.117 93.0035 201.072 112.498 176.353 112.498C171.455 112.498 166.747 111.748 162.353 110.362L143.865 118.199L147.533 103.965C137.789 94.9965 131.589 82.6855 131.589 68.9422Z" fill="#202c33"/>
        <path d="M154.07 63.5005H198.638" stroke="#00a884" strokeWidth="3" strokeLinecap="round"/>
        <path d="M154.07 75.5005H185.638" stroke="#00a884" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <h2 style={{ fontSize: 28, fontWeight: 300, color: "#e9edef", marginTop: 20 }}>falabem</h2>
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
