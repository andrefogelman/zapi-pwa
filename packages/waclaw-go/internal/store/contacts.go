package store

import (
	"strings"
	"time"
)

// Contact is a contacts table row.
// LID is the WhatsApp Local Identifier (e.g. "123456789@lid") — populated when
// whatsmeow exposes the alternate form. Enables dedup when the same contact
// appears under both phone and LID addressing.
type Contact struct {
	JID          string
	LID          string
	Phone        string
	PushName     string
	FullName     string
	FirstName    string
	BusinessName string
}

// Group is a groups table row.
type Group struct {
	JID       string
	Name      string
	OwnerJID  string
	CreatedTs int64
}

// GroupParticipant is a single row in group_participants.
type GroupParticipant struct {
	GroupJID string
	UserJID  string
	Role     string // admin | superadmin | member
}

// UpsertContact upserts a contact. Empty strings in the struct are
// interpreted as "don't overwrite" (COALESCE against existing).
func (s *Store) UpsertContact(c Contact) error {
	now := time.Now().Unix()
	lid := nullIfEmpty(c.LID)
	_, err := s.db.Exec(`
		INSERT INTO contacts (jid, lid, phone, push_name, full_name, first_name, business_name, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			lid = COALESCE(excluded.lid, contacts.lid),
			phone = COALESCE(NULLIF(excluded.phone, ''), contacts.phone),
			push_name = COALESCE(NULLIF(excluded.push_name, ''), contacts.push_name),
			full_name = COALESCE(NULLIF(excluded.full_name, ''), contacts.full_name),
			first_name = COALESCE(NULLIF(excluded.first_name, ''), contacts.first_name),
			business_name = COALESCE(NULLIF(excluded.business_name, ''), contacts.business_name),
			updated_at = excluded.updated_at
	`, c.JID, lid, c.Phone, c.PushName, c.FullName, c.FirstName, c.BusinessName, now)
	return err
}

// FindContactByLID returns the contact whose lid column matches, if any.
// Used to dedup when a message arrives carrying only a LID for a contact
// previously seen under its phone JID.
func (s *Store) FindContactByLID(lid string) (*Contact, error) {
	if lid == "" {
		return nil, nil
	}
	row := s.db.QueryRow(`SELECT jid, COALESCE(lid, ''), COALESCE(phone, ''), COALESCE(push_name, ''), COALESCE(full_name, ''), COALESCE(first_name, ''), COALESCE(business_name, '') FROM contacts WHERE lid = ?`, lid)
	var c Contact
	if err := row.Scan(&c.JID, &c.LID, &c.Phone, &c.PushName, &c.FullName, &c.FirstName, &c.BusinessName); err != nil {
		return nil, err
	}
	return &c, nil
}

// LinkLIDToJID associates a LID with an existing contact JID. Used when
// whatsmeow exposes the phone↔LID mapping (events.UserInfo, PNJID) for a
// contact already stored under its phone JID.
func (s *Store) LinkLIDToJID(jid, lid string) error {
	if jid == "" || lid == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE contacts SET lid = ?, updated_at = ? WHERE jid = ? AND (lid IS NULL OR lid = '')`, lid, time.Now().Unix(), jid)
	return err
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// SetContactBlocked mirrors the WhatsApp blocklist state locally.
func (s *Store) SetContactBlocked(jid string, blocked bool) error {
	v := 0
	if blocked {
		v = 1
	}
	_, err := s.db.Exec(`
		INSERT INTO contacts (jid, blocked, updated_at) VALUES (?, ?, strftime('%s','now'))
		ON CONFLICT(jid) DO UPDATE SET blocked = excluded.blocked, updated_at = strftime('%s','now')
	`, jid, v)
	return err
}

// GetBlockedJIDs returns all contacts currently flagged blocked.
func (s *Store) GetBlockedJIDs() ([]string, error) {
	rows, err := s.db.Query(`SELECT jid FROM contacts WHERE blocked = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// ReplaceBlocklist sets blocked=1 for the given JIDs and 0 for everyone else.
// Used when whatsmeow sends a full Blocklist snapshot (action="modify").
func (s *Store) ReplaceBlocklist(jids []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE contacts SET blocked = 0`); err != nil {
		return err
	}
	for _, j := range jids {
		if _, err := tx.Exec(`
			INSERT INTO contacts (jid, blocked, updated_at) VALUES (?, 1, strftime('%s','now'))
			ON CONFLICT(jid) DO UPDATE SET blocked = 1, updated_at = strftime('%s','now')
		`, j); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetContact returns the full contact row for a JID, or nil if absent.
func (s *Store) GetContact(jid string) (*Contact, error) {
	row := s.db.QueryRow(`
		SELECT jid, COALESCE(lid, ''), COALESCE(phone, ''), COALESCE(push_name, ''), COALESCE(full_name, ''), COALESCE(first_name, ''), COALESCE(business_name, '')
		FROM contacts WHERE jid = ?
	`, jid)
	var c Contact
	if err := row.Scan(&c.JID, &c.LID, &c.Phone, &c.PushName, &c.FullName, &c.FirstName, &c.BusinessName); err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// SearchContacts returns contacts whose push_name / full_name / business_name
// match the given substring (case-insensitive). Used by the "Other contacts"
// section of the chat-list search.
func (s *Store) SearchContacts(term string, limit int) ([]Contact, error) {
	if limit <= 0 {
		limit = 50
	}
	like := "%" + term + "%"
	rows, err := s.db.Query(`
		SELECT jid, COALESCE(lid, ''), COALESCE(phone, ''), COALESCE(push_name, ''), COALESCE(full_name, ''), COALESCE(first_name, ''), COALESCE(business_name, '')
		FROM contacts
		WHERE
			full_name LIKE ? COLLATE NOCASE
			OR push_name LIKE ? COLLATE NOCASE
			OR business_name LIKE ? COLLATE NOCASE
			OR phone LIKE ?
		ORDER BY
			CASE WHEN NULLIF(full_name, '') IS NOT NULL THEN 0 ELSE 1 END,
			full_name ASC, push_name ASC
		LIMIT ?
	`, like, like, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Contact
	for rows.Next() {
		var c Contact
		if err := rows.Scan(&c.JID, &c.LID, &c.Phone, &c.PushName, &c.FullName, &c.FirstName, &c.BusinessName); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// LookupPhoneForLID returns the normalized phone JID (e.g. "5511...@s.whatsapp.net")
// for a LID JID (e.g. "52445912813614@lid" or "52445912813614:1@lid").
// Returns ("", nil) when no mapping is found.
func (s *Store) LookupPhoneForLID(lidJID string) (string, error) {
	// Strip device suffix if present: "12345:1@lid" → "12345@lid"
	localFull := lidJID
	if at := strings.Index(lidJID, "@"); at > 0 {
		local := lidJID[:at]
		if colon := strings.Index(local, ":"); colon > 0 {
			local = local[:colon]
		}
		localFull = local + "@lid"
	}
	var phoneJID string
	err := s.db.QueryRow(`
		SELECT jid FROM contacts
		WHERE jid LIKE '%@s.whatsapp.net'
		  AND (lid = ? OR lid LIKE ?)
		LIMIT 1
	`, localFull, strings.TrimSuffix(localFull, "@lid")+":_%@lid").Scan(&phoneJID)
	if err != nil {
		return "", nil // not found is not an error
	}
	// Normalize: strip device suffix from stored jid
	if colon := strings.Index(phoneJID, ":"); colon > 0 {
		if at := strings.Index(phoneJID, "@"); at > colon {
			phoneJID = phoneJID[:colon] + phoneJID[at:]
		}
	}
	return phoneJID, nil
}

// SyncLIDMappings atomically wires the LID→phone JID links from whatsmeow's
// lid_map table into our contacts table. For each (lid, phoneNumber) pair it:
//  1. Clears lid from any existing contact that holds it (except the phone contact)
//     so the unique index on lid doesn't block the update.
//  2. Upserts the phone-JID contact row, setting its lid field.
//
// Returns the number of mappings successfully applied.
func (s *Store) SyncLIDMappings(mappings [][2]string) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	synced := 0
	for _, pair := range mappings {
		lid, pn := pair[0], pair[1]
		if lid == "" || pn == "" {
			continue
		}
		lidJID := lid + "@lid"
		phoneJID := pn + "@s.whatsapp.net"
		// Clear lid from any other contact that already holds this lid
		// (e.g. the @lid-JID contact row created from a push_name event).
		if _, err := tx.Exec(`UPDATE contacts SET lid = NULL WHERE lid = ? AND jid != ?`, lidJID, phoneJID); err != nil {
			continue
		}
		// Upsert phone contact row with lid. COALESCE so we don't clobber
		// names already present (full_name, push_name, etc.).
		if _, err := tx.Exec(`
			INSERT INTO contacts (jid, lid, updated_at) VALUES (?, ?, strftime('%s','now'))
			ON CONFLICT(jid) DO UPDATE SET
				lid       = excluded.lid,
				updated_at = excluded.updated_at
		`, phoneJID, lidJID); err != nil {
			continue
		}
		synced++
	}
	return synced, tx.Commit()
}

// MergeLIDChatsResult summarizes the result of MergeLIDChatsIntoPhone.
type MergeLIDChatsResult struct {
	ChatsProcessed int
	MessagesMoved  int
}

// MergeLIDChatsIntoPhone migrates messages from LID-addressed DM chats into their
// corresponding phone-JID chats. Called once after backfilling the contacts table
// with the LID→phone mapping so that historical incoming replies appear in the
// right thread.
//
// For each @lid chat where a phone JID is known via the contacts table:
//  1. Reparent all messages (UPDATE messages SET chat_jid = phone WHERE chat_jid = lid)
//  2. Reparent all reactions similarly
//  3. Merge the LID chat's last_message_ts into the phone chat
//  4. Delete the now-empty LID chat row
//
// Skips chats where the phone chat does not exist (to avoid orphan messages).
func (s *Store) MergeLIDChatsIntoPhone() (MergeLIDChatsResult, error) {
	// Collect all @lid DM chats that have a phone-JID mapping.
	rows, err := s.db.Query(`
		SELECT c.jid,
		       (SELECT ct.jid FROM contacts ct
		        WHERE ct.jid LIKE '%@s.whatsapp.net'
		          AND (ct.lid = c.jid OR ct.lid LIKE substr(c.jid, 1, instr(c.jid,'@')-1) || ':%@lid')
		        LIMIT 1) AS phone_jid
		FROM chats c
		WHERE c.jid LIKE '%@lid'
		  AND c.kind = 'dm'
	`)
	if err != nil {
		return MergeLIDChatsResult{}, err
	}
	type pair struct{ lid, phone string }
	var pairs []pair
	for rows.Next() {
		var lid string
		var phone *string
		if rows.Scan(&lid, &phone) == nil && phone != nil && *phone != "" {
			pairs = append(pairs, pair{lid, *phone})
		}
	}
	rows.Close()

	var res MergeLIDChatsResult
	for _, p := range pairs {
		// Ensure the phone chat row exists; if not, rename the LID chat.
		var existsPhone int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM chats WHERE jid = ?`, p.phone).Scan(&existsPhone)
		if existsPhone == 0 {
			// Rename the LID chat to the phone JID.
			// Clear name if it equals the @lid JID (history sync stores JID as placeholder).
			_, _ = s.db.Exec(`UPDATE chats SET jid = ?, kind = 'dm', name = CASE WHEN name = ? THEN NULL ELSE name END WHERE jid = ?`, p.phone, p.lid, p.lid)
			_, _ = s.db.Exec(`UPDATE messages SET chat_jid = ? WHERE chat_jid = ?`, p.phone, p.lid)
			_, _ = s.db.Exec(`UPDATE reactions SET chat_jid = ? WHERE chat_jid = ?`, p.phone, p.lid)
			res.ChatsProcessed++
			continue
		}
		// Move messages.
		res2, err2 := s.db.Exec(`UPDATE messages SET chat_jid = ? WHERE chat_jid = ?`, p.phone, p.lid)
		if err2 == nil {
			n, _ := res2.RowsAffected()
			res.MessagesMoved += int(n)
		}
		// Move reactions.
		_, _ = s.db.Exec(`UPDATE reactions SET chat_jid = ? WHERE chat_jid = ?`, p.phone, p.lid)
		// Merge last_message_ts into the phone chat.
		_, _ = s.db.Exec(`
			UPDATE chats SET last_message_ts = MAX(last_message_ts, (SELECT last_message_ts FROM chats WHERE jid = ?))
			WHERE jid = ?
		`, p.lid, p.phone)
		// Delete the now-empty LID chat.
		_, _ = s.db.Exec(`DELETE FROM chats WHERE jid = ?`, p.lid)
		res.ChatsProcessed++
	}
	return res, nil
}

// UpsertGroup upserts a group row.
func (s *Store) UpsertGroup(g Group) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO groups (jid, name, owner_jid, created_ts, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			name = COALESCE(NULLIF(excluded.name, ''), groups.name),
			owner_jid = COALESCE(NULLIF(excluded.owner_jid, ''), groups.owner_jid),
			created_ts = CASE WHEN excluded.created_ts > 0 THEN excluded.created_ts ELSE groups.created_ts END,
			updated_at = excluded.updated_at
	`, g.JID, g.Name, g.OwnerJID, g.CreatedTs, now)
	return err
}

// ReplaceGroupParticipants truncates participants for a group then re-inserts.
// Used after fetching fresh group info from whatsmeow.
func (s *Store) ReplaceGroupParticipants(groupJID string, participants []GroupParticipant) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM group_participants WHERE group_jid = ?`, groupJID); err != nil {
		return err
	}
	now := time.Now().Unix()
	stmt, err := tx.Prepare(`INSERT INTO group_participants (group_jid, user_jid, role, updated_at) VALUES (?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, p := range participants {
		if _, err := stmt.Exec(p.GroupJID, p.UserJID, p.Role, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}
