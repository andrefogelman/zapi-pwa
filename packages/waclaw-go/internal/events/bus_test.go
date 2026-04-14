package events_test

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/andrefogelman/zapi-pwa/packages/waclaw-go/internal/events"
)

func TestBus_SubscribeReceivesPublished(t *testing.T) {
	b := events.NewBus()
	ch, unsub := b.Subscribe(8)
	defer unsub()

	raw, _ := json.Marshal(map[string]string{"hello": "world"})
	evt := events.Event{Type: "test", Raw: raw}
	b.Publish(evt)

	select {
	case got := <-ch:
		if got.Type != "test" {
			t.Fatalf("expected type %q, got %q", "test", got.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestBus_TwoSubscribersBothReceive(t *testing.T) {
	b := events.NewBus()
	ch1, unsub1 := b.Subscribe(8)
	ch2, unsub2 := b.Subscribe(8)
	defer unsub1()
	defer unsub2()

	raw, _ := json.Marshal(map[string]string{"k": "v"})
	b.Publish(events.Event{Type: "ping", Raw: raw})

	for i, ch := range []<-chan events.Event{ch1, ch2} {
		select {
		case got := <-ch:
			if got.Type != "ping" {
				t.Fatalf("sub %d: expected type ping, got %q", i, got.Type)
			}
		case <-time.After(time.Second):
			t.Fatalf("sub %d: timed out", i)
		}
	}
}

func TestBus_UnsubscribeStopsDelivery(t *testing.T) {
	b := events.NewBus()
	ch, unsub := b.Subscribe(8)

	unsub()

	// After unsubscribe, channel should be closed.
	// Verify count is 0.
	if b.SubscriberCount() != 0 {
		t.Fatalf("expected 0 subscribers, got %d", b.SubscriberCount())
	}

	// Publish should not block or panic.
	raw, _ := json.Marshal("after-unsub")
	b.Publish(events.Event{Type: "ghost", Raw: raw})

	// Channel should be closed (readable with zero value, not blocked).
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("expected channel to be closed after unsubscribe")
		}
	case <-time.After(time.Second):
		t.Fatal("channel not closed after unsubscribe")
	}
}

func TestBus_SlowSubscriberDoesNotBlockPublisher(t *testing.T) {
	b := events.NewBus()
	// buf=1 so it fills quickly
	_, unsub := b.Subscribe(1)
	defer unsub()

	// Fast subscriber with a large buffer.
	fast, unsubFast := b.Subscribe(64)
	defer unsubFast()

	raw, _ := json.Marshal("msg")

	// Publish many events; slow sub's buf will fill. Publisher must not block.
	var wg sync.WaitGroup
	wg.Add(1)
	done := make(chan struct{})
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			b.Publish(events.Event{Type: "flood", Raw: raw})
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on slow subscriber")
	}
	wg.Wait()

	// Fast subscriber should have received events (at least some).
	received := 0
	for {
		select {
		case <-fast:
			received++
		default:
			goto done
		}
	}
done:
	if received == 0 {
		t.Fatal("fast subscriber received no events")
	}
}
