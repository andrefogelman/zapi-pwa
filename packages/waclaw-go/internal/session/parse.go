package session

import (
	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	waevt "go.mau.fi/whatsmeow/types/events"
)

// parseLiveMessage converts a live whatsmeow events.Message into a store.Message
// ready for InsertMessage. MediaKey/FileSHA256/FileEncSHA256 BLOBs are copied
// verbatim so the media-queue worker can download later without re-requesting.
//
// LID handling: whatsmeow exposes both the primary address (Chat/Sender) and
// the alternate address (ChatAlt via RecipientAlt for DMs / SenderAlt) when
// the server provides it. We capture the @lid form in ChatLID/SenderLID so
// downstream dedup and echo-prevention can match either form.
func parseLiveMessage(evt *waevt.Message) store.Message {
	info := evt.Info
	m := store.Message{
		ChatJID:    info.Chat.String(),
		ChatLID:    pickLID(info.Chat, info.RecipientAlt),
		MsgID:      string(info.ID),
		SenderJID:  info.Sender.String(),
		SenderLID:  pickLID(info.Sender, info.SenderAlt),
		SenderName: info.PushName,
		Ts:         info.Timestamp.Unix(),
		FromMe:     info.IsFromMe,
	}
	if evt.Message != nil {
		extractFromProto(evt.Message, &m)
	}
	return m
}

// pickLID returns the @lid form among primary/alternate JIDs, if any.
// Returns "" when neither side is LID-addressed (regular phone DMs/groups).
func pickLID(primary, alt types.JID) string {
	if primary.Server == types.HiddenUserServer {
		return primary.String()
	}
	if !alt.IsEmpty() && alt.Server == types.HiddenUserServer {
		return alt.String()
	}
	return ""
}

// extractFromProto fills store.Message fields from a waE2E.Message proto.
// Called from both parseLiveMessage and handleHistorySync.
func extractFromProto(pm *waE2E.Message, m *store.Message) {
	if pm == nil {
		return
	}

	// Plain text.
	if t := pm.GetConversation(); t != "" {
		m.Text = t
		return
	}
	if ext := pm.GetExtendedTextMessage(); ext != nil {
		m.Text = ext.GetText()
		return
	}

	// Image.
	if img := pm.GetImageMessage(); img != nil {
		m.MediaType = "image"
		m.MimeType = img.GetMimetype()
		m.MediaCaption = img.GetCaption()
		m.DirectPath = img.GetDirectPath()
		m.MediaKey = img.GetMediaKey()
		m.FileSHA256 = img.GetFileSHA256()
		m.FileEncSHA256 = img.GetFileEncSHA256()
		m.FileLength = int64(img.GetFileLength())
		return
	}

	// Video.
	if vid := pm.GetVideoMessage(); vid != nil {
		m.MediaType = "video"
		m.MimeType = vid.GetMimetype()
		m.MediaCaption = vid.GetCaption()
		m.DirectPath = vid.GetDirectPath()
		m.MediaKey = vid.GetMediaKey()
		m.FileSHA256 = vid.GetFileSHA256()
		m.FileEncSHA256 = vid.GetFileEncSHA256()
		m.FileLength = int64(vid.GetFileLength())
		return
	}

	// Audio / PTT.
	if aud := pm.GetAudioMessage(); aud != nil {
		if aud.GetPTT() {
			m.MediaType = "ptt"
		} else {
			m.MediaType = "audio"
		}
		m.MimeType = aud.GetMimetype()
		m.DirectPath = aud.GetDirectPath()
		m.MediaKey = aud.GetMediaKey()
		m.FileSHA256 = aud.GetFileSHA256()
		m.FileEncSHA256 = aud.GetFileEncSHA256()
		m.FileLength = int64(aud.GetFileLength())
		return
	}

	// Document.
	if doc := pm.GetDocumentMessage(); doc != nil {
		m.MediaType = "document"
		m.MimeType = doc.GetMimetype()
		m.Filename = doc.GetFileName()
		m.MediaCaption = doc.GetCaption()
		m.DirectPath = doc.GetDirectPath()
		m.MediaKey = doc.GetMediaKey()
		m.FileSHA256 = doc.GetFileSHA256()
		m.FileEncSHA256 = doc.GetFileEncSHA256()
		m.FileLength = int64(doc.GetFileLength())
		return
	}

	// Sticker.
	if stk := pm.GetStickerMessage(); stk != nil {
		m.MediaType = "sticker"
		m.MimeType = stk.GetMimetype()
		m.DirectPath = stk.GetDirectPath()
		m.MediaKey = stk.GetMediaKey()
		m.FileSHA256 = stk.GetFileSHA256()
		m.FileEncSHA256 = stk.GetFileEncSHA256()
		m.FileLength = int64(stk.GetFileLength())
		return
	}

	// Fallback displayHint for location, contact, poll, reaction.
	m.DisplayText = displayHint(pm)
}

// audioDurationSeconds returns the duration in seconds from an AudioMessage
// proto, or 0 if the message is nil or has no duration set.
func audioDurationSeconds(pm *waE2E.Message) int {
	if a := pm.GetAudioMessage(); a != nil {
		return int(a.GetSeconds())
	}
	return 0
}

// displayHint returns a short human-readable description for message types
// that do not produce a MediaType or Text we store. Used as DisplayText.
func displayHint(pm *waE2E.Message) string {
	if pm.GetLocationMessage() != nil {
		return "[location]"
	}
	if pm.GetContactMessage() != nil {
		return "[contact]"
	}
	if pm.GetContactsArrayMessage() != nil {
		return "[contacts]"
	}
	if pm.GetPollCreationMessage() != nil {
		return "[poll]"
	}
	if pm.GetReactionMessage() != nil {
		return "[reaction]"
	}
	return ""
}

