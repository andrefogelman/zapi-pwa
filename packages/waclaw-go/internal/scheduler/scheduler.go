// Package scheduler polls Supabase for pending waclaw_scheduled_messages
// and dispatches them through the session Manager. It ports the behavior of
// the old waclaw Node src/scheduler.js.
package scheduler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/session"
	"github.com/rs/zerolog"
)

const (
	pollTable    = "waclaw_scheduled_messages"
	pollInterval = 30 * time.Second
	initialDelay = 5 * time.Second
)

// scheduledMessage mirrors the Supabase row shape.
type scheduledMessage struct {
	ID              string `json:"id"`
	WaclawSessionID string `json:"waclaw_session_id"`
	ChatJID         string `json:"chat_jid"`
	Text            string `json:"text"`
	ScheduledFor    string `json:"scheduled_for"`
	Status          string `json:"status"`
	// Media attachment is optional; when set, the scheduler treats this as a
	// file send (text becomes the caption).
	MediaBase64   string `json:"media_base64"`
	MediaFilename string `json:"media_filename"`
	MediaMimeType string `json:"media_mime_type"`
}

// Scheduler polls Supabase REST API for pending messages and dispatches them.
type Scheduler struct {
	mgr        *session.Manager
	baseURL    string
	serviceKey string
	log        zerolog.Logger
}

// New returns a *Scheduler configured to poll Supabase. Returns nil (scheduler
// disabled) if either supabaseURL or serviceKey is empty.
func New(mgr *session.Manager, supabaseURL, serviceKey string, log zerolog.Logger) *Scheduler {
	if supabaseURL == "" || serviceKey == "" {
		log.Warn().Msg("scheduler disabled: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
		return nil
	}
	return &Scheduler{
		mgr:        mgr,
		baseURL:    supabaseURL,
		serviceKey: serviceKey,
		log:        log.With().Str("component", "scheduler").Logger(),
	}
}

// Run polls on a 30-second ticker (initial tick after 5s). Stops when ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	s.log.Info().Msg("scheduler started")

	// initial tick after 5s
	select {
	case <-ctx.Done():
		return
	case <-time.After(initialDelay):
	}
	s.tick(ctx)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.log.Info().Msg("scheduler stopped")
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

// tick fetches all due pending rows and processes each one.
func (s *Scheduler) tick(ctx context.Context) {
	msgs, err := s.fetchDue(ctx)
	if err != nil {
		s.log.Error().Err(err).Msg("fetch due messages")
		return
	}
	for _, msg := range msgs {
		s.process(ctx, msg)
	}
}

// fetchDue queries Supabase for pending messages whose scheduled_for is ≤ now.
func (s *Scheduler) fetchDue(ctx context.Context) ([]scheduledMessage, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	url := fmt.Sprintf(
		"%s/rest/v1/%s?status=eq.pending&scheduled_for=lte.%s",
		s.baseURL, pollTable, now,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	s.setHeaders(req)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("supabase GET %d", resp.StatusCode)
	}

	var msgs []scheduledMessage
	if err := json.NewDecoder(resp.Body).Decode(&msgs); err != nil {
		return nil, err
	}
	return msgs, nil
}

// process claims one row, sends the message, then marks it sent or failed.
func (s *Scheduler) process(ctx context.Context, msg scheduledMessage) {
	log := s.log.With().Str("id", msg.ID).Str("chat", msg.ChatJID).Logger()

	// Claim: PATCH status=processing with optimistic-lock filter status=eq.pending
	if ok := s.patchStatus(ctx, msg.ID, map[string]any{"status": "processing"}); !ok {
		log.Debug().Msg("claim failed (already claimed)")
		return
	}

	// Resolve session
	sess, err := s.mgr.Get(msg.WaclawSessionID)
	if err != nil {
		log.Warn().Err(err).Str("session", msg.WaclawSessionID).Msg("session not found")
		s.updateFailed(ctx, msg.ID, fmt.Sprintf("session not found: %v", err))
		return
	}

	// Send: media-first when an attachment is present (text becomes caption).
	if msg.MediaBase64 != "" {
		data, err := base64.StdEncoding.DecodeString(msg.MediaBase64)
		if err != nil {
			log.Error().Err(err).Msg("decode media failed")
			s.updateFailed(ctx, msg.ID, "decode media: "+err.Error())
			return
		}
		filename := msg.MediaFilename
		if filename == "" {
			filename = "arquivo"
		}
		mime := msg.MediaMimeType
		if mime == "" {
			mime = "application/octet-stream"
		}
		if _, err := sess.SendFile(ctx, msg.ChatJID, data, filename, mime, msg.Text); err != nil {
			log.Error().Err(err).Msg("send-file failed")
			s.updateFailed(ctx, msg.ID, err.Error())
			return
		}
	} else {
		if _, err := sess.SendText(ctx, msg.ChatJID, msg.Text, ""); err != nil {
			log.Error().Err(err).Msg("send failed")
			s.updateFailed(ctx, msg.ID, err.Error())
			return
		}
	}

	// Mark sent
	sentAt := time.Now().UTC().Format(time.RFC3339)
	s.patchStatus(ctx, msg.ID, map[string]any{"status": "sent", "sent_at": sentAt})
	log.Info().Msg("scheduled message sent")
}

// patchStatus sends a PATCH to Supabase with an optimistic pending guard.
// Returns true if Supabase accepted (204 No Content).
func (s *Scheduler) patchStatus(ctx context.Context, id string, body map[string]any) bool {
	url := fmt.Sprintf(
		"%s/rest/v1/%s?id=eq.%s&status=eq.pending",
		s.baseURL, pollTable, id,
	)

	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(data))
	if err != nil {
		s.log.Error().Err(err).Msg("build PATCH request")
		return false
	}
	s.setHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.log.Error().Err(err).Msg("PATCH request")
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusNoContent
}

// updateFailed marks a row as failed with a truncated error message.
func (s *Scheduler) updateFailed(ctx context.Context, id, errMsg string) {
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}
	url := fmt.Sprintf(
		"%s/rest/v1/%s?id=eq.%s",
		s.baseURL, pollTable, id,
	)

	body := map[string]any{"status": "failed", "error": errMsg}
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(data))
	if err != nil {
		s.log.Error().Err(err).Msg("build failed-PATCH request")
		return
	}
	s.setHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.log.Error().Err(err).Msg("failed-PATCH request")
		return
	}
	defer resp.Body.Close()
}

// setHeaders applies the Supabase auth headers to a request.
func (s *Scheduler) setHeaders(req *http.Request) {
	req.Header.Set("apikey", s.serviceKey)
	req.Header.Set("Authorization", "Bearer "+s.serviceKey)
}
