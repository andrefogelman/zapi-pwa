package store

import "testing"

func TestInsertMessage_UniqueConstraint(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertChat(Chat{JID: "a@s.whatsapp.net", Kind: "dm", Name: "Alice", LastMessageTs: 1}); err != nil {
		t.Fatal(err)
	}

	msg := Message{
		ChatJID:   "a@s.whatsapp.net",
		ChatName:  "Alice",
		MsgID:     "ID001",
		SenderJID: "a@s.whatsapp.net",
		Ts:        1000,
		FromMe:    false,
		Text:      "hi",
	}

	if err := s.InsertMessage(msg); err != nil {
		t.Fatalf("first insert: %v", err)
	}

	// Second insert with same (chat_jid, msg_id) must not error (INSERT OR IGNORE).
	if err := s.InsertMessage(msg); err != nil {
		t.Fatalf("duplicate insert must be silent: %v", err)
	}

	// Still only 1 row.
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM messages WHERE chat_jid=? AND msg_id=?`,
		"a@s.whatsapp.net", "ID001").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
}

func TestGetMessagesByChat_OrderAndPagination(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertChat(Chat{JID: "a@s.whatsapp.net", Kind: "dm", Name: "Alice", LastMessageTs: 5}); err != nil {
		t.Fatal(err)
	}

	for i := 1; i <= 5; i++ {
		m := Message{
			ChatJID: "a@s.whatsapp.net",
			MsgID:   string(rune('A' + i - 1)),
			Ts:      int64(i * 100),
			Text:    string(rune('a' + i - 1)),
		}
		if err := s.InsertMessage(m); err != nil {
			t.Fatal(err)
		}
	}

	// Default: latest 50, chronological ASC in the result.
	msgs, err := s.GetMessagesByChat("a@s.whatsapp.net", 50, 0, 0)
	if err != nil {
		t.Fatalf("GetMessagesByChat: %v", err)
	}
	if len(msgs) != 5 {
		t.Fatalf("len = %d, want 5", len(msgs))
	}
	// Chronological ASC (oldest first, matches waclaw Node getMessages
	// which reverses after SELECT ... ORDER BY ts DESC).
	for i, m := range msgs {
		wantTs := int64((i + 1) * 100)
		if m.Ts != wantTs {
			t.Errorf("msgs[%d].Ts = %d, want %d", i, m.Ts, wantTs)
		}
	}
}

func TestGetMessagesByChat_BeforeCursor(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertChat(Chat{JID: "a@s.whatsapp.net", Kind: "dm", Name: "A", LastMessageTs: 5}); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		if err := s.InsertMessage(Message{
			ChatJID: "a@s.whatsapp.net",
			MsgID:   string(rune('A' + i - 1)),
			Ts:      int64(i * 100),
			Text:    "t",
		}); err != nil {
			t.Fatal(err)
		}
	}

	// Ask for messages before ts=300. Should return ts=100 and ts=200 only.
	msgs, err := s.GetMessagesByChat("a@s.whatsapp.net", 50, 300, 0)
	if err != nil {
		t.Fatalf("GetMessagesByChat: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("len = %d, want 2 (before ts=300)", len(msgs))
	}
	if msgs[0].Ts != 100 || msgs[1].Ts != 200 {
		t.Errorf("got ts=[%d,%d], want [100,200]", msgs[0].Ts, msgs[1].Ts)
	}
}

func TestGetMessageByID(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertChat(Chat{JID: "a@s.whatsapp.net", Kind: "dm", Name: "A", LastMessageTs: 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertMessage(Message{
		ChatJID: "a@s.whatsapp.net",
		MsgID:   "XYZ",
		Ts:      1000,
		Text:    "needle",
	}); err != nil {
		t.Fatal(err)
	}

	m, err := s.GetMessageByID("a@s.whatsapp.net", "XYZ")
	if err != nil {
		t.Fatalf("GetMessageByID: %v", err)
	}
	if m == nil || m.Text != "needle" {
		t.Errorf("got %+v, want Text=needle", m)
	}

	// Missing ID returns (nil, nil).
	missing, err := s.GetMessageByID("a@s.whatsapp.net", "NOPE")
	if err != nil {
		t.Errorf("unexpected err: %v", err)
	}
	if missing != nil {
		t.Errorf("expected nil for missing msg, got %+v", missing)
	}
}

func TestSearchMessages_FTS5(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertChat(Chat{JID: "a@s.whatsapp.net", Kind: "dm", Name: "A", LastMessageTs: 3}); err != nil {
		t.Fatal(err)
	}
	for i, text := range []string{"orange apple", "banana", "orange juice"} {
		if err := s.InsertMessage(Message{
			ChatJID:     "a@s.whatsapp.net",
			MsgID:       string(rune('A' + i)),
			Ts:          int64((i + 1) * 100),
			Text:        text,
			DisplayText: text,
		}); err != nil {
			t.Fatal(err)
		}
	}

	results, err := s.SearchMessages("orange", 10)
	if err != nil {
		t.Fatalf("SearchMessages: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("len = %d, want 2 (two 'orange' messages)", len(results))
	}
}
