package session

import (
	"context"
	"time"
)

// passiveBackfillOnConnect triggers a low-priority history sync request for
// the top-N most recently active chats after a successful connection.
//
// Why: WhatsApp's automatic HistorySync on reconnect is opportunistic — the
// server decides what to send and often skips long-dormant chats. Without
// this, a daemon that was offline for hours returns to a local store with
// gaps the user can only fill via manual "load older" clicks.
//
// Rate limits: we stagger requests (1/s) and cap at topN chats to stay well
// under WhatsApp's peer-message throttling.
func (s *Session) passiveBackfillOnConnect(topN int, perChat int) {
	if s.store == nil {
		return
	}
	chats, err := s.store.GetChats()
	if err != nil {
		s.log.Warn().Err(err).Msg("backfill: GetChats failed")
		return
	}
	if len(chats) == 0 {
		return
	}
	if len(chats) > topN {
		chats = chats[:topN]
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	sent := 0
	for _, c := range chats {
		if ctx.Err() != nil {
			return
		}
		if err := s.RequestHistoryBackfill(ctx, c.JID, perChat); err != nil {
			s.log.Debug().Err(err).Str("jid", c.JID).Msg("backfill: request failed (non-fatal)")
			continue
		}
		sent++
		time.Sleep(1 * time.Second)
	}
	s.log.Info().Int("chats", sent).Int("per_chat", perChat).Msg("passive backfill kicked off")
}
