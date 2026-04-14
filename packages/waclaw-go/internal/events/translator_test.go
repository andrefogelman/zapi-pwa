package events_test

import (
	"encoding/json"
	"testing"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/events"
)

func TestTranslateMessage_TextMessage(t *testing.T) {
	in := events.TranslateInput{
		SessionID:  "sess-1",
		MessageID:  "MSG1",
		ChatJID:    "5511999999999@s.whatsapp.net",
		ChatName:   "Alice",
		SenderJID:  "5511999999999@s.whatsapp.net",
		SenderName: "Alice",
		FromMe:     false,
		Timestamp:  1700000000,
		Text:       "Hello!",
		MediaType:  "",
	}

	evt, err := events.TranslateMessage(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if evt.Type != "message" {
		t.Fatalf("expected type 'message', got %q", evt.Type)
	}

	var envelope events.WireEnvelope
	if err := json.Unmarshal(evt.Raw, &envelope); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if envelope.Type != "message" {
		t.Errorf("envelope.Type = %q, want 'message'", envelope.Type)
	}
	if envelope.SessionID != "sess-1" {
		t.Errorf("envelope.SessionID = %q, want 'sess-1'", envelope.SessionID)
	}
	if envelope.Message == nil {
		t.Fatal("envelope.Message is nil")
	}
	if envelope.Message.Text != "Hello!" {
		t.Errorf("message.Text = %q, want 'Hello!'", envelope.Message.Text)
	}
	if envelope.Message.Audio != nil {
		t.Error("expected Audio to be nil for text message")
	}
	if envelope.Message.From != "5511999999999" {
		t.Errorf("message.From = %q, want '5511999999999'", envelope.Message.From)
	}
}

func TestTranslateMessage_AudioMessageBuildsURL(t *testing.T) {
	in := events.TranslateInput{
		SessionID:       "sess-2",
		MessageID:       "AUDIO1",
		ChatJID:         "5511987654321@s.whatsapp.net",
		ChatName:        "Bob",
		SenderJID:       "5511987654321@s.whatsapp.net",
		SenderName:      "Bob",
		FromMe:          false,
		Timestamp:       1700000001,
		MediaType:       "audio",
		MimeType:        "audio/ogg; codecs=opus",
		FileLength:      12345,
		DurationSeconds: 7,
		MediaBaseURL:    "http://localhost:3100/", // trailing slash
	}

	evt, err := events.TranslateMessage(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var envelope events.WireEnvelope
	if err := json.Unmarshal(evt.Raw, &envelope); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if envelope.Message == nil {
		t.Fatal("envelope.Message is nil")
	}
	if envelope.Message.Audio == nil {
		t.Fatal("expected Audio to be set for audio message")
	}

	wantURL := "http://localhost:3100/sessions/sess-2/media/5511987654321@s.whatsapp.net/AUDIO1"
	if envelope.Message.Audio.URL != wantURL {
		t.Errorf("Audio.URL = %q, want %q", envelope.Message.Audio.URL, wantURL)
	}
	if envelope.Message.Audio.DurationSeconds != 7 {
		t.Errorf("Audio.DurationSeconds = %d, want 7", envelope.Message.Audio.DurationSeconds)
	}
	if envelope.Message.Audio.SizeBytes != 12345 {
		t.Errorf("Audio.SizeBytes = %d, want 12345", envelope.Message.Audio.SizeBytes)
	}
}

func TestJidUserPart(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"5511987654321@s.whatsapp.net", "5511987654321"},
		{"group123@g.us", "group123"},
		{"nojid", "nojid"},
		{"@suffix", ""},
	}

	for _, tc := range tests {
		// We test jidUserPart indirectly via TranslateMessage's From field.
		in := events.TranslateInput{
			SessionID: "s",
			MessageID: "m",
			ChatJID:   "chat@s.whatsapp.net",
			SenderJID: tc.input,
			Timestamp: 1,
		}
		evt, err := events.TranslateMessage(in)
		if err != nil {
			t.Fatalf("input %q: unexpected error: %v", tc.input, err)
		}
		var envelope events.WireEnvelope
		if err := json.Unmarshal(evt.Raw, &envelope); err != nil {
			t.Fatalf("input %q: unmarshal: %v", tc.input, err)
		}
		if envelope.Message.From != tc.want {
			t.Errorf("jidUserPart(%q) via From = %q, want %q", tc.input, envelope.Message.From, tc.want)
		}
	}
}
