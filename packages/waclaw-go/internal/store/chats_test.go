package store

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestUpsertChat_InsertAndUpdate(t *testing.T) {
	s := newTestStore(t)

	err := s.UpsertChat(Chat{
		JID:           "5511111@s.whatsapp.net",
		Kind:          "dm",
		Name:          "Alice",
		LastMessageTs: 1000,
	})
	if err != nil {
		t.Fatalf("UpsertChat insert: %v", err)
	}

	// Update same jid.
	err = s.UpsertChat(Chat{
		JID:           "5511111@s.whatsapp.net",
		Kind:          "dm",
		Name:          "Alice (updated)",
		LastMessageTs: 2000,
	})
	if err != nil {
		t.Fatalf("UpsertChat update: %v", err)
	}

	// Verify only 1 row total.
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM chats`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("chat count = %d, want 1", count)
	}

	// Verify updated values.
	var name string
	var ts int64
	err = s.db.QueryRow(`SELECT name, last_message_ts FROM chats WHERE jid=?`, "5511111@s.whatsapp.net").
		Scan(&name, &ts)
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if name != "Alice (updated)" {
		t.Errorf("name = %q, want Alice (updated)", name)
	}
	if ts != 2000 {
		t.Errorf("ts = %d, want 2000", ts)
	}
}

func TestGetChats_OrdersByLastMessageDesc(t *testing.T) {
	s := newTestStore(t)

	// Seed 3 chats.
	for _, c := range []Chat{
		{JID: "a@s.whatsapp.net", Kind: "dm", Name: "Alice", LastMessageTs: 1000},
		{JID: "b@s.whatsapp.net", Kind: "dm", Name: "Bob", LastMessageTs: 3000},
		{JID: "c@s.whatsapp.net", Kind: "dm", Name: "Carol", LastMessageTs: 2000},
	} {
		if err := s.UpsertChat(c); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	chats, err := s.GetChats()
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	if len(chats) != 3 {
		t.Fatalf("len = %d, want 3", len(chats))
	}
	// Expected order: Bob (3000), Carol (2000), Alice (1000).
	wantOrder := []string{"Bob", "Carol", "Alice"}
	for i, want := range wantOrder {
		if chats[i].Name != want {
			t.Errorf("chats[%d].Name = %q, want %q", i, chats[i].Name, want)
		}
	}
}

func TestGetChats_SkipsWithZeroLastMessage(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertChat(Chat{JID: "a@s.whatsapp.net", Kind: "dm", Name: "Alice", LastMessageTs: 0}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertChat(Chat{JID: "b@s.whatsapp.net", Kind: "dm", Name: "Bob", LastMessageTs: 1000}); err != nil {
		t.Fatal(err)
	}

	chats, err := s.GetChats()
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	if len(chats) != 1 || chats[0].Name != "Bob" {
		t.Errorf("chats = %+v, want only Bob", chats)
	}
}
