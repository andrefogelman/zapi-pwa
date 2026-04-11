# zapi-pwa-daemon

Subscribes to waclaw events on worker5 and forwards audio-only messages to
the Next API at `/api/internal/on-audio` for filtering, transcription, and
optional WhatsApp reply.

## Waclaw events protocol

The code in `src/waclaw-client.ts` assumes **SSE at `GET /events`** with
`data: {json}` lines. This is a hypothesis and MUST be validated against
the real worker5 waclaw service on first deploy.

To check what waclaw actually exposes, SSH into worker5 and run:

    curl -i -H "X-API-Key: $WACLAW_API_KEY" http://localhost:3100/events

If waclaw returns:
- **200 OK** with `Content-Type: text/event-stream` and `data: ...` lines →
  the hypothesis holds, no code change.
- **101 Switching Protocols** / WebSocket → rewrite `connect()` in
  `waclaw-client.ts` to use the native WebSocket client (`new WebSocket(...)`)
  instead of `fetch` + reader loop. The rest of the file does not change.
- **404 Not Found** or something similar → waclaw does not expose a global
  event stream. Fallback: `GET /sessions` every 30s and `GET /sessions/:id/messages?since=cursor`
  per session. Rewrite `connect()` as a polling loop. The cursor can live in
  memory for MVP (downtime → missed messages); persist to disk later.

No other file in the daemon depends on the transport — only `waclaw-client.ts`.

## First-deploy procedure (manual, once)

SSH into worker5 and run:

    ssh openclaw@100.66.83.22
    cd ~
    git clone https://github.com/andrefogelman/zapi-pwa.git  # or git pull if already cloned
    cd zapi-pwa
    git checkout feat/admin-multitenant   # while this branch is in development; later use main
    bun install

    # Create .env (replace placeholders)
    cat > packages/daemon/.env <<EOF
    WACLAW_URL=http://localhost:3100
    WACLAW_API_KEY=<real waclaw key>
    ZAPI_PWA_URL=https://zapi-pwa.vercel.app
    INTERNAL_WEBHOOK_SECRET=<same value as the Vercel env var>
    EOF
    chmod 600 packages/daemon/.env

    # Install systemd unit
    sudo cp packages/daemon/systemd/zapi-pwa-daemon.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable zapi-pwa-daemon
    sudo systemctl start zapi-pwa-daemon
    sudo systemctl status zapi-pwa-daemon --no-pager

Expected: `active (running)`. Watch logs with
`sudo journalctl -u zapi-pwa-daemon -f | jq .`.

## Subsequent deploys

From the local machine:

    bash scripts/deploy-daemon.sh

This runs `git pull` + `bun install` + `systemctl restart` on worker5 via SSH.

## Known limitations

- **Downtime = lost messages**: no persistent cursor. If the daemon is down
  when an audio arrives, the forwarder never sees it. The chat UI still
  renders the audio bubble (waclaw stores the media), but there will be no
  automatic transcription. Acceptable for MVP.
- **No request timeouts**: `fetch` calls use defaults. The forwarder's retry
  loop covers most failure modes.
- **No metrics**: observability is systemd journal only. Use `journalctl -u
  zapi-pwa-daemon -f | jq .` to tail.
