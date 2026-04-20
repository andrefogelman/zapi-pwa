package store

import "database/sql"

// Message is a row in the messages table. Byte slices (MediaKey, FileSHA256,
// FileEncSHA256) are stored BLOB and carry the same bytes whatsmeow gave us.
type Message struct {
	Rowid         int64
	ChatJID       string
	ChatLID       string // alternate @lid form of the chat, when exposed by whatsmeow
	ChatName      string
	MsgID         string
	SenderJID     string
	SenderLID     string // alternate @lid form of the sender, when exposed by whatsmeow
	SenderName    string
	Ts            int64
	FromMe        bool
	Text          string
	DisplayText   string
	MediaType     string
	MediaCaption  string
	Filename      string
	MimeType      string
	DirectPath    string
	MediaKey      []byte
	FileSHA256    []byte
	FileEncSHA256 []byte
	FileLength    int64
	LocalPath     string
	DownloadedAt  int64
}

// InsertMessage inserts a new message row. Uses INSERT OR IGNORE on the
// unique (chat_jid, msg_id) constraint so duplicate delivery (HistorySync
// replay after reconnect) is silent and cheap. The FTS5 triggers fire
// automatically via the schema.
func (s *Store) InsertMessage(m Message) error {
	_, err := s.db.Exec(`
		INSERT OR IGNORE INTO messages (
			chat_jid, chat_lid, chat_name, msg_id, sender_jid, sender_lid, sender_name, ts, from_me,
			text, display_text, media_type, media_caption, filename, mime_type,
			direct_path, media_key, file_sha256, file_enc_sha256, file_length,
			local_path, downloaded_at
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
	`,
		m.ChatJID, nullable(m.ChatLID), nullable(m.ChatName), m.MsgID, nullable(m.SenderJID), nullable(m.SenderLID), nullable(m.SenderName),
		m.Ts, boolToInt(m.FromMe),
		nullable(m.Text), nullable(m.DisplayText),
		nullable(m.MediaType), nullable(m.MediaCaption), nullable(m.Filename), nullable(m.MimeType),
		nullable(m.DirectPath), m.MediaKey, m.FileSHA256, m.FileEncSHA256,
		nullableInt(m.FileLength), nullable(m.LocalPath), nullableInt(m.DownloadedAt),
	)
	return err
}

// GetMessagesByChat returns up to limit messages for a chat, ordered
// chronologically ascending (oldest first) — matching the waclaw Node
// behavior which SELECTs ORDER BY ts DESC then reverses the slice.
//
// If beforeTs > 0, only returns messages with ts < beforeTs (pagination cursor).
// If afterTs > 0, only returns messages with ts > afterTs (new-message polling).
func (s *Store) GetMessagesByChat(chatJID string, limit int, beforeTs, afterTs int64) ([]Message, error) {
	var rows *sql.Rows
	var err error
	// notEmpty filters out ghost rows created by protocol messages we don't
	// render (edits, poll votes, unwrapped reactions, etc.) — they'd show up
	// as empty bubbles with just the sender name.
	const notEmpty = ` AND (
		(text IS NOT NULL AND text != '')
		OR (display_text IS NOT NULL AND display_text != '')
		OR (media_type IS NOT NULL AND media_type != '')
	)`
	switch {
	case afterTs > 0:
		rows, err = s.db.Query(`
			SELECT `+messageCols+` FROM messages
			WHERE chat_jid = ? AND ts > ?`+notEmpty+`
			ORDER BY ts ASC LIMIT ?`,
			chatJID, afterTs, limit)
	case beforeTs > 0:
		rows, err = s.db.Query(`
			SELECT `+messageCols+` FROM messages
			WHERE chat_jid = ? AND ts < ?`+notEmpty+`
			ORDER BY ts DESC LIMIT ?`,
			chatJID, beforeTs, limit)
	default:
		rows, err = s.db.Query(`
			SELECT `+messageCols+` FROM messages
			WHERE chat_jid = ?`+notEmpty+`
			ORDER BY ts DESC LIMIT ?`,
			chatJID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var collected []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		collected = append(collected, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// afterTs results are already ASC; before/default need reversal.
	if afterTs == 0 {
		for i, j := 0, len(collected)-1; i < j; i, j = i+1, j-1 {
			collected[i], collected[j] = collected[j], collected[i]
		}
	}
	return collected, nil
}

// GetMessageByID returns a single message or (nil, nil) if not found.
func (s *Store) GetMessageByID(chatJID, msgID string) (*Message, error) {
	row := s.db.QueryRow(`SELECT `+messageCols+` FROM messages WHERE chat_jid = ? AND msg_id = ?`,
		chatJID, msgID)
	m, err := scanMessage(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// SearchMessages runs an FTS5 MATCH query across all indexed columns.
// Results are ordered by ts DESC, up to limit rows.
func (s *Store) SearchMessages(query string, limit int) ([]Message, error) {
	rows, err := s.db.Query(`
		SELECT `+prefixedMessageCols("m.")+` FROM messages_fts fts
		JOIN messages m ON m.rowid = fts.rowid
		WHERE messages_fts MATCH ?
		ORDER BY m.ts DESC LIMIT ?`,
		query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SyncStats summarizes the local store for /sync-status.
type SyncStats struct {
	MessageCount int64 `json:"message_count"`
	ChatCount    int64 `json:"chat_count"`
	OldestMsgTs  int64 `json:"oldest_message_ts,omitempty"`
	NewestMsgTs  int64 `json:"newest_message_ts,omitempty"`
}

// GetSyncStats returns aggregate counts over the full store. Intended for the
// sync-status endpoint so callers can detect gaps between the newest local
// message and wall-clock time (a stale local store implies missed backfill).
func (s *Store) GetSyncStats() (SyncStats, error) {
	var out SyncStats
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&out.MessageCount); err != nil {
		return out, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM chats WHERE last_message_ts > 0`).Scan(&out.ChatCount); err != nil {
		return out, err
	}
	if out.MessageCount > 0 {
		var oldest, newest sql.NullInt64
		_ = s.db.QueryRow(`SELECT MIN(ts), MAX(ts) FROM messages WHERE ts > 0`).Scan(&oldest, &newest)
		out.OldestMsgTs = oldest.Int64
		out.NewestMsgTs = newest.Int64
	}
	return out, nil
}

// UpdateLocalPath records that a message's media has been downloaded.
// GetPendingMediaDownloads returns messages that have media metadata but no
// local file yet. Used to re-enqueue downloads that were dropped from the
// in-memory media queue (e.g., during a history-sync burst that filled the
// channel) so the pipeline is eventually consistent.
func (s *Store) GetPendingMediaDownloads(limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := s.db.Query(`
		SELECT chat_jid, msg_id
		FROM messages
		WHERE media_type != ''
		  AND (local_path IS NULL OR local_path = '')
		  AND direct_path IS NOT NULL AND direct_path != ''
		  AND media_key IS NOT NULL AND length(media_key) > 0
		ORDER BY ts DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ChatJID, &m.MsgID); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) UpdateLocalPath(chatJID, msgID, localPath string, downloadedAt int64) error {
	_, err := s.db.Exec(`
		UPDATE messages SET local_path = ?, downloaded_at = ?
		WHERE chat_jid = ? AND msg_id = ?`,
		localPath, downloadedAt, chatJID, msgID)
	return err
}

// --- scanning helpers (kept here so Message stays a plain struct) ---

const messageCols = `rowid, chat_jid, chat_lid, chat_name, msg_id, sender_jid, sender_lid, sender_name, ts, from_me,
	text, display_text, media_type, media_caption, filename, mime_type,
	direct_path, media_key, file_sha256, file_enc_sha256, file_length,
	local_path, downloaded_at`

func prefixedMessageCols(prefix string) string {
	// Used in JOINs where we need to disambiguate columns.
	return prefix + `rowid, ` + prefix + `chat_jid, ` + prefix + `chat_lid, ` + prefix + `chat_name, ` + prefix + `msg_id, ` +
		prefix + `sender_jid, ` + prefix + `sender_lid, ` + prefix + `sender_name, ` + prefix + `ts, ` + prefix + `from_me, ` +
		prefix + `text, ` + prefix + `display_text, ` + prefix + `media_type, ` + prefix + `media_caption, ` +
		prefix + `filename, ` + prefix + `mime_type, ` + prefix + `direct_path, ` + prefix + `media_key, ` +
		prefix + `file_sha256, ` + prefix + `file_enc_sha256, ` + prefix + `file_length, ` +
		prefix + `local_path, ` + prefix + `downloaded_at`
}

type scanner interface {
	Scan(dest ...any) error
}

func scanMessage(r scanner) (Message, error) {
	var m Message
	var chatLID, chatName, senderJID, senderLID, senderName, text, displayText sql.NullString
	var mediaType, mediaCaption, filename, mimeType, directPath, localPath sql.NullString
	var fileLength, downloadedAt sql.NullInt64
	var fromMeInt int

	err := r.Scan(
		&m.Rowid, &m.ChatJID, &chatLID, &chatName, &m.MsgID, &senderJID, &senderLID, &senderName, &m.Ts, &fromMeInt,
		&text, &displayText, &mediaType, &mediaCaption, &filename, &mimeType,
		&directPath, &m.MediaKey, &m.FileSHA256, &m.FileEncSHA256, &fileLength,
		&localPath, &downloadedAt,
	)
	if err != nil {
		return Message{}, err
	}
	m.ChatLID = chatLID.String
	m.ChatName = chatName.String
	m.SenderJID = senderJID.String
	m.SenderLID = senderLID.String
	m.SenderName = senderName.String
	m.FromMe = fromMeInt != 0
	m.Text = text.String
	m.DisplayText = displayText.String
	m.MediaType = mediaType.String
	m.MediaCaption = mediaCaption.String
	m.Filename = filename.String
	m.MimeType = mimeType.String
	m.DirectPath = directPath.String
	m.FileLength = fileLength.Int64
	m.LocalPath = localPath.String
	m.DownloadedAt = downloadedAt.Int64
	return m, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableInt(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
