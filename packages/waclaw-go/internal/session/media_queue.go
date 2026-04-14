package session

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/store"
	"go.mau.fi/whatsmeow"
)

// MediaQueueRunner manages a pool of workers that download message media
// from WhatsApp CDN and persist it to disk. Jobs come from the shared
// mediaJobs channel populated by handleMessage / handleHistorySync.
type MediaQueueRunner struct {
	jobs    <-chan MediaJob
	mgr     *Manager
	workers int
}

// NewMediaQueueRunner creates a MediaQueueRunner.
// jobs    — read-only end of the buffered media job channel
// mgr     — used to look up sessions by ID
// workers — number of concurrent download goroutines
func NewMediaQueueRunner(jobs <-chan MediaJob, mgr *Manager, workers int) *MediaQueueRunner {
	if workers < 1 {
		workers = 1
	}
	return &MediaQueueRunner{jobs: jobs, mgr: mgr, workers: workers}
}

// Start launches the worker pool. It returns immediately; workers run
// until ctx is cancelled. The caller should drain or close the jobs channel
// after ctx cancellation if needed (workers will exit on ctx.Done()).
func (r *MediaQueueRunner) Start(ctx context.Context) {
	for i := 0; i < r.workers; i++ {
		go r.worker(ctx, i)
	}
}

func (r *MediaQueueRunner) worker(ctx context.Context, idx int) {
	for {
		select {
		case <-ctx.Done():
			return
		case job, ok := <-r.jobs:
			if !ok {
				return
			}
			r.process(ctx, job, idx)
		}
	}
}

func (r *MediaQueueRunner) process(ctx context.Context, job MediaJob, idx int) {
	sess, err := r.mgr.Get(job.SessionID)
	if err != nil {
		return // session gone
	}
	if sess.store == nil || sess.client == nil {
		return
	}

	// Fetch the persisted message to get the BLOB fields.
	msg, err := sess.store.GetMessageByID(job.ChatJID, job.MsgID)
	if err != nil || msg == nil {
		return
	}
	if msg.DirectPath == "" || len(msg.MediaKey) == 0 {
		return // not a media message or already cleared
	}

	adapter := storedMediaMessage{m: msg}
	data, err := sess.client.Download(ctx, adapter)
	if err != nil {
		sess.log.Warn().Err(err).
			Int("worker", idx).
			Str("msg_id", job.MsgID).
			Msg("media download failed")
		return
	}

	// Write to {StoreDir}/media/{chatJID}/{msgID}
	mediaDir := filepath.Join(sess.StoreDir, "media", job.ChatJID)
	if err := os.MkdirAll(mediaDir, 0o700); err != nil {
		sess.log.Error().Err(err).Msg("mkdir media dir failed")
		return
	}
	localPath := filepath.Join(mediaDir, job.MsgID)
	if err := os.WriteFile(localPath, data, 0o600); err != nil {
		sess.log.Error().Err(err).Msg("write media file failed")
		return
	}

	if err := sess.store.UpdateLocalPath(job.ChatJID, job.MsgID, localPath, time.Now().Unix()); err != nil {
		sess.log.Error().Err(err).Msg("update local_path failed")
		return
	}

	sess.log.Debug().
		Int("worker", idx).
		Str("msg_id", job.MsgID).
		Str("path", localPath).
		Int("bytes", len(data)).
		Msg("media downloaded")
}

// storedMediaMessage adapts a *store.Message to whatsmeow.DownloadableMessage.
// The interface requires exactly: GetDirectPath, GetMediaKey, GetFileSHA256,
// GetFileEncSHA256.
type storedMediaMessage struct {
	m *store.Message
}

func (s storedMediaMessage) GetDirectPath() string    { return s.m.DirectPath }
func (s storedMediaMessage) GetMediaKey() []byte      { return s.m.MediaKey }
func (s storedMediaMessage) GetFileSHA256() []byte    { return s.m.FileSHA256 }
func (s storedMediaMessage) GetFileEncSHA256() []byte { return s.m.FileEncSHA256 }

// mediaTypeFor maps our internal media_type string to whatsmeow.MediaType.
func mediaTypeFor(mt string) whatsmeow.MediaType {
	switch mt {
	case "image":
		return whatsmeow.MediaImage
	case "video":
		return whatsmeow.MediaVideo
	case "audio", "ptt":
		return whatsmeow.MediaAudio
	case "document":
		return whatsmeow.MediaDocument
	case "sticker":
		// whatsmeow uses MediaImage for stickers internally.
		return whatsmeow.MediaImage
	default:
		return whatsmeow.MediaType(fmt.Sprintf("WhatsApp %s Keys", mt))
	}
}
