package store

import (
	"database/sql"
	"strings"
	"time"
)

// Reaction is a single reaction row. Emoji = "" means removal.
type Reaction struct {
	ChatJID      string
	TargetMsgID  string
	ReactorJID   string
	ReactorLID   string
	Emoji        string
	Ts           int64
}

// UpsertReaction inserts or overwrites the reaction for a given
// (chat, target msg, reactor). An empty Emoji records a removal
// (callers can filter emoji != '' on reads).
func (s *Store) UpsertReaction(r Reaction) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO reactions (chat_jid, target_msg_id, reactor_jid, reactor_lid, emoji, ts, updated_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(chat_jid, target_msg_id, reactor_jid) DO UPDATE SET
			emoji = excluded.emoji,
			ts = excluded.ts,
			reactor_lid = COALESCE(excluded.reactor_lid, reactions.reactor_lid),
			updated_at = excluded.updated_at
	`, r.ChatJID, r.TargetMsgID, r.ReactorJID, nullable(r.ReactorLID), r.Emoji, r.Ts, now)
	return err
}

// ReactionSummary is the aggregated view of reactions for one target message.
type ReactionSummary struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
}

// GetReactionsForMessages returns reactions grouped by target_msg_id and then
// by emoji, for the given message IDs in a chat. Keys are target_msg_id, values
// are the aggregated emoji -> count list (ordered by count desc). Empty-emoji
// removals are excluded.
func (s *Store) GetReactionsForMessages(chatJID string, msgIDs []string) (map[string][]ReactionSummary, error) {
	if len(msgIDs) == 0 {
		return map[string][]ReactionSummary{}, nil
	}
	placeholders := make([]string, len(msgIDs))
	args := make([]any, 0, len(msgIDs)+1)
	args = append(args, chatJID)
	for i, id := range msgIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := `
		SELECT target_msg_id, emoji, COUNT(*) AS c
		FROM reactions
		WHERE chat_jid = ? AND emoji != '' AND target_msg_id IN (` + strings.Join(placeholders, ",") + `)
		GROUP BY target_msg_id, emoji
		ORDER BY c DESC, emoji ASC
	`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]ReactionSummary, len(msgIDs))
	for rows.Next() {
		var targetID, emoji string
		var count int
		if err := rows.Scan(&targetID, &emoji, &count); err != nil {
			return nil, err
		}
		out[targetID] = append(out[targetID], ReactionSummary{Emoji: emoji, Count: count})
	}
	return out, rows.Err()
}

// reactionsJSONForMsg is a convenience used when the caller already has a
// single-msg lookup and wants a compact rendering. Returns "" when there
// are no reactions.
func (s *Store) reactionsJSONForMsg(chatJID, msgID string) (string, error) {
	row := s.db.QueryRow(`
		SELECT '[' || group_concat('{"emoji":"' || emoji || '","count":' || c || '}', ',') || ']' AS js
		FROM (
			SELECT emoji, COUNT(*) AS c
			FROM reactions
			WHERE chat_jid = ? AND target_msg_id = ? AND emoji != ''
			GROUP BY emoji
			ORDER BY c DESC, emoji ASC
		)
	`, chatJID, msgID)
	var js sql.NullString
	if err := row.Scan(&js); err != nil {
		return "", err
	}
	return js.String, nil
}
