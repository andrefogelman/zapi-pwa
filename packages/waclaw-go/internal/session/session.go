// Package session owns the per-tenant WhatsApp connection lifecycle.
// Each Session wraps one *whatsmeow.Client, one *store.Store, and a
// goroutine-managed event handler pipeline. The Manager holds a map
// from session ID to *Session and serializes create/delete operations.
package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	"github.com/rs/zerolog"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// State is the lifecycle phase of a Session.
type State string

const (
	StateNew          State = "new"
	StateWaitingQR    State = "waiting_qr"
	StateConnecting   State = "connecting"
	StateConnected    State = "connected"
	StateDisconnected State = "disconnected"
	StateLoggedOut    State = "logged_out"
	StateClosed       State = "closed"
)

// Session is one tenant's WhatsApp session.
type Session struct {
	ID       string
	StoreDir string

	log zerolog.Logger

	mu          sync.Mutex
	state       State
	lastError   string
	lastQR      string
	connectedAt time.Time

	client *whatsmeow.Client
	store  *store.Store
	// container is held so Close can release whatsmeow's sqlstore handle.
	container io.Closer

	handlerDeps HandlerDeps
}

// WACliLogAdapter bridges zerolog → whatsmeow's waLog.Logger interface.
// Required because whatsmeow's constructors want its own logger type.
type WACliLogAdapter struct {
	zl zerolog.Logger
}

func (w WACliLogAdapter) Warnf(msg string, args ...any)  { w.zl.Warn().Msgf(msg, args...) }
func (w WACliLogAdapter) Errorf(msg string, args ...any) { w.zl.Error().Msgf(msg, args...) }
func (w WACliLogAdapter) Infof(msg string, args ...any)  { w.zl.Info().Msgf(msg, args...) }
func (w WACliLogAdapter) Debugf(msg string, args ...any) { w.zl.Debug().Msgf(msg, args...) }
func (w WACliLogAdapter) Sub(module string) waLog.Logger {
	return WACliLogAdapter{zl: w.zl.With().Str("wa_module", module).Logger()}
}

// State returns the current lifecycle state (thread-safe).
func (s *Session) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *Session) setState(st State) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = st
	s.log.Info().Str("state", string(st)).Msg("session state")
}

// LastQR returns the most recent QR code string (may be empty).
func (s *Session) LastQR() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastQR
}

func (s *Session) setLastQR(qr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastQR = qr
}

// LastError returns the most recent error description (may be empty).
func (s *Session) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
}

// StorePath is the DB file path inside StoreDir.
func (s *Session) StorePath() string {
	return filepath.Join(s.StoreDir, "waclaw.db")
}

// Store returns the underlying store for read-only access by HTTP handlers.
func (s *Session) Store() *store.Store {
	return s.store
}

// errClosed is returned when operations are attempted on a closed session.
var errClosed = errors.New("session is closed")

// SendText sends a plain-text WhatsApp message to the given JID string.
// If quotedMsgID is non-empty the message is sent as a reply (quote).
// Returns the server-assigned message ID on success.
func (s *Session) SendText(ctx context.Context, to, text, quotedMsgID string) (string, error) {
	if err := s.ensureOpen(); err != nil {
		return "", err
	}
	jid, err := types.ParseJID(to)
	if err != nil {
		return "", fmt.Errorf("invalid JID %q: %w", to, err)
	}

	var msg *waE2E.Message
	if quotedMsgID != "" {
		msg = &waE2E.Message{
			ExtendedTextMessage: &waE2E.ExtendedTextMessage{
				Text: ptrString(text),
				ContextInfo: &waE2E.ContextInfo{
					StanzaID: ptrString(quotedMsgID),
				},
			},
		}
	} else {
		msg = &waE2E.Message{
			Conversation: ptrString(text),
		}
	}

	resp, err := s.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

// SendFile uploads binary data and sends it as a media message.
// mimeType controls which WhatsApp message sub-type is used.
// Returns the server-assigned message ID on success.
func (s *Session) SendFile(ctx context.Context, to string, data []byte, filename, mimeType, caption string) (string, error) {
	if err := s.ensureOpen(); err != nil {
		return "", err
	}
	jid, err := types.ParseJID(to)
	if err != nil {
		return "", fmt.Errorf("invalid JID %q: %w", to, err)
	}
	mt := mediaTypeFromMime(mimeType)
	uploaded, err := s.client.Upload(ctx, data, mt)
	if err != nil {
		return "", fmt.Errorf("upload: %w", err)
	}

	var msg *waE2E.Message
	fileLen := ptrUint64(uint64(len(data)))
	switch mt {
	case whatsmeow.MediaImage:
		msg = &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				URL:           ptrString(uploaded.URL),
				DirectPath:    ptrString(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    fileLen,
				Mimetype:      ptrString(mimeType),
				Caption:       ptrString(caption),
			},
		}
	case whatsmeow.MediaAudio:
		msg = &waE2E.Message{
			AudioMessage: &waE2E.AudioMessage{
				URL:           ptrString(uploaded.URL),
				DirectPath:    ptrString(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    fileLen,
				Mimetype:      ptrString(mimeType),
			},
		}
	case whatsmeow.MediaVideo:
		msg = &waE2E.Message{
			VideoMessage: &waE2E.VideoMessage{
				URL:           ptrString(uploaded.URL),
				DirectPath:    ptrString(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    fileLen,
				Mimetype:      ptrString(mimeType),
				Caption:       ptrString(caption),
			},
		}
	default: // document
		msg = &waE2E.Message{
			DocumentMessage: &waE2E.DocumentMessage{
				URL:           ptrString(uploaded.URL),
				DirectPath:    ptrString(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    fileLen,
				Mimetype:      ptrString(mimeType),
				FileName:      ptrString(filename),
				Title:         ptrString(caption),
			},
		}
	}
	resp, err := s.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

// React sends a reaction emoji to a specific message.
// fromMe is currently unused but kept for future expansion.
func (s *Session) React(ctx context.Context, chatJID, msgID, senderJID string, fromMe bool, emoji string) error {
	if err := s.ensureOpen(); err != nil {
		return err
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return fmt.Errorf("invalid chat JID %q: %w", chatJID, err)
	}
	sender, err := types.ParseJID(senderJID)
	if err != nil {
		return fmt.Errorf("invalid sender JID %q: %w", senderJID, err)
	}
	reaction := s.client.BuildReaction(chat, sender, types.MessageID(msgID), emoji)
	_, err = s.client.SendMessage(ctx, chat, reaction)
	return err
}

// Revoke deletes (revokes) a message for everyone.
// fromMe is currently unused but kept for future expansion.
func (s *Session) Revoke(ctx context.Context, chatJID, msgID, senderJID string, fromMe bool) error {
	if err := s.ensureOpen(); err != nil {
		return err
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return fmt.Errorf("invalid chat JID %q: %w", chatJID, err)
	}
	sender, err := types.ParseJID(senderJID)
	if err != nil {
		return fmt.Errorf("invalid sender JID %q: %w", senderJID, err)
	}
	revoke := s.client.BuildRevoke(chat, sender, types.MessageID(msgID))
	_, err = s.client.SendMessage(ctx, chat, revoke)
	return err
}

// RequestHistoryBackfill asks the primary device to send count messages
// before the newest locally-known message in chatJID.
// Uses BuildHistorySyncRequest + SendPeerMessage (the correct API for on-demand history).
func (s *Session) RequestHistoryBackfill(ctx context.Context, chatJID string, count int) error {
	if err := s.ensureOpen(); err != nil {
		return err
	}
	msgs, err := s.store.GetMessagesByChat(chatJID, 1, 0)
	if err != nil {
		return fmt.Errorf("store lookup: %w", err)
	}
	if len(msgs) == 0 {
		return fmt.Errorf("no known messages in chat %q — cannot anchor backfill", chatJID)
	}
	// The newest message is last after GetMessagesByChat reversal.
	newest := msgs[len(msgs)-1]
	chat, err := types.ParseJID(newest.ChatJID)
	if err != nil {
		return fmt.Errorf("invalid chat JID %q: %w", newest.ChatJID, err)
	}
	sender, err := types.ParseJID(newest.SenderJID)
	if err != nil {
		// Fall back to empty JID if sender is missing.
		sender = types.EmptyJID
	}
	anchor := &types.MessageInfo{}
	anchor.Chat = chat
	anchor.Sender = sender
	anchor.ID = types.MessageID(newest.MsgID)
	anchor.IsFromMe = newest.FromMe
	anchor.Timestamp = time.Unix(newest.Ts, 0)

	req := s.client.BuildHistorySyncRequest(anchor, count)
	_, err = s.client.SendPeerMessage(ctx, req)
	return err
}

// --- helpers ---

func ptrString(s string) *string { return &s }

func ptrUint64(n uint64) *uint64 { return &n }

// mediaTypeFromMime maps a MIME type prefix to the corresponding whatsmeow.MediaType.
func mediaTypeFromMime(mime string) whatsmeow.MediaType {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return whatsmeow.MediaImage
	case strings.HasPrefix(mime, "audio/"):
		return whatsmeow.MediaAudio
	case strings.HasPrefix(mime, "video/"):
		return whatsmeow.MediaVideo
	default:
		return whatsmeow.MediaDocument
	}
}

// ensureOpen is used by methods that need the whatsmeow client to be ready.
func (s *Session) ensureOpen() error {
	if s.client == nil {
		return fmt.Errorf("%w: no whatsmeow client", errClosed)
	}
	return nil
}

// Close disconnects from WhatsApp and releases resources.
// Safe to call multiple times; subsequent calls are no-ops.
func (s *Session) Close() error {
	s.mu.Lock()
	if s.state == StateClosed {
		s.mu.Unlock()
		return nil
	}
	s.state = StateClosed
	s.mu.Unlock()

	if s.client != nil {
		s.client.Disconnect()
		s.client = nil
	}
	if s.container != nil {
		_ = s.container.Close()
		s.container = nil
	}
	if s.store != nil {
		_ = s.store.Close()
		s.store = nil
	}
	return nil
}
