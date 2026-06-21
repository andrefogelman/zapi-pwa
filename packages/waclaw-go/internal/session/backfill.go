package session

import (
	"context"
	"database/sql"
	"path/filepath"
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

// backfillContactNamesFromWAStore copies contact names from whatsmeow's own
// session.db (whatsmeow_contacts table) into waclaw.db (contacts table).
//
// Why: whatsmeow caches the full phone-book sync in session.db as part of
// app-state. Our contacts table only gets populated from push_name events
// (when a contact messages us) and events.Contact (incremental syncs).
// Contacts who are in the address book but never initiated a message stay
// nameless in waclaw.db, causing the chat list to show raw phone numbers.
// This sweep fixes that at connect time, costing a single multi-row INSERT.
func (s *Session) backfillContactNamesFromWAStore() {
	if s.store == nil {
		return
	}
	sessionDBPath := filepath.Join(s.StoreDir, "session.db")
	src, err := sql.Open("sqlite3", "file:"+sessionDBPath+"?mode=ro&_busy_timeout=5000")
	if err != nil {
		s.log.Warn().Err(err).Msg("contact name backfill: open session.db failed")
		return
	}
	defer src.Close()

	rows, err := src.Query(`
		SELECT their_jid, COALESCE(full_name,''), COALESCE(first_name,'')
		FROM whatsmeow_contacts
		WHERE NULLIF(full_name,'') IS NOT NULL OR NULLIF(first_name,'') IS NOT NULL
	`)
	if err != nil {
		s.log.Warn().Err(err).Msg("contact name backfill: query failed")
		return
	}
	defer rows.Close()

	copied := 0
	for rows.Next() {
		var jid, full, first string
		if err := rows.Scan(&jid, &full, &first); err != nil {
			continue
		}
		if err := s.store.UpsertContact(store.Contact{
			JID:       jid,
			FullName:  full,
			FirstName: first,
		}); err != nil {
			continue
		}
		copied++
	}
	s.log.Info().Int("copied", copied).Msg("contact name backfill done")

	// Sync the LID→phone mapping from whatsmeow_lid_map so that:
	//  1. GetChats identityKey query can collapse LID-addressed incoming chats
	//     with the phone-JID chat that holds the outbound messages.
	//  2. MergeLIDChatsIntoPhone can find the phone JID for each @lid chat.
	lidRows, lerr := src.Query(`SELECT lid, pn FROM whatsmeow_lid_map`)
	if lerr != nil {
		s.log.Warn().Err(lerr).Msg("lid_map backfill: query failed")
		return
	}
	defer lidRows.Close()
	var mappings [][2]string
	for lidRows.Next() {
		var lid, pn string
		if lidRows.Scan(&lid, &pn) != nil || lid == "" || pn == "" {
			continue
		}
		mappings = append(mappings, [2]string{lid, pn})
	}
	synced, serr := s.store.SyncLIDMappings(mappings)
	if serr != nil {
		s.log.Warn().Err(serr).Msg("lid_map backfill: sync failed")
	} else {
		s.log.Info().Int("synced", synced).Msg("lid_map backfill done")
	}

	// Retroactively merge existing LID-addressed DM chats into their phone-JID
	// counterparts. This fixes historical incoming replies that were stored under
	// a @lid chat JID before this mapping was available.
	if mergeRes, merr := s.store.MergeLIDChatsIntoPhone(); merr != nil {
		s.log.Warn().Err(merr).Msg("lid chat merge: failed")
	} else if mergeRes.ChatsProcessed > 0 {
		s.log.Info().
			Int("chats", mergeRes.ChatsProcessed).
			Int("messages", mergeRes.MessagesMoved).
			Msg("lid chat merge done")
	}
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
