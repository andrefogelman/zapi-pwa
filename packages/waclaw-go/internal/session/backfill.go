package session

import (
	"context"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	"go.mau.fi/whatsmeow/types"
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

// backfillGroupNames fills in the groups.name column for groups whose subject
// wasn't captured by history sync. Without this, legacy-format group chats
// (local-part `<phone>-<timestamp>`) show up in the UI as raw JIDs.
//
// Strategy: list chats with kind='group' via GetChats, and for each one whose
// resolved display name still equals the JID (meaning nothing — groups.name,
// contact.*_name, chats.name — populated it), call client.GetGroupInfo to
// fetch the real subject from WhatsApp and UpsertGroup with the result.
//
// Rate limits: staggered 1/s, cap maxGroups (default caller passes 50).
// Errors are logged and swallowed — a missing group name is not fatal.
func (s *Session) backfillGroupNames(maxGroups int) {
	if s.store == nil || s.client == nil {
		return
	}
	chats, err := s.store.GetChats()
	if err != nil {
		s.log.Warn().Err(err).Msg("group-name backfill: GetChats failed")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	resolved := 0
	for _, c := range chats {
		if ctx.Err() != nil {
			return
		}
		if c.Kind != "group" {
			continue
		}
		// GetChats' COALESCE resolves to c.jid when nothing names the group,
		// so equality here is our "unnamed" signal.
		if c.Name != "" && c.Name != c.JID {
			continue
		}
		jid, perr := types.ParseJID(c.JID)
		if perr != nil {
			s.log.Debug().Err(perr).Str("jid", c.JID).Msg("group-name backfill: ParseJID failed")
			continue
		}
		info, gerr := s.client.GetGroupInfo(ctx, jid)
		if gerr != nil {
			s.log.Debug().Err(gerr).Str("jid", c.JID).Msg("group-name backfill: GetGroupInfo failed (non-fatal)")
			continue
		}
		g := store.Group{JID: c.JID, Name: info.Name}
		if !info.OwnerJID.IsEmpty() {
			g.OwnerJID = info.OwnerJID.String()
		}
		if !info.GroupCreated.IsZero() {
			g.CreatedTs = info.GroupCreated.Unix()
		}
		if err := s.store.UpsertGroup(g); err != nil {
			s.log.Warn().Err(err).Str("jid", c.JID).Msg("group-name backfill: UpsertGroup failed")
			continue
		}
		resolved++
		if resolved >= maxGroups {
			break
		}
		time.Sleep(1 * time.Second)
	}
	s.log.Info().Int("resolved", resolved).Msg("group name backfill done")
}

// rehydratePendingDownloads re-enqueues media download jobs for messages
// whose direct_path/media_key were persisted but whose local file is still
// missing. History-sync bursts can fill the shared media channel past its
// buffer and legitimate jobs get dropped; this sweep recovers them so the
// pipeline converges even after a rough start.
//
// Staggered at 100ms per enqueue to avoid refilling the channel faster than
// the 4 workers can drain it.
func (s *Session) rehydratePendingDownloads(maxJobs int) {
	if s.store == nil {
		return
	}
	pending, err := s.store.GetPendingMediaDownloads(maxJobs)
	if err != nil {
		s.log.Warn().Err(err).Msg("rehydrate: GetPendingMediaDownloads failed")
		return
	}
	if len(pending) == 0 {
		return
	}
	enqueued, dropped := 0, 0
	for _, m := range pending {
		job := MediaJob{SessionID: s.ID, ChatJID: m.ChatJID, MsgID: m.MsgID}
		select {
		case s.handlerDeps.MediaQueue <- job:
			enqueued++
		default:
			dropped++
		}
		time.Sleep(100 * time.Millisecond)
	}
	s.log.Info().Int("enqueued", enqueued).Int("dropped", dropped).Int("pending_total", len(pending)).Msg("media rehydrate done")
}
