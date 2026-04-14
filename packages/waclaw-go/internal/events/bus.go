// Package events is the in-memory pub/sub bus and SSE broadcaster.
package events

import (
	"encoding/json"
	"sync"
	"sync/atomic"
)

// Event is the canonical unit flowing through the bus.
type Event struct {
	Type string
	Raw  json.RawMessage
}

// subscriber holds a single subscriber's delivery channel and state.
type subscriber struct {
	ch     chan Event
	closed atomic.Bool
	drops  atomic.Uint64
}

// Bus is a simple fan-out pub/sub bus. All methods are safe for concurrent use.
type Bus struct {
	mu     sync.RWMutex
	nextID uint64
	subs   map[uint64]*subscriber
}

// NewBus returns a ready-to-use Bus.
func NewBus() *Bus {
	return &Bus{
		subs: make(map[uint64]*subscriber),
	}
}

// Subscribe registers a new subscriber with the given channel buffer size.
// Returns a receive-only channel and an unsubscribe function. The caller
// must call the returned function to clean up; after calling it the channel
// will be closed.
func (b *Bus) Subscribe(bufSize int) (<-chan Event, func()) {
	if bufSize < 1 {
		bufSize = 1
	}
	sub := &subscriber{ch: make(chan Event, bufSize)}

	b.mu.Lock()
	id := b.nextID
	b.nextID++
	b.subs[id] = sub
	b.mu.Unlock()

	unsub := func() {
		b.mu.Lock()
		delete(b.subs, id)
		b.mu.Unlock()
		// Close channel only once.
		if sub.closed.CompareAndSwap(false, true) {
			close(sub.ch)
		}
	}
	return sub.ch, unsub
}

// Publish fans out evt to every subscriber. Per-subscriber delivery is
// non-blocking: if the subscriber's buffer is full the event is dropped
// and the drop counter incremented.
func (b *Bus) Publish(evt Event) {
	b.mu.RLock()
	subs := make([]*subscriber, 0, len(b.subs))
	for _, s := range b.subs {
		subs = append(subs, s)
	}
	b.mu.RUnlock()

	for _, s := range subs {
		if s.closed.Load() {
			continue
		}
		select {
		case s.ch <- evt:
		default:
			s.drops.Add(1)
		}
	}
}

// SubscriberCount returns the current number of active subscribers.
func (b *Bus) SubscriberCount() int {
	b.mu.RLock()
	n := len(b.subs)
	b.mu.RUnlock()
	return n
}
