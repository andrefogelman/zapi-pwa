package store

import (
	"path/filepath"
	"testing"
)

func TestOpen_CreatesSchemaAndIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	s1, err := Open(path)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}

	// Schema must exist.
	var tableCount int
	err = s1.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('chats','messages','groups','contacts','schema_migrations','messages_fts')`,
	).Scan(&tableCount)
	if err != nil {
		t.Fatalf("count tables: %v", err)
	}
	if tableCount < 6 {
		t.Errorf("expected 6 expected tables, got %d", tableCount)
	}

	// Migration row recorded.
	var version int
	err = s1.db.QueryRow(`SELECT version FROM schema_migrations WHERE version=1`).Scan(&version)
	if err != nil {
		t.Errorf("schema_migrations row 1 missing: %v", err)
	}

	if err := s1.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Second Open on same file must succeed (idempotent).
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer s2.Close()

	// Still exactly 1 row in schema_migrations for version 1.
	var count int
	if err := s2.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version=1`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("schema_migrations rows for v1 = %d, want 1", count)
	}
}

func TestOpen_EmptyPath(t *testing.T) {
	_, err := Open("")
	if err == nil {
		t.Fatal("expected error on empty path")
	}
}

func TestOpen_FTS5Works(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	// Insert a chat (parent row for messages FK).
	_, err = s.db.Exec(`INSERT INTO chats (jid, kind, name, last_message_ts) VALUES (?, 'dm', 'Alice', ?)`,
		"5511987654321@s.whatsapp.net", 1775000000)
	if err != nil {
		t.Fatalf("insert chat: %v", err)
	}

	// Insert a message — trigger should populate messages_fts.
	_, err = s.db.Exec(`
		INSERT INTO messages (chat_jid, chat_name, msg_id, sender_jid, sender_name, ts, from_me, text, display_text)
		VALUES (?, 'Alice', 'ABC123', ?, 'Alice', 1775000001, 0, 'hello from alice', 'hello from alice')`,
		"5511987654321@s.whatsapp.net", "5511987654321@s.whatsapp.net")
	if err != nil {
		t.Fatalf("insert message: %v", err)
	}

	// FTS MATCH must find it.
	var found string
	err = s.db.QueryRow(`
		SELECT m.msg_id FROM messages_fts fts
		JOIN messages m ON m.rowid = fts.rowid
		WHERE messages_fts MATCH ?
		LIMIT 1`, "alice").Scan(&found)
	if err != nil {
		t.Fatalf("FTS query: %v", err)
	}
	if found != "ABC123" {
		t.Errorf("FTS found %q, want ABC123", found)
	}
}
