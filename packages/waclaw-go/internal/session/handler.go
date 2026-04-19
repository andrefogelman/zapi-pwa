package session

import (
	waevents "github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/events"
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	waHistorySync "go.mau.fi/whatsmeow/proto/waHistorySync"
	waWeb "go.mau.fi/whatsmeow/proto/waWeb"
	waevt "go.mau.fi/whatsmeow/types/events"
)

// HandlerDeps are the collaborators a Session hands to its whatsmeow event
// callback: the event bus (for SSE broadcast and translation downstream),
// the media download queue (for async media fetching), and the base URL used
// to build media download links published in WireEnvelope events.
//
// Created once in main.go and shared across all sessions. Each session still
// gets its OWN *store.Store (one DB per tenant), but the bus and media queue
// are singletons.
type HandlerDeps struct {
	Bus          *waevents.Bus
	MediaQueue   chan<- MediaJob
	MediaBaseURL string
}

// MediaJob is a request to download a message's media asynchronously.
// Handled by workers in internal/session/media_queue.go.
type MediaJob struct {
	SessionID string
	ChatJID   string
	MsgID     string
}

// handleMessage persists a live incoming message, enqueues media download if
// needed, and publishes a WireEnvelope event to the bus.
func (s *Session) handleMessage(evt *waevt.Message) {
	if s.store == nil {
		return
	}
	// Reactions arrive as standalone messages pointing at a target msg_id.
	// Persist them to the reactions table (one row per reactor) so the UI
	// can aggregate emoji chips on the target bubble, then return without
	// creating a plain message row.
	if rm := evt.Message.GetReactionMessage(); rm != nil {
		s.handleReaction(evt, rm)
		return
	}
	m := parseLiveMessage(evt)
	if err := s.store.InsertMessage(m); err != nil {
		s.log.Error().Err(err).Str("msg_id", m.MsgID).Msg("insert message failed")
		return
	}
	// Upsert contact from message sender (keeps push names fresh).
	if m.SenderJID != "" && m.SenderName != "" {
		_ = s.store.UpsertContact(store.Contact{
			JID:      m.SenderJID,
			LID:      m.SenderLID,
			PushName: m.SenderName,
		})
	}
	// Upsert chat entry (keeps chat list in sync with messages).
	_ = s.store.UpsertChat(store.Chat{
		JID:           m.ChatJID,
		LID:           m.ChatLID,
		Kind:          chatKind(m.ChatJID),
		Name:          m.ChatName,
		LastMessageTs: m.Ts,
	})
	// Enqueue media download for media messages.
	if m.MediaType != "" && m.DirectPath != "" {
		job := MediaJob{
			SessionID: s.ID,
			ChatJID:   m.ChatJID,
			MsgID:     m.MsgID,
		}
		select {
		case s.handlerDeps.MediaQueue <- job:
		default:
			s.log.Warn().Str("msg_id", m.MsgID).Msg("media queue full, dropping download job")
		}
	}

	// Publish translated wire event to the bus.
	durationSec := 0
	if evt.Message != nil {
		durationSec = audioDurationSeconds(evt.Message)
	}
	wireEvt, err := waevents.TranslateMessage(waevents.TranslateInput{
		SessionID:       s.ID,
		MessageID:       m.MsgID,
		ChatJID:         m.ChatJID,
		ChatLID:         m.ChatLID,
		ChatName:        m.ChatName,
		SenderJID:       m.SenderJID,
		SenderLID:       m.SenderLID,
		SenderName:      m.SenderName,
		FromMe:          m.FromMe,
		Timestamp:       m.Ts,
		Text:            m.Text,
		MediaType:       m.MediaType,
		MimeType:        m.MimeType,
		FileLength:      m.FileLength,
		DurationSeconds: durationSec,
		MediaBaseURL:    s.handlerDeps.MediaBaseURL,
	})
	if err != nil {
		s.log.Error().Err(err).Str("msg_id", m.MsgID).Msg("translate message failed")
		return
	}
	s.handlerDeps.Bus.Publish(wireEvt)
}

// handleHistorySync processes history sync blobs from whatsmeow.
// Each blob contains multiple Conversations, each with multiple messages.
func (s *Session) handleHistorySync(evt *waevt.HistorySync) {
	if s.store == nil || evt.Data == nil {
		return
	}
	for _, conv := range evt.Data.GetConversations() {
		s.processHistoryConversation(conv)
	}
}

func (s *Session) processHistoryConversation(conv *waHistorySync.Conversation) {
	chatJID := conv.GetID()
	chatName := conv.GetName()
	for _, hsMsg := range conv.GetMessages() {
		wmi := hsMsg.GetMessage()
		if wmi == nil {
			continue
		}
		// Reactions: persist to reactions table, skip the default message insert.
		if rm := wmi.GetMessage().GetReactionMessage(); rm != nil {
			s.persistHistoryReaction(conv, wmi, rm)
			continue
		}
		key := wmi.GetKey()
		if key == nil {
			continue
		}
		msgID := key.GetID()
		if msgID == "" {
			continue
		}
		ts := int64(wmi.GetMessageTimestamp())
		senderJID := ""
		if key.GetParticipant() != "" {
			senderJID = key.GetParticipant()
		}
		pushName := ""
		if wmi.GetPushName() != "" {
			pushName = wmi.GetPushName()
		}
		m := store.Message{
			ChatJID:    chatJID,
			ChatName:   chatName,
			MsgID:      msgID,
			SenderJID:  senderJID,
			SenderName: pushName,
			Ts:         ts,
			FromMe:     key.GetFromMe(),
		}
		if wmi.GetMessage() != nil {
			extractFromProto(wmi.GetMessage(), &m)
		}
		if err := s.store.InsertMessage(m); err != nil {
			s.log.Error().Err(err).Str("msg_id", msgID).Msg("history insert failed")
			continue
		}
		// Enqueue media download for history media messages.
		if m.MediaType != "" && m.DirectPath != "" {
			job := MediaJob{
				SessionID: s.ID,
				ChatJID:   m.ChatJID,
				MsgID:     m.MsgID,
			}
			select {
			case s.handlerDeps.MediaQueue <- job:
			default:
				s.log.Warn().Str("msg_id", m.MsgID).Msg("media queue full (history), dropping")
			}
		}
	}
}

// persistHistoryReaction upserts a reaction from history-sync payload. The
// history format nests the reactor under the message's own Key.Participant
// when in groups, or falls back to the conv ID for DMs.
func (s *Session) persistHistoryReaction(conv *waHistorySync.Conversation, wmi *waWeb.WebMessageInfo, rm *waE2E.ReactionMessage) {
	if s.store == nil || rm == nil {
		return
	}
	targetKey := rm.GetKey()
	if targetKey == nil {
		return
	}
	targetMsgID := targetKey.GetID()
	if targetMsgID == "" {
		return
	}
	chatJID := conv.GetID()
	msgKey := wmi.GetKey()
	reactorJID := ""
	if msgKey != nil {
		if p := msgKey.GetParticipant(); p != "" {
			reactorJID = p
		} else if msgKey.GetFromMe() {
			// Reactor is self — we'll store our own JID when available.
			reactorJID = chatJID
		} else {
			reactorJID = chatJID
		}
	}
	_ = s.store.UpsertReaction(store.Reaction{
		ChatJID:     chatJID,
		TargetMsgID: targetMsgID,
		ReactorJID:  reactorJID,
		Emoji:       rm.GetText(),
		Ts:          int64(wmi.GetMessageTimestamp()),
	})
}

// handleReaction persists a reaction (emoji or removal) targeting an earlier
// message. Called from handleMessage when it detects a ReactionMessage proto.
// Pushes a minimal wire event to the bus so connected clients can refresh the
// target bubble without a full re-fetch.
func (s *Session) handleReaction(evt *waevt.Message, rm *waE2E.ReactionMessage) {
	if s.store == nil || rm == nil {
		return
	}
	targetKey := rm.GetKey()
	if targetKey == nil {
		return
	}
	targetMsgID := targetKey.GetID()
	if targetMsgID == "" {
		return
	}
	chatJID := evt.Info.Chat.String()
	reactorJID := evt.Info.Sender.String()
	reactorLID := pickLID(evt.Info.Sender, evt.Info.SenderAlt)
	if err := s.store.UpsertReaction(store.Reaction{
		ChatJID:     chatJID,
		TargetMsgID: targetMsgID,
		ReactorJID:  reactorJID,
		ReactorLID:  reactorLID,
		Emoji:       rm.GetText(),
		Ts:          evt.Info.Timestamp.Unix(),
	}); err != nil {
		s.log.Warn().Err(err).Str("target", targetMsgID).Msg("upsert reaction failed")
		return
	}
	evt2, err := waevents.TranslateReaction(waevents.WireReactionEvent{
		SessionID:   s.ID,
		ChatJID:     chatJID,
		TargetMsgID: targetMsgID,
		ReactorJID:  reactorJID,
		ReactorLID:  reactorLID,
		Emoji:       rm.GetText(),
		Timestamp:   evt.Info.Timestamp.Unix(),
	})
	if err != nil {
		s.log.Warn().Err(err).Msg("translate reaction failed")
		return
	}
	s.handlerDeps.Bus.Publish(evt2)
}

// handleGroupInfo persists group subject changes (or first-time names) so
// the chat list picks them up without a reconnect. Triggered when an admin
// renames the group or when whatsmeow receives initial metadata for a group.
func (s *Session) handleGroupInfo(evt *waevt.GroupInfo) {
	if s.store == nil {
		return
	}
	if evt.Name == nil || evt.Name.Name == "" {
		return
	}
	if err := s.store.UpsertGroup(store.Group{
		JID:  evt.JID.String(),
		Name: evt.Name.Name,
	}); err != nil {
		s.log.Warn().Err(err).Str("jid", evt.JID.String()).Msg("upsert group from event failed")
	}
}

// handlePushName upserts a contact's push name in the store.
func (s *Session) handlePushName(evt *waevt.PushName) {
	if s.store == nil {
		return
	}
	if err := s.store.UpsertContact(store.Contact{
		JID:      evt.JID.String(),
		PushName: evt.NewPushName,
	}); err != nil {
		s.log.Error().Err(err).Str("jid", evt.JID.String()).Msg("upsert contact from push name failed")
	}
}


// chatKind infers the chat type from the JID suffix.
func chatKind(jid string) string {
	switch {
	case len(jid) > 11 && jid[len(jid)-11:] == "@newsletter":
		return "channel"
	case len(jid) > 5 && jid[len(jid)-5:] == "@g.us":
		return "group"
	case len(jid) > 10 && jid[len(jid)-10:] == "@broadcast":
		return "broadcast"
	default:
		return "dm"
	}
}
