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

	// Read-only fields populated by GetChats:
	LastMessage string
	LastSender  string
	MsgCount    int64
	IsGroup     bool
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
	rows, err := s.db.Query(`
		SELECT
			c.jid,
			COALESCE(c.lid, '') AS lid,
			COALESCE(
				NULLIF(g.name, ''),
				NULLIF(ct.full_name, ''),
				NULLIF(ct.business_name, ''),
				NULLIF(ct.push_name, ''),
				NULLIF(c.name, ''),
				c.jid
			) AS name,
			c.kind,
			c.last_message_ts,
			(SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid) AS msg_count,
			(SELECT text FROM messages m WHERE m.chat_jid = c.jid ORDER BY ts DESC LIMIT 1) AS last_message,
			(SELECT sender_name FROM messages m WHERE m.chat_jid = c.jid ORDER BY ts DESC LIMIT 1) AS last_sender
		FROM chats c
		LEFT JOIN contacts ct ON c.jid = ct.jid OR c.jid = ct.lid OR (c.lid IS NOT NULL AND (c.lid = ct.jid OR c.lid = ct.lid))
		LEFT JOIN groups g ON c.jid = g.jid
		WHERE c.last_message_ts > 0
		ORDER BY c.last_message_ts DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Chat
	for rows.Next() {
		var c Chat
		var lastMsg, lastSender sql.NullString
		if err := rows.Scan(&c.JID, &c.LID, &c.Name, &c.Kind, &c.LastMessageTs, &c.MsgCount, &lastMsg, &lastSender); err != nil {
			return nil, err
		}
		c.LastMessage = lastMsg.String
		c.LastSender = lastSender.String
		c.IsGroup = c.Kind == "group"
		out = append(out, c)
	}
	return out, rows.Err()
}
