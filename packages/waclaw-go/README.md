# waclaw-go

Go daemon that embeds `go.mau.fi/whatsmeow` and exposes a multi-tenant HTTP + SSE API for the zapi-pwa project.

Replaces the previous `waclaw` Node service + `wacli` CLI binary orchestration with a single in-process pipeline: whatsmeow event → SQLite + FTS5 → SSE broadcast → HTTP consumers.

## Features

- Multi-session: one whatsmeow client per tenant, isolated store directory
- SQLite store with FTS5 full-text search
- History backfill via `RequestHistorySyncOnDemand`
- Media download async with worker pool
- HTTP parity with the old waclaw Node service
- SSE push at `GET /events` consumed by the zapi-pwa daemon (`packages/daemon`)

## Build

    CGO_ENABLED=1 go build -tags sqlite_fts5 -o bin/waclaw-go ./cmd/waclaw-go

Or:

    make build

## Run (local dev)

    export WACLAW_API_KEY=dev-key
    export PORT=3100
    export SESSIONS_DIR=./_sessions
    ./bin/waclaw-go

## Tests

    make test
