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
	ChatLID    string     `json:"chat_lid,omitempty"`
	ChatName   string     `json:"chat_name"`
	From       string     `json:"from"`
	SenderLID  string     `json:"sender_lid,omitempty"`
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

// WireReactionEvent is emitted when someone reacts to (or un-reacts from) a
// message. Clients refresh the target bubble's reaction chip when they see it.
type WireReactionEvent struct {
	Type        string `json:"type"` // "reaction"
	SessionID   string `json:"session_id"`
	ChatJID     string `json:"chat_jid"`
	TargetMsgID string `json:"target_msg_id"`
	ReactorJID  string `json:"reactor_jid"`
	ReactorLID  string `json:"reactor_lid,omitempty"`
	Emoji       string `json:"emoji"` // empty = removal
	Timestamp   int64  `json:"timestamp"`
}
