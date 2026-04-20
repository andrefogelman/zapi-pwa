package store

import "database/sql"

// Chat is a row in the chats table. Name comes from the first non-empty
// of group name, contact full_name/business_name/push_name, or the chats.name.
// GetChats resolves the join at query time; callers of UpsertChat just pass
// whatever they have — the display resolution is for reads, not writes.
type Chat struct {
	JID           string
	LID           string // alternate @lid form, when known
	Kind          string // dm | group | broadcast | unknown
	Name          string
	LastMessageTs int64
	Pinned        bool
	ManualUnread  bool

	// Read-only fields populated by GetChats:
	LastMessage string
	LastSender  string
	MsgCount    int64
	IsGroup     bool
}

// SetChatArchived marks a chat as archived or un-archived. Archived chats
// are hidden from the main list by GetChats. Called from history-sync when
// whatsmeow surfaces the WhatsApp user's archive state.
func (s *Store) SetChatArchived(jid string, archived bool) error {
	v := 0
	if archived {
		v = 1
	}
	_, err := s.db.Exec(`UPDATE chats SET archived = ? WHERE jid = ?`, v, jid)
	return err
}

// SetChatPinned pins a chat to the top of the list (or un-pins).
func (s *Store) SetChatPinned(jid string, pinned bool) error {
	v := 0
	if pinned {
		v = 1
	}
	_, err := s.db.Exec(`UPDATE chats SET pinned = ? WHERE jid = ?`, v, jid)
	return err
}

// SetChatManualUnread flags a chat as unread even though the user opened it.
// Overrides the read-tracking on the client.
func (s *Store) SetChatManualUnread(jid string, unread bool) error {
	v := 0
	if unread {
		v = 1
	}
	_, err := s.db.Exec(`UPDATE chats SET manual_unread = ? WHERE jid = ?`, v, jid)
	return err
}

// ClearChatMessages deletes all messages of a chat but keeps the chat row.
// Used by "Clear chat" in the context menu.
func (s *Store) ClearChatMessages(jid string) error {
	_, err := s.db.Exec(`DELETE FROM messages WHERE chat_jid = ?`, jid)
	return err
}

// DeleteChat removes the chat row and all its messages, reactions, and group
// participant rows. Used by "Delete chat" in the context menu.
func (s *Store) DeleteChat(jid string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM messages WHERE chat_jid = ?`, jid); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM reactions WHERE chat_jid = ?`, jid); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM group_participants WHERE group_jid = ?`, jid); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM groups WHERE jid = ?`, jid); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM chats WHERE jid = ?`, jid); err != nil {
		return err
	}
	return tx.Commit()
}

// UpsertChat inserts or updates a single chat row keyed by JID.
// LastMessageTs is only updated if the new value is greater than the
// existing one, so a race between InsertMessage and UpsertChat cannot
// regress the timestamp.
func (s *Store) UpsertChat(c Chat) error {
	_, err := s.db.Exec(`
		INSERT INTO chats (jid, lid, kind, name, last_message_ts)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			lid = COALESCE(excluded.lid, chats.lid),
			kind = excluded.kind,
			name = COALESCE(NULLIF(excluded.name, ''), chats.name),
			last_message_ts = CASE
				WHEN excluded.last_message_ts > chats.last_message_ts THEN excluded.last_message_ts
				ELSE chats.last_message_ts
			END
	`, c.JID, nullIfEmpty(c.LID), c.Kind, c.Name, c.LastMessageTs)
	return err
}

// GetChats returns active chats (last_message_ts > 0) ordered by
// last message time descending. The query mirrors waclaw Node's
// src/db.js getChats() exactly, including the COALESCE resolution of
// display name across groups, contacts, and chat name.
func (s *Store) GetChats() ([]Chat, error) {
	// Using a scalar subquery for the contact name (instead of LEFT JOIN) avoids
	// the cartesian-product bug: the same contact can be stored under both
	// @s.whatsapp.net and @lid JIDs, and a flat JOIN with OR-conditions would
	// return the chat twice. The subquery picks the richest contact (full_name
	// > business_name > push_name), preferring the phone JID when ties occur.
	rows, err := s.db.Query(`
		SELECT
			c.jid,
			COALESCE(c.lid, '') AS lid,
			COALESCE(
				NULLIF(g.name, ''),
				(SELECT COALESCE(NULLIF(ct.full_name, ''), NULLIF(ct.business_name, ''), NULLIF(ct.push_name, ''))
				 FROM contacts ct
				 WHERE ct.jid = c.jid
				    OR ct.jid = c.lid
				    OR (c.lid IS NOT NULL AND (ct.lid = c.jid OR ct.lid = c.lid))
				 ORDER BY
				   CASE WHEN NULLIF(ct.full_name, '') IS NOT NULL THEN 0 ELSE 1 END,
				   CASE WHEN NULLIF(ct.business_name, '') IS NOT NULL THEN 0 ELSE 1 END,
				   CASE WHEN NULLIF(ct.push_name, '') IS NOT NULL THEN 0 ELSE 1 END,
				   CASE WHEN ct.jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END
				 LIMIT 1),
				NULLIF(c.name, ''),
				c.jid
			) AS name,
			c.kind,
			c.last_message_ts,
			COALESCE(c.pinned, 0) AS pinned,
			COALESCE(c.manual_unread, 0) AS manual_unread,
			(SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid) AS msg_count,
			(SELECT text FROM messages m WHERE m.chat_jid = c.jid ORDER BY ts DESC LIMIT 1) AS last_message,
			(SELECT sender_name FROM messages m WHERE m.chat_jid = c.jid ORDER BY ts DESC LIMIT 1) AS last_sender
		FROM chats c
		LEFT JOIN groups g ON c.jid = g.jid
		WHERE c.last_message_ts > 0 AND COALESCE(c.archived, 0) = 0
		ORDER BY COALESCE(c.pinned, 0) DESC, c.last_message_ts DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Chat
	for rows.Next() {
		var c Chat
		var lastMsg, lastSender sql.NullString
		var pinned, manualUnread int
		if err := rows.Scan(&c.JID, &c.LID, &c.Name, &c.Kind, &c.LastMessageTs, &pinned, &manualUnread, &c.MsgCount, &lastMsg, &lastSender); err != nil {
			return nil, err
		}
		c.Pinned = pinned != 0
		c.ManualUnread = manualUnread != 0
		c.LastMessage = lastMsg.String
		c.LastSender = lastSender.String
		c.IsGroup = c.Kind == "group"
		out = append(out, c)
	}
	return out, rows.Err()
}
