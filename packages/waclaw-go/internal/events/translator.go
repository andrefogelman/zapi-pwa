package events

import (
	"encoding/json"
	"fmt"
	"strings"
)

// TranslateInput holds all the fields needed to build a WireEnvelope.
type TranslateInput struct {
	SessionID       string
	MessageID       string
	ChatJID         string
	ChatLID         string
	ChatName        string
	SenderJID       string
	SenderLID       string
	SenderName      string
	FromMe          bool
	Timestamp       int64
	Text            string
	MediaType       string
	MimeType        string
	FileLength      int64
	DurationSeconds int
	MediaBaseURL    string
}

// TranslateMessage converts a TranslateInput into a bus Event containing a
// JSON-marshalled WireEnvelope. For audio/ptt media types the Audio field is
// populated with a URL pointing to the media download endpoint.
func TranslateMessage(in TranslateInput) (Event, error) {
	msg := &WireMessageEvent{
		ID:         in.MessageID,
		ChatJID:    in.ChatJID,
		ChatLID:    in.ChatLID,
		ChatName:   in.ChatName,
		From:       jidUserPart(in.SenderJID),
		SenderLID:  in.SenderLID,
		SenderName: in.SenderName,
		FromMe:     in.FromMe,
		Timestamp:  in.Timestamp,
		Text:       in.Text,
	}

	switch in.MediaType {
	case "audio", "ptt":
		base := strings.TrimRight(in.MediaBaseURL, "/")
		url := fmt.Sprintf("%s/sessions/%s/media/%s/%s", base, in.SessionID, in.ChatJID, in.MessageID)
		msg.Audio = &WireAudio{
			URL:             url,
			DurationSeconds: in.DurationSeconds,
			SizeBytes:       in.FileLength,
		}
	}

	envelope := WireEnvelope{
		Type:      "message",
		SessionID: in.SessionID,
		Message:   msg,
	}

	raw, err := json.Marshal(envelope)
	if err != nil {
		return Event{}, fmt.Errorf("translate marshal: %w", err)
	}

	return Event{Type: "message", Raw: raw}, nil
}

// TranslateReaction converts a WireReactionEvent into a bus Event.
func TranslateReaction(r WireReactionEvent) (Event, error) {
	r.Type = "reaction"
	raw, err := json.Marshal(r)
	if err != nil {
		return Event{}, fmt.Errorf("translate reaction: %w", err)
	}
	return Event{Type: "reaction", Raw: raw}, nil
}

// jidUserPart returns the user part of a JID (before the '@').
// If there is no '@', the full string is returned.
func jidUserPart(jid string) string {
	if idx := strings.Index(jid, "@"); idx >= 0 {
		return jid[:idx]
	}
	return jid
}
