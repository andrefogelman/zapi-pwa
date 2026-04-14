package events

// WireAudio carries audio-specific metadata in a WireMessageEvent.
type WireAudio struct {
	URL             string `json:"url"`
	DurationSeconds int    `json:"duration_seconds"`
	SizeBytes       int64  `json:"size_bytes"`
}

// WireMessageEvent is the JSON payload for a single WhatsApp message event.
// Field names match the daemon TypeScript OnAudioEventSchema contract.
type WireMessageEvent struct {
	ID         string     `json:"id"`
	ChatJID    string     `json:"chat_jid"`
	ChatName   string     `json:"chat_name"`
	From       string     `json:"from"`
	SenderName string     `json:"sender_name"`
	FromMe     bool       `json:"from_me"`
	Timestamp  int64      `json:"timestamp"`
	Text       string     `json:"text,omitempty"`
	Audio      *WireAudio `json:"audio,omitempty"`
}

// WireEnvelope wraps a WireMessageEvent with routing metadata.
type WireEnvelope struct {
	Type      string            `json:"type"`
	SessionID string            `json:"session_id"`
	Message   *WireMessageEvent `json:"message,omitempty"`
}
