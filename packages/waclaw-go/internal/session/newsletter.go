package session

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/avatars"
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
)

// ResolveNewsletterNames fetches names for all subscribed newsletters using
// the whatsmeow API and updates the chats table. Returns the number of names
// resolved.
func (s *Session) ResolveNewsletterNames(ctx context.Context) (int, error) {
	if err := s.ensureOpen(); err != nil {
		return 0, err
	}
	newsletters, err := s.client.GetSubscribedNewsletters(ctx)
	if err != nil {
		return 0, fmt.Errorf("GetSubscribedNewsletters: %w", err)
	}
	resolved := 0
	for _, nl := range newsletters {
		jid := nl.ID.String()
		name := nl.ThreadMeta.Name.Text
		if name == "" {
			continue
		}
		if err := s.store.UpsertChat(store.Chat{
			JID:  jid,
			Kind: "channel",
			Name: name,
		}); err != nil {
			s.log.Warn().Err(err).Str("jid", jid).Msg("update newsletter name failed")
			continue
		}
		// Download newsletter avatar if available and not cached.
		if nl.ThreadMeta.Picture != nil && nl.ThreadMeta.Picture.URL != "" && !avatars.Exists(s.StoreDir, jid) {
			go func(jid, url string) {
				if err := downloadAndSaveAvatar(s.StoreDir, jid, url); err != nil {
					s.log.Debug().Err(err).Str("jid", jid).Msg("newsletter avatar download failed")
				}
			}(jid, nl.ThreadMeta.Picture.URL)
		}
		resolved++
	}
	return resolved, nil
}

// downloadAndSaveAvatar fetches a URL and saves the content as an avatar.
func downloadAndSaveAvatar(storeDir, jid, url string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return avatars.Save(storeDir, jid, data)
}
