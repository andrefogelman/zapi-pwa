package scheduler

import (
	"sort"
	"time"
	_ "time/tzdata" // embed tz database so America/Sao_Paulo resolves without OS tzdata
)

// brtLoc is America/Sao_Paulo; recurrence is computed in BRT (the transcriber's
// original used local runtime time, which broke on UTC hosts). Falls back to UTC.
var brtLoc = func() *time.Location {
	loc, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		return time.UTC
	}
	return loc
}()

// nextOccurrence computes the next scheduled time for a recurring message, in
// BRT. Returns (zero, false) when it should not recur (no pattern, unparseable
// time, unknown pattern, or past recurrence_end_date).
func nextOccurrence(msg scheduledMessage) (time.Time, bool) {
	if msg.RecurrencePattern == "" {
		return time.Time{}, false
	}
	cur, err := time.Parse(time.RFC3339, msg.ScheduledFor)
	if err != nil {
		return time.Time{}, false
	}
	cur = cur.In(brtLoc)

	interval := msg.RecurrenceInterval
	if interval < 1 {
		interval = 1
	}

	var next time.Time
	switch msg.RecurrencePattern {
	case "daily":
		next = cur.AddDate(0, 0, interval)
	case "weekly":
		if len(msg.RecurrenceDays) == 0 {
			next = cur.AddDate(0, 0, 7*interval)
		} else {
			next = nextWeeklyDay(cur, msg.RecurrenceDays)
		}
	case "monthly":
		next = cur.AddDate(0, interval, 0)
	default:
		return time.Time{}, false
	}

	if msg.RecurrenceEndDate != "" {
		if end, err := time.Parse(time.RFC3339, msg.RecurrenceEndDate); err == nil && next.After(end) {
			return time.Time{}, false
		}
	}
	return next, true
}

// nextWeeklyDay returns the next weekday (0=Sun..6=Sat) in days strictly after
// cur's weekday, wrapping to the first listed day in the following week.
func nextWeeklyDay(cur time.Time, days []int) time.Time {
	curDow := int(cur.Weekday())
	sorted := append([]int(nil), days...)
	sort.Ints(sorted)
	for _, d := range sorted {
		if d > curDow {
			return cur.AddDate(0, 0, d-curDow)
		}
	}
	return cur.AddDate(0, 0, 7-curDow+sorted[0])
}
