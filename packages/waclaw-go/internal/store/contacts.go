package store

import "time"

// Contact is a contacts table row.
type Contact struct {
	JID          string
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
	_, err := s.db.Exec(`
		INSERT INTO contacts (jid, phone, push_name, full_name, first_name, business_name, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			phone = COALESCE(NULLIF(excluded.phone, ''), contacts.phone),
			push_name = COALESCE(NULLIF(excluded.push_name, ''), contacts.push_name),
			full_name = COALESCE(NULLIF(excluded.full_name, ''), contacts.full_name),
			first_name = COALESCE(NULLIF(excluded.first_name, ''), contacts.first_name),
			business_name = COALESCE(NULLIF(excluded.business_name, ''), contacts.business_name),
			updated_at = excluded.updated_at
	`, c.JID, c.Phone, c.PushName, c.FullName, c.FirstName, c.BusinessName, now)
	return err
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
