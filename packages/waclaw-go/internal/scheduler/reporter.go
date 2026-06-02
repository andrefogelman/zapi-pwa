package scheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	reportHourBRT  = 19 // 19:00 America/Sao_Paulo
	cleanupHourBRT = 3
	retentionDays  = 7
)

// dailyJobs runs the daily report (19h BRT) and cleanup (3h BRT) at most once
// per BRT day. Called from the 30s scheduler tick.
func (s *Scheduler) dailyJobs(ctx context.Context) {
	now := time.Now().In(brtLoc)
	ymd := now.Format("2006-01-02")

	if now.Hour() == reportHourBRT && s.lastReportYMD != ymd {
		s.lastReportYMD = ymd
		s.runReport(ctx, now)
	}
	if now.Hour() == cleanupHourBRT && s.lastCleanupYMD != ymd {
		s.lastCleanupYMD = ymd
		s.runCleanup(ctx)
	}
}

type reportInstance struct {
	ID              string `json:"id"`
	WaclawSessionID string `json:"waclaw_session_id"`
	ReportPhone     string `json:"report_phone"`
}

type monitoredGroup struct {
	GroupID string `json:"group_id"`
	Subject string `json:"subject"`
}

type groupMessage struct {
	SenderName  string `json:"sender_name"`
	MessageType string `json:"message_type"`
	Content     string `json:"content"`
}

// runReport sends a per-group daily summary to each instance's report_phone.
func (s *Scheduler) runReport(ctx context.Context, now time.Time) {
	var instances []reportInstance
	if err := s.getJSON(ctx, "instances?select=id,waclaw_session_id,report_phone&report_phone=not.is.null", &instances); err != nil {
		s.log.Error().Err(err).Msg("report: fetch instances")
		return
	}
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, brtLoc).Format(time.RFC3339)

	for _, inst := range instances {
		if strings.TrimSpace(inst.ReportPhone) == "" || inst.WaclawSessionID == "" {
			continue
		}
		sess, err := s.mgr.Get(inst.WaclawSessionID)
		if err != nil {
			s.log.Warn().Err(err).Str("session", inst.WaclawSessionID).Msg("report: session not found")
			continue
		}
		var groups []monitoredGroup
		gp := fmt.Sprintf("instance_groups?select=group_id,subject&instance_id=eq.%s&monitor_daily=eq.true", inst.ID)
		if err := s.getJSON(ctx, gp, &groups); err != nil {
			s.log.Error().Err(err).Msg("report: fetch groups")
			continue
		}
		for _, g := range groups {
			var msgs []groupMessage
			mp := fmt.Sprintf(
				"group_messages?select=sender_name,message_type,content&instance_id=eq.%s&group_id=eq.%s&created_at=gte.%s&order=created_at.asc",
				inst.ID, url.QueryEscape(g.GroupID), url.QueryEscape(startOfDay),
			)
			if err := s.getJSON(ctx, mp, &msgs); err != nil {
				s.log.Error().Err(err).Msg("report: fetch messages")
				continue
			}
			if len(msgs) == 0 {
				continue
			}
			var b strings.Builder
			for _, m := range msgs {
				tag := ""
				if m.MessageType == "audio_transcription" {
					tag = " [áudio]"
				}
				fmt.Fprintf(&b, "%s%s: %s\n", m.SenderName, tag, m.Content)
			}
			summary, err := s.groqSummarize(ctx, g.Subject, b.String())
			if err != nil {
				s.log.Error().Err(err).Str("group", g.GroupID).Msg("report: summarize")
				continue
			}
			name := g.Subject
			if name == "" {
				name = g.GroupID
			}
			text := fmt.Sprintf("📋 *Report Diário: %s*\n📊 %d mensagens hoje\n\n*Resumo:*\n%s", name, len(msgs), summary)
			if _, err := sess.SendText(ctx, phoneToJID(inst.ReportPhone), text, ""); err != nil {
				s.log.Error().Err(err).Msg("report: send")
			}
		}
	}
	s.log.Info().Msg("daily report run complete")
}

// runCleanup deletes group_messages older than retentionDays.
func (s *Scheduler) runCleanup(ctx context.Context) {
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format(time.RFC3339)
	u := fmt.Sprintf("%s/rest/v1/group_messages?created_at=lt.%s", s.baseURL, url.QueryEscape(cutoff))
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
	if err != nil {
		s.log.Error().Err(err).Msg("cleanup: build request")
		return
	}
	s.setHeaders(req)
	req.Header.Set("Prefer", "return=minimal")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.log.Error().Err(err).Msg("cleanup: request")
		return
	}
	defer resp.Body.Close()
	s.log.Info().Int("status", resp.StatusCode).Msg("group_messages cleanup run")
}

// groqSummarize summarizes a group's day via Groq chat completions.
func (s *Scheduler) groqSummarize(ctx context.Context, groupName, conversation string) (string, error) {
	if s.groqKey == "" {
		return "", fmt.Errorf("GROQ_API_KEY not set")
	}
	body := map[string]any{
		"model":       "llama-3.3-70b-versatile",
		"temperature": 0.3,
		"messages": []map[string]string{
			{"role": "system", "content": "Você resume conversas de grupos de WhatsApp em português do Brasil. Seja conciso: destaque decisões, tarefas e pendências em bullet points."},
			{"role": "user", "content": fmt.Sprintf("Resuma as conversas de hoje do grupo %q:\n\n%s", groupName, conversation)},
		},
	}
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.groqKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("groq %d", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("groq: empty choices")
	}
	return out.Choices[0].Message.Content, nil
}

// getJSON performs a Supabase REST GET and decodes the JSON array into out.
func (s *Scheduler) getJSON(ctx context.Context, path string, out any) error {
	u := fmt.Sprintf("%s/rest/v1/%s", s.baseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	s.setHeaders(req)
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

// phoneToJID converts a bare phone to a WhatsApp user JID; JIDs pass through.
func phoneToJID(phone string) string {
	if strings.Contains(phone, "@") {
		return phone
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	return digits + "@s.whatsapp.net"
}
