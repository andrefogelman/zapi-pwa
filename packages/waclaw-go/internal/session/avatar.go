package session

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// Client returns the underlying whatsmeow client for operations that need
// direct access (e.g., avatar download). Returns nil if session is closed.
func (s *Session) Client() *whatsmeow.Client {
	return s.client
}

// GetProfilePicture fetches the profile picture for a JID from the WhatsApp
// servers. Returns the JPEG bytes or an error. Returns (nil, nil) when the
// contact has no profile picture set.
func (s *Session) GetProfilePicture(ctx context.Context, jid string) ([]byte, error) {
	if err := s.ensureOpen(); err != nil {
		return nil, err
	}
	parsed, err := types.ParseJID(jid)
	if err != nil {
		return nil, fmt.Errorf("invalid JID %q: %w", jid, err)
	}
	pic, err := s.client.GetProfilePictureInfo(ctx, parsed, &whatsmeow.GetProfilePictureParams{})
	if err != nil {
		return nil, fmt.Errorf("GetProfilePictureInfo: %w", err)
	}
	if pic == nil || pic.URL == "" {
		return nil, nil // no profile picture set
	}
	resp, err := http.Get(pic.URL)
	if err != nil {
		return nil, fmt.Errorf("download avatar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("avatar HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read avatar body: %w", err)
	}
	return data, nil
}
