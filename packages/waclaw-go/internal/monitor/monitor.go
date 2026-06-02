// Package monitor subscribes to the event bus and persists group text messages
// to Supabase `group_messages` for instances/groups flagged monitor_daily.
// It is the text counterpart of the audio path (on-audio); the daily report
// (scheduler/reporter.go) summarizes what this collects. Runs off the hot path:
// it consumes the bus asynchronously and never blocks message handling.
package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/events"
	"github.com/rs/zerolog"
)

const refreshInterval = 60 * time.Second

// Monitor persists monitored-group text messages to Supabase.
type Monitor struct {
	bus        *events.Bus
	baseURL    string
	serviceKey string
	log        zerolog.Logger

	mu         sync.RWMutex
	sessToInst map[string]string          // waclaw_session_id -> instance_id
	monitored  map[string]map[string]bool // instance_id -> set(group_id)
}

// New returns a *Monitor, or nil (disabled) if Supabase is not configured.
func New(bus *events.Bus, supabaseURL, serviceKey string, log zerolog.Logger) *Monitor {
	if supabaseURL == "" || serviceKey == "" {
		log.Warn().Msg("monitor disabled: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
		return nil
	}
	return &Monitor{
		bus:        bus,
		baseURL:    supabaseURL,
		serviceKey: serviceKey,
		log:        log.With().Str("component", "monitor").Logger(),
		sessToInst: map[string]string{},
		monitored:  map[string]map[string]bool{},
	}
}

// Run refreshes the monitored-group cache and consumes message events until ctx
// is cancelled.
func (m *Monitor) Run(ctx context.Context) {
	m.refresh(ctx)
	ticker := time.NewTicker(refreshInterval)
	defer ticker.Stop()

	ch, unsub := m.bus.Subscribe(128)
	defer unsub()

	m.log.Info().Msg("monitor started")
	for {
		select {
		case <-ctx.Done():
			m.log.Info().Msg("monitor stopped")
			return
		case <-ticker.C:
			m.refresh(ctx)
		case evt, ok := <-ch:
			if !ok {
				return
			}
			if evt.Type == "message" {
				m.handle(ctx, evt.Raw)
			}
		}
	}
}

// handle persists a group text message when its instance/group is monitored.
func (m *Monitor) handle(ctx context.Context, raw json.RawMessage) {
	var env events.WireEnvelope
	if err := json.Unmarshal(raw, &env); err != nil || env.Message == nil {
		return
	}
	msg := env.Message
	if !strings.HasSuffix(msg.ChatJID, "@g.us") {
		return // groups only
	}
	if strings.TrimSpace(msg.Text) == "" {
		return // text only; audio transcriptions are saved by the on-audio path
	}
	instID, ok := m.lookup(env.SessionID, msg.ChatJID)
	if !ok {
		return
	}
	m.save(ctx, instID, msg)
}

// lookup reports the instance_id if (session, group) is monitored.
func (m *Monitor) lookup(sessionID, groupID string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	inst, ok := m.sessToInst[sessionID]
	if !ok {
		return "", false
	}
	if groups, ok := m.monitored[inst]; ok && groups[groupID] {
		return inst, true
	}
	return "", false
}

func (m *Monitor) save(ctx context.Context, instanceID string, msg *events.WireMessageEvent) {
	row := map[string]any{
		"instance_id":  instanceID,
		"group_id":     msg.ChatJID,
		"group_name":   msg.ChatName,
		"sender":       msg.From,
		"sender_name":  msg.SenderName,
		"message_type": "text",
		"content":      msg.Text,
	}
	data, _ := json.Marshal(row)
	url := fmt.Sprintf("%s/rest/v1/group_messages", m.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		m.log.Error().Err(err).Msg("build group_messages insert")
		return
	}
	m.setHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		m.log.Error().Err(err).Msg("group_messages insert")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		m.log.Error().Int("status", resp.StatusCode).Msg("group_messages insert rejected")
	}
}

// refresh rebuilds the session->instance and instance->monitored-groups maps.
func (m *Monitor) refresh(ctx context.Context) {
	var instances []struct {
		ID              string `json:"id"`
		WaclawSessionID string `json:"waclaw_session_id"`
	}
	if err := m.get(ctx, "instances?select=id,waclaw_session_id", &instances); err != nil {
		m.log.Error().Err(err).Msg("refresh instances")
		return
	}
	var groups []struct {
		InstanceID string `json:"instance_id"`
		GroupID    string `json:"group_id"`
	}
	if err := m.get(ctx, "instance_groups?select=instance_id,group_id&monitor_daily=eq.true", &groups); err != nil {
		m.log.Error().Err(err).Msg("refresh instance_groups")
		return
	}

	sessToInst := make(map[string]string, len(instances))
	for _, in := range instances {
		if in.WaclawSessionID != "" {
			sessToInst[in.WaclawSessionID] = in.ID
		}
	}
	monitored := make(map[string]map[string]bool)
	for _, g := range groups {
		if monitored[g.InstanceID] == nil {
			monitored[g.InstanceID] = make(map[string]bool)
		}
		monitored[g.InstanceID][g.GroupID] = true
	}

	m.mu.Lock()
	m.sessToInst = sessToInst
	m.monitored = monitored
	m.mu.Unlock()
}

// get performs a Supabase REST GET and decodes the JSON array into out.
func (m *Monitor) get(ctx context.Context, path string, out any) error {
	url := fmt.Sprintf("%s/rest/v1/%s", m.baseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	m.setHeaders(req)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase GET %s: %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (m *Monitor) setHeaders(req *http.Request) {
	req.Header.Set("apikey", m.serviceKey)
	req.Header.Set("Authorization", "Bearer "+m.serviceKey)
}
