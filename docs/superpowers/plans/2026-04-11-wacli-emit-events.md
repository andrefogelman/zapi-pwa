# wacli `--emit-events` + waclaw NDJSON consumer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zerar a latência de eventos WhatsApp entre `wacli sync --follow` rodando no worker5 e o waclaw daemon Node, substituindo o atual handler silencioso (que só logga stderr batcheado a cada 25 mensagens) por um stream NDJSON em stdout dispatch-ado por evento, consumido linha-a-linha pelo waclaw.

**Architecture:** Patch no source Go do upstream [`github.com/steipete/wacli`](https://github.com/steipete/wacli) (MIT) adicionando flag `--emit-events` em `cmd/wacli/sync.go` que, quando ativa, faz o handler já-existente em `internal/app/sync.go` emitir um envelope NDJSON em stdout por evento decriptado via `wa.AddEventHandler`. Do lado do waclaw, o `spawn` do child process em `sessions.js:startLiveSync` passa a ligar a flag e trocar o `proc.stdout.on("data")` chunked por um `readline` line-based NDJSON dispatcher que opcionalmente forwarda por HTTP para um webhook externo configurado via env `WACLAW_WEBHOOK_URL`.

**Tech Stack:** Go 1.23+ (wacli) com CGO e build tag `sqlite_fts5`, `go.mau.fi/whatsmeow v0.0.0-20260211193157-7b33f6289f98`, Node 20.20.2 (waclaw), systemd, Tailscale para acesso ao worker5 (`100.66.83.22`).

**⚠️ Dependência:** Este plano assume que o plano `2026-04-11-admin-multitenant.md` (em execução em outra sessão) **já foi mergeado na main**. Motivo: aquele plano faz o refactor monorepo bun workspaces (movendo `src/` → `packages/pwa/src/`), e se este plano executar antes, os paths divergem. **Antes de iniciar a Fase 0, verifique**: `git log --oneline main | head -5` deve mostrar commits do admin-multitenant.

---

## Background e investigação

Este plano nasceu de uma investigação em 2026-04-11 que descobriu:

1. **O `setInterval(wacli sync, 120000)` descrito no spec `docs/superpowers/specs/2026-04-10-waclaw-multi-tenant-whatsapp-client.md:88-93` não existe mais no código em produção.** O `sessions.js` atual já usa `spawn("wacli", ["sync", "--follow", ...])` long-running (campo `this.liveSyncProcs` em `sessions.js:25`). `--follow` é default true no próprio wacli.

2. **O `proc.stdout.on("data")` handler em `sessions.js:388-391` só faz `console.log` + `refreshDb`** — não faz push para lugar nenhum. O `webhookUrl` recebido no constructor de `SessionManager` nunca é usado. Verificado com `grep -rn "webhookUrl" /opt/waclaw/src/`: uma única ocorrência, só a declaração.

3. **O source do wacli é público e MIT.** Localizado via `go version -m /home/orcabot/.local/bin/wacli`:
   - Path: `github.com/steipete/wacli/cmd/wacli`
   - Mod: `github.com/steipete/wacli v0.0.0-20260216055313-16947198bc75`
   - Commit embutido no binário: `16947198bc75a2ac9005fc4af55aa7e3df3efdc7` (2026-02-16)
   - Licença: MIT puro (verificado em `gh api repos/steipete/wacli/contents/LICENSE`)
   - Repo: 857 stars, 154 forks, atualizado 2026-04-11

4. **A API `Client.AddEventHandler(handler func(interface{})) uint32` já é pública** em `internal/wa/client.go:151` — passthrough direto de `whatsmeow.Client.AddEventHandler`. O ponto de injeção existe sem refactor.

5. **`internal/app/sync.go:~70`** (no arquivo de 10959 bytes) já registra um handler que faz `switch v := evt.(type) { case *events.Message: ... case *events.HistorySync: ... }`. Chama `wa.ParseLiveMessage(v)` que retorna um `wa.ParsedMessage` com todos os campos que precisamos serializar. **O patch adiciona uma chamada ao emit NDJSON no mesmo handler, atrás de `if opts.EmitEvents`.**

6. **Go 1.23.4 disponível no worker5 em `/usr/local/bin/go`** — permite buildar o wacli no próprio worker5 sem cross-compile.

7. **`/opt/waclaw` não é git repo** em worker5 (verificado com `cd /opt/waclaw && git status`). O plano converte em git repo na Fase 5.1 para controle de versão mínimo antes de editar.

8. **Contexto mais amplo**: `docs/superpowers/plans/2026-04-11-admin-multitenant.md` (4477 linhas) está em execução em paralelo. Aquele plano migra o zapi-pwa para monorepo bun workspaces e introduz daemon worker5 multi-tenant. Este plano aqui é **ortogonal e complementar**: independente do transporte final que o admin-multitenant escolher (webhook Next.js, Supabase Realtime, SSE), ter os eventos saindo do wacli em real-time é pré-requisito. Este plano entrega esse pré-requisito standalone, com forwarding via webhook opcional.

---

## File structure

### Novos arquivos no fork do wacli

```
internal/out/events.go           # Event/MessagePayload/MediaPayload types + Encode functions
internal/out/events_test.go      # Table-driven tests for the encoder
```

### Arquivos modificados no fork do wacli

```
internal/app/sync.go             # Adiciona out.EncodeMessageEvent dentro do handler
cmd/wacli/sync.go                # Adiciona flag --emit-events e propaga para SyncOptions
# (SyncOptions struct também fica em internal/app/sync.go — é modificado no mesmo arquivo)
```

### Arquivos modificados no waclaw (worker5 `/opt/waclaw`)

```
src/sessions.js                  # Troca chunk handler por readline NDJSON dispatcher
src/index.js                     # Lê env WACLAW_WEBHOOK_URL (opcional) e passa pra SessionManager
```

### Arquivos de infra no worker5

```
/home/orcabot/src/wacli/         # Clone do fork para build local (criado na Fase 6)
/home/orcabot/.local/bin/wacli   # Binário substituído (Fase 6)
/home/orcabot/.local/bin/wacli.bak-<timestamp>  # Backup do binário antigo (Fase 6)
/opt/waclaw.bak-<timestamp>/     # Backup completo do /opt/waclaw (Fase 5)
/etc/waclaw.env                  # (Já existe) receberá linha WACLAW_WEBHOOK_URL opcional
```

### Responsabilidades por arquivo

- **`internal/out/events.go`**: tipos públicos (`Event`, `MessagePayload`, `MediaPayload`, `SyncCompletePayload`) + funções `EncodeMessageEvent(w io.Writer, m MessagePayload) error` e `EncodeSyncComplete(w io.Writer, messagesStored int64) error`. **Não importa `internal/wa`** — os byte slices já chegam base64-encoded, evitando ciclo de imports.
- **`internal/out/events_test.go`**: testes table-driven validando JSON output byte-a-byte contra fixtures.
- **`internal/app/sync.go`**: adiciona `EmitEvents bool` em `SyncOptions`, converte `wa.ParsedMessage` → `out.MessagePayload` no handler, chama encoder se flag ligada, substitui resumo final por `EncodeSyncComplete` quando flag ligada.
- **`cmd/wacli/sync.go`**: uma flag a mais + propagate para `SyncOptions`.
- **`src/sessions.js` (waclaw)**: trocar `proc.stdout.on("data")` por `readline.createInterface`, parser NDJSON, dispatcher por tipo de evento, webhook POST opcional, adicionar `--emit-events` aos args do spawn.
- **`src/index.js` (waclaw)**: passar `WACLAW_WEBHOOK_URL` do env para o constructor de `SessionManager`.

---

## Rollback plan (leia antes de começar)

Se qualquer fase ≥ 5 falhar em produção (waclaw down ou wacli crashando), executar em ordem:

```bash
ssh root@100.66.83.22
# 1) parar waclaw
systemctl stop waclaw.service
# 2) restaurar binário wacli antigo
cp /home/orcabot/.local/bin/wacli.bak-* /home/orcabot/.local/bin/wacli
chown orcabot:orcabot /home/orcabot/.local/bin/wacli
chmod +x /home/orcabot/.local/bin/wacli
# 3) limpar lock file órfão se existir
rm -f /home/orcabot/.wacli/LOCK
# 4) restaurar /opt/waclaw
rm -rf /opt/waclaw
cp -a /opt/waclaw.bak-* /opt/waclaw
# 5) subir de novo
systemctl start waclaw.service
# 6) conferir
journalctl -u waclaw.service -n 30 --no-pager
```

Tempo de rollback esperado: < 90 segundos.

---

## Phase 0: Preparation

### Task 0.1: Verificar dependência do plano admin-multitenant

**Files:** nenhum.

- [ ] **Step 1: Checar que admin-multitenant já foi mergeado**

Run:
```bash
cd /Users/andrefogelman/zapi-pwa
git log --oneline main -20 | grep -i "admin-multitenant\|monorepo\|waclaw-daemon"
```

Expected: pelo menos 1 commit referenciando admin-multitenant ou monorepo.

Se vazio: **PARAR**. Avisar o usuário que a execução em outra sessão ainda não foi mergeada. Este plano só pode rodar depois.

### Task 0.2: Criar fork de steipete/wacli para andrefogelman/wacli

**Files:** nenhum local.

- [ ] **Step 1: Fork via gh CLI**

Run:
```bash
gh repo fork steipete/wacli --clone=false --remote=false
```

Expected:
```
✓ Created fork andrefogelman/wacli
```

- [ ] **Step 2: Verificar**

Run:
```bash
gh repo view andrefogelman/wacli --json name,parent,url | jq
```

Expected JSON com `"parent":{"name":"wacli",...}` e `"url":"https://github.com/andrefogelman/wacli"`.

### Task 0.3: Clonar fork localmente e criar branch

**Files:** cria `/Users/andrefogelman/src/wacli/`.

- [ ] **Step 1: Clonar**

Run:
```bash
mkdir -p /Users/andrefogelman/src
cd /Users/andrefogelman/src
gh repo clone andrefogelman/wacli
cd wacli
git remote add upstream https://github.com/steipete/wacli.git
git fetch upstream
```

Expected: clone ok, fetch ok.

- [ ] **Step 2: Sincronizar com upstream e criar branch**

Run:
```bash
cd /Users/andrefogelman/src/wacli
git checkout main
git reset --hard upstream/main
git log --oneline -1
```

Expected: mostra commit mais recente do upstream (hoje).

- [ ] **Step 3: Criar branch**

Run:
```bash
git checkout -b feature/emit-events
```

Expected: "Switched to a new branch 'feature/emit-events'".

### Task 0.4: Verificar que build baseline passa antes de qualquer mudança

**Files:** nenhum.

- [ ] **Step 1: Build baseline**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go build -tags sqlite_fts5 -o /tmp/wacli-baseline ./cmd/wacli
```

Expected: exit 0, binário criado em /tmp/wacli-baseline.

Se falhar por CGO: garantir que Xcode command line tools estão instalados (`xcode-select --install`).

- [ ] **Step 2: Verificar versão**

Run:
```bash
/tmp/wacli-baseline version
/tmp/wacli-baseline sync --help | head -15
```

Expected:
- `version` retorna uma string.
- `sync --help` mostra as flags atuais: `--follow`, `--once`, `--download-media`, `--idle-exit`, `--refresh-contacts`, `--refresh-groups`. **NÃO deve ter** `--emit-events` ainda.

- [ ] **Step 3: Run existing tests**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./... 2>&1 | tail -30
```

Expected: todos os pacotes OK (ou apenas pacotes sem teste marcados `[no test files]`). Zero FAIL.

Se houver falha: **PARAR** — não é nosso patch. Abrir issue/investigar upstream antes.

---

## Phase 1: NDJSON event encoder (TDD em isolamento)

### Task 1.1: Escrever teste falhando para EncodeMessageEvent

**Files:**
- Create: `internal/out/events_test.go`

- [ ] **Step 1: Criar o arquivo de teste**

Write `internal/out/events_test.go`:

```go
package out

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestEncodeMessageEvent_TextMessage(t *testing.T) {
	ts := time.Date(2026, 4, 11, 10, 30, 45, 0, time.UTC)
	payload := MessagePayload{
		ID:        "ABCD1234",
		Chat:      "5511987654321@s.whatsapp.net",
		SenderJID: "5511987654321@s.whatsapp.net",
		PushName:  "Andre",
		Timestamp: ts,
		FromMe:    false,
		Text:      "oi",
	}

	var buf bytes.Buffer
	if err := EncodeMessageEvent(&buf, payload); err != nil {
		t.Fatalf("EncodeMessageEvent returned error: %v", err)
	}

	out := buf.String()
	if len(out) == 0 || out[len(out)-1] != '\n' {
		t.Fatalf("expected NDJSON line ending in newline, got %q", out)
	}

	var decoded Event
	if err := json.Unmarshal([]byte(out), &decoded); err != nil {
		t.Fatalf("output is not valid JSON: %v\noutput: %s", err, out)
	}
	if decoded.Type != "message" {
		t.Errorf("expected event type 'message', got %q", decoded.Type)
	}
	if decoded.Message == nil {
		t.Fatalf("expected non-nil Message payload")
	}
	if decoded.Message.ID != "ABCD1234" {
		t.Errorf("expected ID ABCD1234, got %q", decoded.Message.ID)
	}
	if decoded.Message.Text != "oi" {
		t.Errorf("expected text 'oi', got %q", decoded.Message.Text)
	}
	if decoded.Message.FromMe {
		t.Errorf("expected FromMe false")
	}
}
```

- [ ] **Step 2: Rodar, confirmar falha**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./internal/out/... 2>&1 | tail -20
```

Expected: FAIL com erro de compilação — `undefined: MessagePayload`, `undefined: EncodeMessageEvent`, `undefined: Event` (os tipos ainda não existem). É a falha que queríamos.

### Task 1.2: Implementar os tipos e EncodeMessageEvent

**Files:**
- Create: `internal/out/events.go`

- [ ] **Step 1: Criar o arquivo**

Write `internal/out/events.go`:

```go
package out

import (
	"encoding/json"
	"io"
	"time"
)

// Event is the NDJSON envelope emitted by `wacli sync --emit-events`.
// Each line of stdout is one JSON object; consumers dispatch on Type.
type Event struct {
	Type         string               `json:"event"`
	Timestamp    time.Time            `json:"ts"`
	Message      *MessagePayload      `json:"message,omitempty"`
	SyncComplete *SyncCompletePayload `json:"sync_complete,omitempty"`
}

// MessagePayload carries the fields a consumer typically needs for inbox/chat UIs
// and for triggering downstream pipelines (transcription, notifications).
// Media byte slices arrive already base64-encoded so this package has no
// dependency on internal/wa.
type MessagePayload struct {
	ID             string        `json:"id"`
	Chat           string        `json:"chat"`
	SenderJID      string        `json:"sender_jid,omitempty"`
	PushName       string        `json:"push_name,omitempty"`
	Timestamp      time.Time     `json:"timestamp"`
	FromMe         bool          `json:"from_me"`
	Text           string        `json:"text,omitempty"`
	ReplyToID      string        `json:"reply_to_id,omitempty"`
	ReplyToDisplay string        `json:"reply_to_display,omitempty"`
	ReactionToID   string        `json:"reaction_to_id,omitempty"`
	ReactionEmoji  string        `json:"reaction_emoji,omitempty"`
	Media          *MediaPayload `json:"media,omitempty"`
}

// MediaPayload carries the decrypted media metadata. Byte slices
// (MediaKey, FileSHA256, FileEncSHA256) are already base64 strings
// so consumers can embed them in JSON or POST them onward unchanged.
type MediaPayload struct {
	Type          string `json:"type"`
	Caption       string `json:"caption,omitempty"`
	Filename      string `json:"filename,omitempty"`
	MimeType      string `json:"mime_type,omitempty"`
	DirectPath    string `json:"direct_path,omitempty"`
	MediaKey      string `json:"media_key,omitempty"`
	FileSHA256    string `json:"file_sha256,omitempty"`
	FileEncSHA256 string `json:"file_enc_sha256,omitempty"`
	FileLength    uint64 `json:"file_length,omitempty"`
}

// SyncCompletePayload is emitted once when sync terminates (Ctrl+C in follow
// mode, or idle-exit in once mode) with the final message count.
type SyncCompletePayload struct {
	MessagesStored int64 `json:"messages_stored"`
}

// EncodeMessageEvent writes one NDJSON message event to w.
// json.Encoder.Encode already terminates with a newline, so this yields
// exactly one valid NDJSON line per call.
func EncodeMessageEvent(w io.Writer, m MessagePayload) error {
	return json.NewEncoder(w).Encode(Event{
		Type:      "message",
		Timestamp: time.Now().UTC(),
		Message:   &m,
	})
}

// EncodeSyncComplete writes one NDJSON sync_complete event to w.
func EncodeSyncComplete(w io.Writer, messagesStored int64) error {
	return json.NewEncoder(w).Encode(Event{
		Type:         "sync_complete",
		Timestamp:    time.Now().UTC(),
		SyncComplete: &SyncCompletePayload{MessagesStored: messagesStored},
	})
}
```

- [ ] **Step 2: Rodar teste, confirmar passa**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./internal/out/... -v 2>&1 | tail -20
```

Expected: `--- PASS: TestEncodeMessageEvent_TextMessage` e `PASS` no final.

### Task 1.3: Adicionar teste para mensagem com media

**Files:**
- Modify: `internal/out/events_test.go`

- [ ] **Step 1: Adicionar o teste no fim do arquivo**

Append ao `internal/out/events_test.go`:

```go
func TestEncodeMessageEvent_AudioPTT(t *testing.T) {
	ts := time.Date(2026, 4, 11, 10, 30, 45, 0, time.UTC)
	payload := MessagePayload{
		ID:        "AUDIO001",
		Chat:      "5511987654321@s.whatsapp.net",
		Timestamp: ts,
		FromMe:    false,
		Media: &MediaPayload{
			Type:          "audio",
			MimeType:      "audio/ogg; codecs=opus",
			DirectPath:    "/v/t62.7117-24/abc.enc",
			MediaKey:      "dGVzdG1lZGlha2V5", // "testmediakey" base64
			FileSHA256:    "c2hhMjU2aGFzaA==", // "sha256hash" base64
			FileEncSHA256: "ZW5jc2hhMjU2",     // "encsha256" base64
			FileLength:    4567,
		},
	}

	var buf bytes.Buffer
	if err := EncodeMessageEvent(&buf, payload); err != nil {
		t.Fatalf("EncodeMessageEvent returned error: %v", err)
	}

	var decoded Event
	if err := json.Unmarshal(buf.Bytes(), &decoded); err != nil {
		t.Fatalf("output is not valid JSON: %v\noutput: %s", err, buf.String())
	}
	if decoded.Message == nil || decoded.Message.Media == nil {
		t.Fatalf("expected Media payload, got %+v", decoded.Message)
	}
	if decoded.Message.Media.Type != "audio" {
		t.Errorf("expected media type 'audio', got %q", decoded.Message.Media.Type)
	}
	if decoded.Message.Media.MediaKey != "dGVzdG1lZGlha2V5" {
		t.Errorf("expected MediaKey base64 roundtrip, got %q", decoded.Message.Media.MediaKey)
	}
	if decoded.Message.Media.FileLength != 4567 {
		t.Errorf("expected FileLength 4567, got %d", decoded.Message.Media.FileLength)
	}
}
```

- [ ] **Step 2: Rodar, confirmar passa**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./internal/out/... -run TestEncodeMessageEvent_AudioPTT -v
```

Expected: `--- PASS: TestEncodeMessageEvent_AudioPTT`.

### Task 1.4: Adicionar teste para EncodeSyncComplete

**Files:**
- Modify: `internal/out/events_test.go`

- [ ] **Step 1: Adicionar o teste**

Append ao `internal/out/events_test.go`:

```go
func TestEncodeSyncComplete(t *testing.T) {
	var buf bytes.Buffer
	if err := EncodeSyncComplete(&buf, 1234); err != nil {
		t.Fatalf("EncodeSyncComplete returned error: %v", err)
	}

	var decoded Event
	if err := json.Unmarshal(buf.Bytes(), &decoded); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	if decoded.Type != "sync_complete" {
		t.Errorf("expected event type 'sync_complete', got %q", decoded.Type)
	}
	if decoded.SyncComplete == nil {
		t.Fatalf("expected SyncComplete payload")
	}
	if decoded.SyncComplete.MessagesStored != 1234 {
		t.Errorf("expected 1234 messages, got %d", decoded.SyncComplete.MessagesStored)
	}
	if decoded.Message != nil {
		t.Errorf("Message should be nil on sync_complete event")
	}
}
```

- [ ] **Step 2: Rodar**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./internal/out/... -v
```

Expected: todos os 3 testes passam.

### Task 1.5: Teste de saída NDJSON estrita (sem encoding extra, newline correto)

**Files:**
- Modify: `internal/out/events_test.go`

- [ ] **Step 1: Adicionar teste anti-regressão**

Append ao `internal/out/events_test.go`:

```go
func TestEncodeMessageEvent_NDJSONFraming(t *testing.T) {
	var buf bytes.Buffer

	// Emit two events back-to-back and verify exactly two newline-terminated lines.
	for i := 0; i < 2; i++ {
		if err := EncodeMessageEvent(&buf, MessagePayload{ID: "X", Chat: "Y@s.whatsapp.net"}); err != nil {
			t.Fatalf("encode %d: %v", i, err)
		}
	}

	raw := buf.String()
	if raw == "" {
		t.Fatalf("empty output")
	}
	if raw[len(raw)-1] != '\n' {
		t.Fatalf("last byte is not newline: %q", raw[len(raw)-1])
	}

	// Split by newline and skip the trailing empty element.
	lines := bytes.Split(buf.Bytes(), []byte{'\n'})
	// With two Encode calls we expect: [line1, line2, ""] => len 3.
	if len(lines) != 3 || len(lines[2]) != 0 {
		t.Fatalf("expected 2 newline-terminated lines, got framing: %v", lines)
	}
	for i, line := range lines[:2] {
		var e Event
		if err := json.Unmarshal(line, &e); err != nil {
			t.Errorf("line %d is not valid JSON: %v (%q)", i, err, line)
		}
	}
}
```

- [ ] **Step 2: Rodar**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./internal/out/... -v
```

Expected: todos os testes passam.

### Task 1.6: Commit do pacote out

- [ ] **Step 1: Stage + commit**

Run:
```bash
cd /Users/andrefogelman/src/wacli
git add internal/out/events.go internal/out/events_test.go
git status
```

Expected: dois arquivos adicionados, nada mais.

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "feat(out): NDJSON event encoder for sync event stream

Adds internal/out/events.go with Event/MessagePayload/MediaPayload
types plus EncodeMessageEvent and EncodeSyncComplete writers.
Used by sync --emit-events in the next commit. Zero dependency
on internal/wa to avoid import cycles.

Refs: docs/superpowers/plans/2026-04-11-wacli-emit-events.md"
```

Expected: commit criado.

---

## Phase 2: Flag `--emit-events` na CLI

### Task 2.1: Adicionar campo EmitEvents em SyncOptions

**Files:**
- Modify: `internal/app/sync.go` (campo `SyncOptions` começa em linha ~24)

- [ ] **Step 1: Abrir e localizar struct**

Read `internal/app/sync.go` e confirmar que `SyncOptions` atualmente é:

```go
type SyncOptions struct {
	Mode            SyncMode
	AllowQR         bool
	OnQRCode        func(string)
	AfterConnect    func(context.Context) error
	DownloadMedia   bool
	RefreshContacts bool
	RefreshGroups   bool
	IdleExit        time.Duration // only used for bootstrap/once
	Verbosity       int           // future
}
```

- [ ] **Step 2: Adicionar EmitEvents**

Edit `internal/app/sync.go` — substituir o struct inteiro por:

```go
type SyncOptions struct {
	Mode            SyncMode
	AllowQR         bool
	OnQRCode        func(string)
	AfterConnect    func(context.Context) error
	DownloadMedia   bool
	RefreshContacts bool
	RefreshGroups   bool
	IdleExit        time.Duration // only used for bootstrap/once
	Verbosity       int           // future
	// EmitEvents, when true, causes Sync to write one NDJSON event to
	// os.Stdout per whatsmeow event received, plus a final sync_complete
	// event when Sync returns. Used by consumers that spawn `wacli sync`
	// as a child process and want push-style delivery instead of polling
	// the local SQLite store.
	EmitEvents bool
}
```

- [ ] **Step 3: Verificar compilação**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go build -tags sqlite_fts5 ./...
```

Expected: exit 0 (nada usa EmitEvents ainda, mas compila).

### Task 2.2: Adicionar flag --emit-events no cobra command

**Files:**
- Modify: `cmd/wacli/sync.go`

- [ ] **Step 1: Localizar o bloco de flags**

Read `cmd/wacli/sync.go` — as flags atuais estão no final da função `newSyncCmd`:

```go
cmd.Flags().BoolVar(&once, "once", false, "sync until idle and exit")
cmd.Flags().BoolVar(&follow, "follow", true, "keep syncing until Ctrl+C")
cmd.Flags().DurationVar(&idleExit, "idle-exit", 30*time.Second, "exit after being idle (once mode)")
cmd.Flags().BoolVar(&downloadMedia, "download-media", false, "download media in the background during sync")
cmd.Flags().BoolVar(&refreshContacts, "refresh-contacts", false, "refresh contacts from session store into local DB")
cmd.Flags().BoolVar(&refreshGroups, "refresh-groups", false, "refresh joined groups (live) into local DB")
return cmd
```

- [ ] **Step 2: Adicionar declaração da variável local no topo da função**

Edit `cmd/wacli/sync.go` — adicionar `var emitEvents bool` junto às outras vars locais, logo após `var refreshGroups bool`:

```go
var once bool
var follow bool
var idleExit time.Duration
var downloadMedia bool
var refreshContacts bool
var refreshGroups bool
var emitEvents bool
```

- [ ] **Step 3: Propagar emitEvents para SyncOptions**

Edit `cmd/wacli/sync.go` — modificar a chamada `a.Sync(ctx, appPkg.SyncOptions{...})` adicionando o campo:

```go
res, err := a.Sync(ctx, appPkg.SyncOptions{
    Mode:            mode,
    AllowQR:         false,
    DownloadMedia:   downloadMedia,
    RefreshContacts: refreshContacts,
    RefreshGroups:   refreshGroups,
    IdleExit:        idleExit,
    EmitEvents:      emitEvents,
})
```

- [ ] **Step 4: Adicionar flag cobra**

Edit `cmd/wacli/sync.go` — adicionar logo antes do `return cmd`:

```go
cmd.Flags().BoolVar(&emitEvents, "emit-events", false, "stream NDJSON events (one per line) to stdout for each whatsmeow event; ends with one sync_complete event")
```

O bloco final deve ficar:

```go
cmd.Flags().BoolVar(&once, "once", false, "sync until idle and exit")
cmd.Flags().BoolVar(&follow, "follow", true, "keep syncing until Ctrl+C")
cmd.Flags().DurationVar(&idleExit, "idle-exit", 30*time.Second, "exit after being idle (once mode)")
cmd.Flags().BoolVar(&downloadMedia, "download-media", false, "download media in the background during sync")
cmd.Flags().BoolVar(&refreshContacts, "refresh-contacts", false, "refresh contacts from session store into local DB")
cmd.Flags().BoolVar(&refreshGroups, "refresh-groups", false, "refresh joined groups (live) into local DB")
cmd.Flags().BoolVar(&emitEvents, "emit-events", false, "stream NDJSON events (one per line) to stdout for each whatsmeow event; ends with one sync_complete event")
return cmd
```

### Task 2.3: Verificar build + --help

- [ ] **Step 1: Build**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go build -tags sqlite_fts5 -o /tmp/wacli-p2 ./cmd/wacli
```

Expected: exit 0.

- [ ] **Step 2: Checar flag em --help**

Run:
```bash
/tmp/wacli-p2 sync --help 2>&1 | grep emit-events
```

Expected:
```
      --emit-events          stream NDJSON events (one per line) to stdout for each whatsmeow event; ends with one sync_complete event
```

### Task 2.4: Rodar testes existentes (não pode quebrar nada)

- [ ] **Step 1: Full test run**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./... 2>&1 | tail -30
```

Expected: todos passam. Especialmente `internal/app/sync_test.go` que exercita `Sync()` — o novo campo é opcional e default-false, não deve quebrar nada.

### Task 2.5: Commit

- [ ] **Step 1: Stage + commit**

Run:
```bash
cd /Users/andrefogelman/src/wacli
git add cmd/wacli/sync.go internal/app/sync.go
git commit -m "feat(sync): add --emit-events flag wired to SyncOptions.EmitEvents

No behavior change yet — the handler in internal/app/sync.go
still needs to check opts.EmitEvents and actually emit. That
happens in the next commit so this one stays mechanical.

Refs: docs/superpowers/plans/2026-04-11-wacli-emit-events.md"
```

Expected: commit criado.

---

## Phase 3: Hook encoder ao event handler

### Task 3.1: Ler o handler atual e identificar o ponto exato de inserção

**Files:** nenhum (leitura apenas).

- [ ] **Step 1: Localizar handler**

Read `internal/app/sync.go` procurando por `a.wa.AddEventHandler(func(evt interface{}) {`.

Confirmar que o handler segue este esqueleto:

```go
handlerID := a.wa.AddEventHandler(func(evt interface{}) {
    lastEvent.Store(time.Now().UTC().UnixNano())

    switch v := evt.(type) {
    case *events.Message:
        pm := wa.ParseLiveMessage(v)
        if pm.ReactionToID != "" && pm.ReactionEmoji == "" && v.Message != nil && v.Message.GetEncReactionMessage() != nil {
            if reaction, err := a.wa.DecryptReaction(ctx, v); err == nil && reaction != nil {
                pm.ReactionEmoji = reaction.GetText()
                if pm.ReactionToID == "" {
                    if key := reaction.GetKey(); key != nil {
                        pm.ReactionToID = key.GetID()
                    }
                }
            }
        }
        if err := a.storeParsedMessage(ctx, pm); err == nil {
            messagesStored.Add(1)
        }
        if opts.DownloadMedia && pm.Media != nil && pm.ID != "" {
            enqueueMedia(pm.Chat.String(), pm.ID)
        }
        if messagesStored.Load()%25 == 0 {
            fmt.Fprintf(os.Stderr, "\rSynced %d messages...", messagesStored.Load())
        }
    case *events.HistorySync:
        // ... existing history sync handling ...
```

**Ponto de inserção**: logo **depois** de `if err := a.storeParsedMessage(ctx, pm); err == nil { messagesStored.Add(1) }` e **antes** do `if opts.DownloadMedia ...` (ou depois, não importa — ambos são side-effects).

### Task 3.2: Adicionar import do pacote out

**Files:**
- Modify: `internal/app/sync.go`

- [ ] **Step 1: Adicionar import**

Edit `internal/app/sync.go` — bloco de imports atual:

```go
import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/steipete/wacli/internal/store"
	"github.com/steipete/wacli/internal/wa"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)
```

Adicionar `"github.com/steipete/wacli/internal/out"` (manter ordenado alfabeticamente dentro do bloco do projeto):

```go
import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/steipete/wacli/internal/out"
	"github.com/steipete/wacli/internal/store"
	"github.com/steipete/wacli/internal/wa"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)
```

**Importante:** como esse é um fork do upstream, o import path continua `github.com/steipete/wacli/...` — não troque para `andrefogelman`. O `go.mod` não muda.

### Task 3.3: Adicionar helper local para converter ParsedMessage → MessagePayload

**Files:**
- Modify: `internal/app/sync.go`

Put isso no final do arquivo (função de conversão local):

- [ ] **Step 1: Adicionar a função helper**

Edit `internal/app/sync.go` — adicionar ao final do arquivo:

```go
// parsedToEventPayload converts a wa.ParsedMessage into the wire format
// emitted by `sync --emit-events`. Keeping the conversion here avoids
// adding a dep from internal/out onto internal/wa.
func parsedToEventPayload(pm wa.ParsedMessage) out.MessagePayload {
	payload := out.MessagePayload{
		ID:             pm.ID,
		Chat:           pm.Chat.String(),
		SenderJID:      pm.SenderJID,
		PushName:       pm.PushName,
		Timestamp:      pm.Timestamp,
		FromMe:         pm.FromMe,
		Text:           pm.Text,
		ReplyToID:      pm.ReplyToID,
		ReplyToDisplay: pm.ReplyToDisplay,
		ReactionToID:   pm.ReactionToID,
		ReactionEmoji:  pm.ReactionEmoji,
	}
	if pm.Media != nil {
		payload.Media = &out.MediaPayload{
			Type:          pm.Media.Type,
			Caption:       pm.Media.Caption,
			Filename:      pm.Media.Filename,
			MimeType:      pm.Media.MimeType,
			DirectPath:    pm.Media.DirectPath,
			MediaKey:      base64Encode(pm.Media.MediaKey),
			FileSHA256:    base64Encode(pm.Media.FileSHA256),
			FileEncSHA256: base64Encode(pm.Media.FileEncSHA256),
			FileLength:    pm.Media.FileLength,
		}
	}
	return payload
}
```

- [ ] **Step 2: Adicionar helper base64Encode**

Edit `internal/app/sync.go` — adicionar logo após a função `parsedToEventPayload`:

```go
func base64Encode(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	return base64StdEnc.EncodeToString(b)
}
```

- [ ] **Step 3: Importar encoding/base64**

Edit o bloco de imports em `internal/app/sync.go` — adicionar `"encoding/base64"`:

```go
import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/steipete/wacli/internal/out"
	"github.com/steipete/wacli/internal/store"
	"github.com/steipete/wacli/internal/wa"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)
```

- [ ] **Step 4: Adicionar a variável do encoder no topo do arquivo**

Edit `internal/app/sync.go` — logo após o bloco de imports, antes das declarações de tipo, adicionar:

```go
var base64StdEnc = base64.StdEncoding
```

Isso é uma indireção cosmética para manter `parsedToEventPayload` legível; alternativa é usar `base64.StdEncoding.EncodeToString` direto dentro do helper. Escolha aqui é estilo.

- [ ] **Step 5: Verificar compilação**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go build -tags sqlite_fts5 ./...
```

Expected: exit 0.

### Task 3.4: Emitir o evento dentro do handler

**Files:**
- Modify: `internal/app/sync.go`

- [ ] **Step 1: Adicionar a emissão**

Edit `internal/app/sync.go` — localizar o bloco `case *events.Message:` no handler e, logo **depois** da linha `if err := a.storeParsedMessage(ctx, pm); err == nil { messagesStored.Add(1) }` (e antes do `if opts.DownloadMedia ...`), adicionar:

```go
// NDJSON streaming: one event per message when --emit-events is on.
// Write failures are ignored — stdout may be closed/broken, but that
// must never kill the sync loop that is also persisting to SQLite.
if opts.EmitEvents {
    _ = out.EncodeMessageEvent(os.Stdout, parsedToEventPayload(pm))
}
```

O bloco `case *events.Message:` inteiro depois do patch fica (confira antes de salvar):

```go
case *events.Message:
    pm := wa.ParseLiveMessage(v)
    if pm.ReactionToID != "" && pm.ReactionEmoji == "" && v.Message != nil && v.Message.GetEncReactionMessage() != nil {
        if reaction, err := a.wa.DecryptReaction(ctx, v); err == nil && reaction != nil {
            pm.ReactionEmoji = reaction.GetText()
            if pm.ReactionToID == "" {
                if key := reaction.GetKey(); key != nil {
                    pm.ReactionToID = key.GetID()
                }
            }
        }
    }
    if err := a.storeParsedMessage(ctx, pm); err == nil {
        messagesStored.Add(1)
    }
    // NDJSON streaming: one event per message when --emit-events is on.
    // Write failures are ignored — stdout may be closed/broken, but that
    // must never kill the sync loop that is also persisting to SQLite.
    if opts.EmitEvents {
        _ = out.EncodeMessageEvent(os.Stdout, parsedToEventPayload(pm))
    }
    if opts.DownloadMedia && pm.Media != nil && pm.ID != "" {
        enqueueMedia(pm.Chat.String(), pm.ID)
    }
    if messagesStored.Load()%25 == 0 {
        fmt.Fprintf(os.Stderr, "\rSynced %d messages...", messagesStored.Load())
    }
```

### Task 3.5: Substituir resumo final por sync_complete event

**Files:**
- Modify: `cmd/wacli/sync.go`

- [ ] **Step 1: Localizar o write final**

Read `cmd/wacli/sync.go` — a parte do RunE que termina com:

```go
if flags.asJSON {
    return out.WriteJSON(os.Stdout, map[string]any{
        "synced":          true,
        "messages_stored": res.MessagesStored,
    })
}
fmt.Fprintf(os.Stdout, "Messages stored: %d\n", res.MessagesStored)
return nil
```

- [ ] **Step 2: Inserir ramo emit-events à frente**

Edit `cmd/wacli/sync.go` — substituir o bloco acima por:

```go
if emitEvents {
    // In event-stream mode, the summary is itself an NDJSON event so the
    // consumer parses it with the same line-based decoder.
    return out.EncodeSyncComplete(os.Stdout, res.MessagesStored)
}
if flags.asJSON {
    return out.WriteJSON(os.Stdout, map[string]any{
        "synced":          true,
        "messages_stored": res.MessagesStored,
    })
}
fmt.Fprintf(os.Stdout, "Messages stored: %d\n", res.MessagesStored)
return nil
```

(O pacote `out` já está importado em `cmd/wacli/sync.go` — o alias atual é `"github.com/steipete/wacli/internal/out"`, usado via `out.WriteJSON`. Essa linha continua funcionando, só adicionamos o `out.EncodeSyncComplete`.)

- [ ] **Step 3: Verificar compilação**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go build -tags sqlite_fts5 -o /tmp/wacli-p3 ./cmd/wacli
```

Expected: exit 0.

- [ ] **Step 4: Verificar testes**

Run:
```bash
cd /Users/andrefogelman/src/wacli
go test -tags sqlite_fts5 ./... 2>&1 | tail -30
```

Expected: todos passam. Se `internal/app/sync_test.go` falhar, pode ser que o teste exercita o handler de uma forma que esperava stdout silencioso — nesse caso, ler o test file e ver se precisa ajustar (provavelmente não, porque `EmitEvents` é default false).

### Task 3.6: Teste manual "smoke" local contra um número dummy

**Files:** nenhum (teste manual).

⚠️ **Este step precisa de um número WhatsApp descartável OU do seu próprio número**. Pode ser pulado se você preferir fazer o smoke test só no worker5 (Phase 6). Se pular, marcar o checkbox como N/A.

- [ ] **Step 1: Criar store de teste**

Run:
```bash
mkdir -p /tmp/wacli-smoke
```

- [ ] **Step 2: Auth com QR**

Run:
```bash
/tmp/wacli-p3 auth --store /tmp/wacli-smoke
```

Expected: mostra QR no terminal. Escanear com celular. Confirmar mensagem "logged in" ou similar.

- [ ] **Step 3: Rodar sync em modo follow + emit-events**

Run em uma janela de terminal dedicada:
```bash
/tmp/wacli-p3 sync --store /tmp/wacli-smoke --follow --emit-events --json 2>/tmp/wacli-smoke.stderr
```

Expected: processo permanece rodando silencioso em stdout.

- [ ] **Step 4: Enviar uma mensagem de teste**

Em outro celular, enviar uma mensagem de texto qualquer para o número pareado.

- [ ] **Step 5: Observar NDJSON no terminal**

Dentro de ~2 segundos, stdout deve mostrar uma linha:

```json
{"event":"message","ts":"2026-04-11T...","message":{"id":"...","chat":"...@s.whatsapp.net","sender_jid":"...","push_name":"...","timestamp":"...","from_me":false,"text":"..."}}
```

Expected: linha JSON válida com o texto da mensagem enviada.

Se não aparecer:
- Checar `cat /tmp/wacli-smoke.stderr` para ver se conectou
- Verificar se `messagesStored` incrementa (o `fmt.Fprintf(os.Stderr, "\rSynced N messages...")` deve aparecer a cada 25)

- [ ] **Step 6: Ctrl+C e confirmar sync_complete event**

Pressionar Ctrl+C no terminal onde rodava sync.

Expected: última linha do stdout é um sync_complete event:
```json
{"event":"sync_complete","ts":"...","sync_complete":{"messages_stored":<N>}}
```

- [ ] **Step 7: Limpar**

Run:
```bash
rm -rf /tmp/wacli-smoke /tmp/wacli-smoke.stderr /tmp/wacli-p2 /tmp/wacli-p3 /tmp/wacli-baseline
```

### Task 3.7: Commit da integração

- [ ] **Step 1: Stage**

Run:
```bash
cd /Users/andrefogelman/src/wacli
git add internal/app/sync.go cmd/wacli/sync.go
git status
```

Expected: 2 arquivos modificados.

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "feat(sync): emit NDJSON events when --emit-events is set

Hooks into the existing AddEventHandler inside internal/app/sync.go.
When opts.EmitEvents is true, each *events.Message produces one
NDJSON line on stdout in addition to being persisted to SQLite.
The final summary line is replaced by a sync_complete NDJSON event
so consumers can use a single line-based decoder end-to-end.

Write errors to os.Stdout are intentionally ignored: they must
never kill the sync loop, which is the authoritative storage path.

Refs: docs/superpowers/plans/2026-04-11-wacli-emit-events.md"
```

### Task 3.8: Push branch

- [ ] **Step 1: Push**

Run:
```bash
cd /Users/andrefogelman/src/wacli
git push -u origin feature/emit-events
```

Expected: branch criada no fork andrefogelman/wacli.

---

## Phase 4: Patch no waclaw — NDJSON consumer

### Task 4.1: Backup completo de /opt/waclaw

**Files:** nenhum (operação em worker5).

- [ ] **Step 1: SSH e backup**

Run:
```bash
ssh root@100.66.83.22 'TS=$(date +%Y%m%d-%H%M%S); cp -a /opt/waclaw /opt/waclaw.bak-$TS && ls -ld /opt/waclaw.bak-$TS'
```

Expected: diretório `/opt/waclaw.bak-<timestamp>` criado.

- [ ] **Step 2: Anotar o timestamp em algum lugar**

Colar o timestamp no campo "Deploy notes" no final deste plano (Phase 7).

### Task 4.2: Inicializar git em /opt/waclaw para rastreio

**Files:** nenhum local; cria git repo em worker5.

- [ ] **Step 1: git init + primeiro snapshot**

Run:
```bash
ssh root@100.66.83.22 'cd /opt/waclaw && git init -b main && git add -A && git -c user.name="orcabot" -c user.email="orcabot@worker5.local" commit -m "chore: snapshot before wacli --emit-events patch" 2>&1 | tail -5'
```

Expected: repo inicializado, commit inicial criado com todos os arquivos sob rastreio.

- [ ] **Step 2: Confirmar**

Run:
```bash
ssh root@100.66.83.22 'cd /opt/waclaw && git log --oneline'
```

Expected: 1 commit.

### Task 4.3: Ler sessions.js atual e planejar a edição exata

**Files:**
- Read: `/opt/waclaw/src/sessions.js` (via scp para ver local, ou ssh+cat)

- [ ] **Step 1: Fetch uma cópia local para edição**

Run:
```bash
mkdir -p /tmp/waclaw-edit
scp root@100.66.83.22:/opt/waclaw/src/sessions.js /tmp/waclaw-edit/sessions.js
scp root@100.66.83.22:/opt/waclaw/src/index.js /tmp/waclaw-edit/index.js
```

- [ ] **Step 2: Confirmar que startLiveSync tem o shape esperado**

Read `/tmp/waclaw-edit/sessions.js` procurando `startLiveSync(id) {`. Deve ter:

```javascript
startLiveSync(id) {
    if (this.liveSyncProcs.has(id)) return;
    const storePath = this.getStorePath(id);
    if (!existsSync(storePath)) {
      console.warn(`[live-sync:${id.slice(0, 8)}] store not found, skipping`);
      return;
    }

    console.log(`[live-sync:${id.slice(0, 8)}] starting`);
    const proc = spawn(
      this.wacliBin,
      ["sync", "--store", storePath, "--download-media", "--follow", "--json"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    this.liveSyncProcs.set(id, proc);

    proc.stdout.on("data", (d) => {
      const s = d.toString().trim();
      if (s) console.log(`[live-sync:${id.slice(0, 8)}] ${s.slice(0, 200)}`);
      this.refreshDb(id);
    });
```

**Ponto de alteração:** substituir o `proc.stdout.on("data", ...)` e adicionar `--emit-events` ao array de args.

### Task 4.4: Editar startLiveSync — trocar handler por readline + NDJSON dispatcher

**Files:**
- Modify: `/tmp/waclaw-edit/sessions.js`

- [ ] **Step 1: Adicionar import readline no topo**

Edit `/tmp/waclaw-edit/sessions.js` — o bloco de imports atual:

```javascript
import { execFile, spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { createDb } from "./db.js";
```

Adicionar `readline`:

```javascript
import { execFile, spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { createInterface } from "readline";
import { createDb } from "./db.js";
```

- [ ] **Step 2: Substituir startLiveSync inteiro**

Edit `/tmp/waclaw-edit/sessions.js` — substituir a função `startLiveSync(id)` inteira por:

```javascript
  startLiveSync(id) {
    if (this.liveSyncProcs.has(id)) return;
    const storePath = this.getStorePath(id);
    if (!existsSync(storePath)) {
      console.warn(`[live-sync:${id.slice(0, 8)}] store not found, skipping`);
      return;
    }

    console.log(`[live-sync:${id.slice(0, 8)}] starting`);
    const proc = spawn(
      this.wacliBin,
      [
        "sync",
        "--store", storePath,
        "--download-media",
        "--follow",
        "--json",
        "--emit-events",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    this.liveSyncProcs.set(id, proc);

    // Line-buffered NDJSON reader: `wacli sync --emit-events` writes one
    // JSON object per line. readline handles chunk boundaries correctly
    // so we never split a line across two "data" events.
    const reader = createInterface({ input: proc.stdout });
    let eventsSeen = 0;
    reader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        // Non-JSON line (legacy log from older wacli, or partial garbage).
        // Keep the old logging behavior so regressions are visible.
        console.log(`[live-sync:${id.slice(0, 8)}:raw] ${trimmed.slice(0, 200)}`);
        return;
      }
      if (!evt || typeof evt.event !== "string") {
        return;
      }
      eventsSeen++;
      // Always refresh the local DB handle so subsequent GET /messages
      // calls see the latest rows written by wacli.
      this.refreshDb(id);
      // Fire-and-forget dispatch: errors here must not stall the reader.
      this.handleSyncEvent(id, evt).catch((err) => {
        console.error(`[live-sync:${id.slice(0, 8)}:handler-err] ${err.message}`);
      });
    });

    proc.stderr.on("data", (d) => {
      const s = d.toString().trim();
      if (s) console.error(`[live-sync:${id.slice(0, 8)}:err] ${s.slice(0, 200)}`);
    });

    proc.on("exit", (code, signal) => {
      console.log(`[live-sync:${id.slice(0, 8)}] exited code=${code} signal=${signal} events_seen=${eventsSeen}`);
      this.liveSyncProcs.delete(id);
      if (signal === "SIGTERM" || signal === "SIGKILL") return;
      setTimeout(() => this.startLiveSync(id), 3000);
    });
  }
```

**Diferenças-chave vs o original:**
1. Args do spawn incluem `"--emit-events"`.
2. `proc.stdout.on("data")` substituído por `readline.createInterface` + handler `line`.
3. Cada linha é parseada como JSON; linhas inválidas são logadas como `raw` (compat de regressão).
4. Eventos válidos disparam `this.handleSyncEvent(id, evt)`.
5. Exit log inclui contagem de eventos processados.

- [ ] **Step 3: Adicionar o método handleSyncEvent**

Edit `/tmp/waclaw-edit/sessions.js` — inserir o seguinte método **logo antes** de `startLiveSync(id)`:

```javascript
  // Dispatch a parsed NDJSON event from a live sync. Keep this method
  // short — anything heavier belongs in a downstream queue. For now we
  // just refresh the DB handle and POST to a webhook if one is configured.
  async handleSyncEvent(id, evt) {
    switch (evt.event) {
      case "message":
        await this.forwardEventToWebhook(id, evt);
        return;
      case "sync_complete":
        console.log(
          `[live-sync:${id.slice(0, 8)}] sync_complete: ${evt.sync_complete?.messages_stored ?? 0} messages`
        );
        return;
      default:
        // Unknown event type; log at debug level and ignore.
        return;
    }
  }

  async forwardEventToWebhook(id, evt) {
    if (!this.webhookUrl) return;
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Waclaw-Session": id,
        },
        body: JSON.stringify({ source: "waclaw", sessionId: id, event: evt }),
        // Short timeout so a slow consumer cannot stall the reader loop.
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) {
        console.warn(
          `[live-sync:${id.slice(0, 8)}:webhook] ${res.status} ${res.statusText}`
        );
      }
    } catch (err) {
      console.warn(
        `[live-sync:${id.slice(0, 8)}:webhook] ${err.name}: ${err.message}`
      );
    }
  }
```

**Importante:** `fetch` e `AbortSignal.timeout` são nativos em Node 20.20.2 (o runtime do waclaw) — sem dependência nova. Se um dia o runtime cair para Node 18, trocar por `undici` explicitamente.

- [ ] **Step 4: Confirmar que webhookUrl já chega no constructor**

Read `/tmp/waclaw-edit/sessions.js` e confirmar que existe:

```javascript
constructor(wacliBin, sessionsDir, webhookUrl) {
    this.wacliBin = wacliBin;
    this.sessionsDir = sessionsDir;
    this.webhookUrl = webhookUrl;
```

Isso já existe (verificado em 2026-04-11). Só estamos finalmente **usando** o campo.

### Task 4.5: Garantir que index.js passa WACLAW_WEBHOOK_URL

**Files:**
- Modify: `/tmp/waclaw-edit/index.js`

- [ ] **Step 1: Confirmar leitura do env**

Read `/tmp/waclaw-edit/index.js` — deve já ter:

```javascript
const WEBHOOK_URL = process.env.WEBHOOK_URL || null;
```

E instanciar:
```javascript
const sessions = new SessionManager(WACLI_BIN, SESSIONS_DIR, WEBHOOK_URL);
```

Se já existe, **não mudar nada**. Se a env var for diferente (ex.: `WACLAW_WEBHOOK_URL`), unificar aqui — recomendo manter `WEBHOOK_URL` por compatibilidade com o código existente.

- [ ] **Step 2: Nenhuma mudança necessária se index.js já lê WEBHOOK_URL**

Confirmar que index.js **não precisa** de edição. O plano original assumia que `webhookUrl` nunca era propagado — na inspeção de 2026-04-11 o constructor já recebe, só não usa. Nosso patch em sessions.js habilita o uso. Nada mais a mudar em index.js.

### Task 4.6: Copiar os arquivos editados de volta para worker5

**Files:** nenhum local; só o scp.

- [ ] **Step 1: SCP de volta**

Run:
```bash
scp /tmp/waclaw-edit/sessions.js root@100.66.83.22:/opt/waclaw/src/sessions.js
```

Expected: 1 arquivo enviado.

- [ ] **Step 2: Confirmar no worker5**

Run:
```bash
ssh root@100.66.83.22 'grep -c "handleSyncEvent\|createInterface\|--emit-events" /opt/waclaw/src/sessions.js'
```

Expected: número ≥ 4 (pelo menos as 4 ocorrências dessas strings novas).

- [ ] **Step 3: Sintaxe básica node --check**

Run:
```bash
ssh root@100.66.83.22 'cd /opt/waclaw && /home/orcabot/.local/share/fnm/node-versions/v20.20.2/installation/bin/node --check src/sessions.js && echo SYNTAX_OK'
```

Expected: `SYNTAX_OK`. Se erro de sintaxe, corrigir em `/tmp/waclaw-edit/sessions.js` e repetir scp.

### Task 4.7: Commit waclaw local git

- [ ] **Step 1: Commit**

Run:
```bash
ssh root@100.66.83.22 'cd /opt/waclaw && git add src/sessions.js && git -c user.name="orcabot" -c user.email="orcabot@worker5.local" commit -m "feat(sessions): consume NDJSON from wacli sync --emit-events

Replaces the chunk-based proc.stdout.on(\"data\") handler with a
readline line reader that parses each line as JSON and dispatches
by event type. Adds --emit-events to the spawn args. Optional
POST forwarding to WEBHOOK_URL env var per parsed message.

Refs: docs/superpowers/plans/2026-04-11-wacli-emit-events.md"'
```

Expected: commit criado. Agora temos 2 commits no /opt/waclaw git repo.

- [ ] **Step 2: NÃO restartar waclaw ainda**

⚠️ **Não reiniciar `waclaw.service` ainda.** O binário wacli no worker5 ainda é o antigo (sem `--emit-events`). Se reiniciar agora, o `spawn` vai falhar com `Error: unknown flag: --emit-events` e o sync não sobe.

**Mitigação**: a flag é adicionada no Phase 6 quando trocamos o binário. Até lá, waclaw continua rodando com o código antigo em memória (systemd só re-executa src/index.js no restart — mudanças em src/sessions.js no disco não afetam o processo em execução).

- [ ] **Step 3: Limpar arquivos locais**

Run:
```bash
rm -rf /tmp/waclaw-edit
```

---

## Phase 5: Build do wacli no worker5

### Task 5.1: Verificar Go toolchain no worker5

- [ ] **Step 1: Conferir versão**

Run:
```bash
ssh orcabot@100.66.83.22 'go version'
```

Expected: `go version go1.23.4 linux/amd64` ou superior.

Se não achar o binário, usar path absoluto: `ssh orcabot@100.66.83.22 '/usr/local/bin/go version'` e anotar para os steps seguintes.

### Task 5.2: Clonar fork no worker5

- [ ] **Step 1: Clonar**

Run:
```bash
ssh orcabot@100.66.83.22 'mkdir -p /home/orcabot/src && cd /home/orcabot/src && git clone https://github.com/andrefogelman/wacli.git && cd wacli && git checkout feature/emit-events && git log --oneline -5'
```

Expected: clone ok, checkout da branch feature/emit-events, 4 commits recentes visíveis (3 do patch + 1 do upstream mais recente ou o merge base).

### Task 5.3: Build

- [ ] **Step 1: Build com FTS5**

Run:
```bash
ssh orcabot@100.66.83.22 'cd /home/orcabot/src/wacli && CGO_ENABLED=1 go build -tags sqlite_fts5 -o /tmp/wacli-new ./cmd/wacli 2>&1 | tail -20'
```

Expected: exit 0, sem warnings de CGO. Se erro de CGO: instalar gcc (`apt install -y build-essential` como root — cuidado, não é ação trivial).

- [ ] **Step 2: Smoke test local no worker5**

Run:
```bash
ssh orcabot@100.66.83.22 '/tmp/wacli-new version && /tmp/wacli-new sync --help | grep emit-events'
```

Expected:
- `version` retorna uma string (provavelmente `dev` ou commit curto).
- `--emit-events` aparece na ajuda da sync.

- [ ] **Step 3: Confirmar que é o binário com nossos commits**

Run:
```bash
ssh orcabot@100.66.83.22 'go version -m /tmp/wacli-new | grep -E "vcs.revision|mod"'
```

Expected: revision começa com um hash que corresponde ao commit head da sua branch feature/emit-events.

---

## Phase 6: Swap do binário em produção

⚠️ **Esta é a fase com maior blast radius.** Leia a seção "Rollback plan" no início do plano antes de começar.

### Task 6.1: Pre-swap — snapshot do estado atual

- [ ] **Step 1: Snapshot journalctl pré-swap**

Run:
```bash
ssh root@100.66.83.22 'journalctl -u waclaw.service -n 50 --no-pager > /tmp/waclaw-pre-swap.log && wc -l /tmp/waclaw-pre-swap.log'
```

Expected: arquivo com últimas 50 linhas do journal (baseline).

- [ ] **Step 2: Capturar binário atual**

Run:
```bash
ssh root@100.66.83.22 'ls -la /home/orcabot/.local/bin/wacli && md5sum /home/orcabot/.local/bin/wacli'
```

Anotar md5 e timestamp para rollback.

### Task 6.2: Parar waclaw

- [ ] **Step 1: Stop service**

Run:
```bash
ssh root@100.66.83.22 'systemctl stop waclaw.service && systemctl is-active waclaw.service; echo exit=$?'
```

Expected: `inactive` + `exit=3` (systemctl is-active retorna 3 para serviços parados).

- [ ] **Step 2: Confirmar que não há processos wacli órfãos**

Run:
```bash
ssh root@100.66.83.22 'pgrep -af "wacli sync" || echo NONE'
```

Expected: `NONE`. Se houver PIDs listados, kill: `ssh root@100.66.83.22 'pkill -9 -f "wacli sync"'`.

- [ ] **Step 3: Remover LOCK file órfão se existir**

Run:
```bash
ssh root@100.66.83.22 'ls /home/orcabot/.wacli/LOCK 2>/dev/null && rm -f /home/orcabot/.wacli/LOCK && echo REMOVED || echo NO_LOCK'
```

### Task 6.3: Backup do binário e swap

- [ ] **Step 1: Backup**

Run:
```bash
ssh root@100.66.83.22 'TS=$(date +%Y%m%d-%H%M%S); cp /home/orcabot/.local/bin/wacli /home/orcabot/.local/bin/wacli.bak-$TS && ls -la /home/orcabot/.local/bin/wacli.bak-$TS'
```

Expected: backup criado. **Anotar o timestamp.**

- [ ] **Step 2: Swap**

Run:
```bash
ssh root@100.66.83.22 'cp /tmp/wacli-new /home/orcabot/.local/bin/wacli && chown orcabot:orcabot /home/orcabot/.local/bin/wacli && chmod +x /home/orcabot/.local/bin/wacli && md5sum /home/orcabot/.local/bin/wacli'
```

Expected: novo md5 (diferente do snapshot anterior).

- [ ] **Step 3: Verificar permissão/executabilidade como orcabot**

Run:
```bash
ssh orcabot@100.66.83.22 '/home/orcabot/.local/bin/wacli version && /home/orcabot/.local/bin/wacli sync --help | grep emit-events'
```

Expected: versão imprime e `--emit-events` aparece na ajuda.

### Task 6.4: Start waclaw e monitorar

- [ ] **Step 1: Start**

Run:
```bash
ssh root@100.66.83.22 'systemctl start waclaw.service && sleep 3 && systemctl is-active waclaw.service'
```

Expected: `active`.

- [ ] **Step 2: Tail journalctl imediato**

Run:
```bash
ssh root@100.66.83.22 'journalctl -u waclaw.service -n 40 --no-pager --since "1 minute ago"'
```

Expected: ver linhas como:
```
[live-sync:admin] starting
Server listening at http://...:3100
[live-sync:admin:err] Connected.
```

**Red flags** (rollback imediato se aparecer):
- `Error: unknown flag: --emit-events` — significa que o binário swap não funcionou
- `panic:` — crash no Go
- `SyntaxError` em sessions.js — JS broken
- `readline is not a function` — import failed

Se qualquer red flag: **rollback** usando a seção Rollback plan no topo do plano.

### Task 6.5: Verificar primeiro evento NDJSON em journalctl

- [ ] **Step 1: Esperar primeiro evento real (ou enviar mensagem de teste)**

Opção A (esperar passivamente): aguardar 1-2 minutos por qualquer mensagem recebida no número admin (o fluxo normal).

Opção B (ativo): enviar mensagem de teste de outro celular pro número admin.

- [ ] **Step 2: Grep journalctl por dispatch event**

Run:
```bash
ssh root@100.66.83.22 'journalctl -u waclaw.service --since "2 minutes ago" --no-pager | grep -E "live-sync:admin|webhook|events_seen"'
```

Expected: pelo menos uma entrada mostrando que um evento foi processado. Se webhook URL configurada, logs mostram 200/404/timeout do POST.

Se não houver webhook URL configurada (`WEBHOOK_URL` não setado em `/etc/waclaw.env`), o evento ainda é processado localmente (refreshDb + log `[live-sync:admin]`) mas não há POST externo — é o caminho silencioso documentado e é o default seguro para o primeiro deploy.

---

## Phase 7: Verificação end-to-end e medição de latência

### Task 7.1: Ping de mensagem + medir latência

**Files:** nenhum.

- [ ] **Step 1: Enviar mensagem de teste com timestamp no texto**

De um segundo celular, enviar uma mensagem para o número admin com texto:
```
ping 2026-04-11T<HH:MM:SS.sss>
```

(Usar um timestamp que você anota manualmente quando envia, em milisegundos.)

- [ ] **Step 2: Verificar que aparece no journalctl**

Run:
```bash
ssh root@100.66.83.22 'journalctl -u waclaw.service --since "30 seconds ago" --no-pager | grep -A1 "live-sync:admin"'
```

Expected: linha com o evento processado. A própria linha do journalctl tem um timestamp — usar para medir latência.

- [ ] **Step 3: Calcular latência**

`latência = timestamp_journalctl - timestamp_texto_da_msg`.

Target: **< 2 segundos**. Ideal: **< 500ms**. Se > 5s, investigar — pode ser delay de propagação da Meta, não nosso código.

- [ ] **Step 4: Repetir 5 vezes para ter média**

Executar Steps 1-3 cinco vezes, anotando cada latência.

### Task 7.2: Teste de áudio (PTT) — o caso primário

- [ ] **Step 1: Gravar e enviar um áudio PTT curto**

De outro celular, gravar um áudio de ~5s e enviar para o número admin.

- [ ] **Step 2: Confirmar evento com media**

Run:
```bash
ssh root@100.66.83.22 'journalctl -u waclaw.service --since "30 seconds ago" --no-pager | grep -B1 -A1 "live-sync:admin"'
```

Expected: dispatch de evento processado. Se webhook configurada, POST para webhook com payload contendo `"media":{"type":"audio",...}`.

- [ ] **Step 3: Verificar o download-media continua funcionando**

Run:
```bash
ssh orcabot@100.66.83.22 'ls -lh /home/orcabot/.wacli/media/ | head -5'
```

Expected: arquivos de mídia recentes (download-media continua no background porque o flag ainda é passado em startLiveSync).

### Task 7.3: Soak test 30 minutos

- [ ] **Step 1: Deixar rodando e monitorar**

Run em uma janela de terminal:
```bash
ssh root@100.66.83.22 'journalctl -u waclaw.service -f --no-pager'
```

Manter aberto por 30 minutos. Conferir:
- Sem `panic:` ou `SyntaxError`
- Eventos sendo processados sem stall
- `refreshDb` continua sendo chamado (aparece indiretamente: leituras do PWA devem ver mensagens novas)
- Memória estável (rodar `ps -p $(pgrep -f "src/index.js") -o pid,vsz,rss`)

- [ ] **Step 2: Verificar memória estável (meio-tempo e fim)**

Run aos 15 min e aos 30 min:
```bash
ssh root@100.66.83.22 'ps -p $(pgrep -f "waclaw/src/index.js") -o pid,vsz,rss,pcpu'
```

Expected: RSS estável dentro de 10% entre as duas medidas. Se crescendo linearmente, suspeitar de leak — investigar antes de declarar sucesso.

### Task 7.4: Documentar resultados no final do plano

**Files:**
- Modify: este plano (`docs/superpowers/plans/2026-04-11-wacli-emit-events.md`)

- [ ] **Step 1: Adicionar seção "Deploy notes" no final**

Edit este arquivo — adicionar ao final, abaixo de "Phase 9":

```markdown
---

## Deploy notes (preencher durante execução)

- **Data do deploy:** YYYY-MM-DD HH:MM BRT
- **Commit wacli na feature branch:** <hash>
- **Backup /opt/waclaw:** /opt/waclaw.bak-<timestamp>
- **Backup wacli binary:** /home/orcabot/.local/bin/wacli.bak-<timestamp>
- **Latência ping medida (5 amostras):** [x, y, z, w, v] ms — média: N ms
- **Áudio PTT end-to-end:** observado / não observado
- **Soak 30min:** RSS inicial X MB → RSS final Y MB (delta Z%)
- **Regressões:** (nenhuma / lista)
```

- [ ] **Step 2: Commit no zapi-pwa repo**

Run:
```bash
cd /Users/andrefogelman/zapi-pwa
git add docs/superpowers/plans/2026-04-11-wacli-emit-events.md
git commit -m "docs: record wacli --emit-events deploy notes

Refs: docs/superpowers/plans/2026-04-11-wacli-emit-events.md"
```

---

## Phase 8: (Optional) Upstream contribution

### Task 8.1: Avaliar se o patch é limpo o suficiente para PR

- [ ] **Step 1: Self-review**

Critérios para subir PR:
- [x] Todos os testes passam
- [x] Não adiciona deps novas ao go.mod
- [x] Feature é opt-in (default `false`)
- [x] Não muda comportamento de wacli sem flag
- [x] Código em estilo do upstream (tabs, comentários concisos, nomes de funções)

Se tudo tickado, prosseguir. Caso contrário, ficar no fork.

### Task 8.2: Abrir PR

- [ ] **Step 1: Squash commits em 1 commit limpo (opcional)**

Run:
```bash
cd /Users/andrefogelman/src/wacli
git checkout feature/emit-events
git rebase -i main   # squash em "feat(sync): add --emit-events NDJSON event stream"
```

- [ ] **Step 2: Push e abrir PR**

Run:
```bash
git push --force-with-lease origin feature/emit-events
gh pr create --repo steipete/wacli --title "feat(sync): add --emit-events NDJSON event stream" --body "$(cat <<'EOF'
## Summary

Adds a `--emit-events` flag to `wacli sync` that writes one NDJSON line to stdout per whatsmeow event received. When enabled, the usual sync_complete summary is also emitted through the same channel, so consumers can use a single line-based decoder end-to-end.

## Motivation

Several projects wrap `wacli sync --follow` as a background daemon (e.g. ArvorCo/concierge, emanueleielo/ciana-parrot, the zapi-pwa waclaw service) and currently have no way to receive messages in real time — they either poll the local SQLite or parse the human-oriented stderr line "Synced N messages..." which batches at N=25.

With `--emit-events`, a parent process can spawn wacli once, read stdout line-by-line, and dispatch by event type — sub-second latency, zero polling.

## Design

- New package `internal/out` types: `Event`, `MessagePayload`, `MediaPayload`, `SyncCompletePayload`, with `EncodeMessageEvent` and `EncodeSyncComplete`.
- `internal/out` has **no dependency on `internal/wa`** — byte slices arrive already base64-encoded. Conversion from `wa.ParsedMessage` to `out.MessagePayload` lives in `internal/app/sync.go` where both packages are already in scope.
- `SyncOptions.EmitEvents` gates the new behavior — default false, fully backward compatible.
- Write errors to `os.Stdout` are silently ignored inside the handler so a broken pipe never kills the sync loop (the SQLite store is still the source of truth).

## Tests

- Table-driven tests in `internal/out/events_test.go` cover: text-only message, media message with byte-slice base64 roundtrip, sync_complete, NDJSON framing (multi-event stream).
- Existing `internal/app/sync_test.go` continues to pass unchanged.

## Backward compatibility

The flag is opt-in (default false). Existing consumers of `wacli sync`, `wacli sync --once`, and `wacli sync --follow --json` see no behavior change.
EOF
)"
```

Expected: PR aberto. Peter pode aceitar, ajustar, ou ignorar — se ignorar, você fica no fork. Sem problema.

---

## Phase 9: Handoff para admin-multitenant (quando aquele plano avançar)

Este plano entrega **apenas** o pipeline de eventos: wacli → waclaw → webhook opcional. O admin-multitenant pode:

- Implementar um handler Next.js em `/api/internal/on-audio` e apontar `WEBHOOK_URL=https://pwa.vercel.app/api/internal/on-audio` em `/etc/waclaw.env`
- Ou: em vez de webhook, subscrever Supabase Realtime (neste caso, waclaw pode INSERT direto no Supabase — substituir `forwardEventToWebhook` por chamada ao `@supabase/supabase-js` client, que já está em `package.json` do waclaw)

Esse trabalho é escopo do plano admin-multitenant — este plano aqui cria a rampa.

---

## Self-review (preencher ao final da escrita, antes do primeiro commit do plano)

### 1. Cobertura do spec
- ✅ Patch wacli para emitir NDJSON → Phase 1-3
- ✅ Patch waclaw para consumir NDJSON → Phase 4
- ✅ Build + deploy do binário → Phase 5-6
- ✅ Verificação de latência < 2s → Phase 7
- ✅ Rollback seguro → seção "Rollback plan"
- ✅ Tests automatizados para o encoder → Phase 1 (task 1.1 a 1.5)
- ✅ Handoff para admin-multitenant → Phase 9

### 2. Placeholder scan
- ✅ Nenhum "TODO" / "TBD" / "fill in later"
- ✅ Cada step de código tem código completo
- ✅ Cada step de comando tem comando completo + output esperado
- ✅ Nenhuma referência a função não-definida

### 3. Type consistency
- ✅ `EncodeMessageEvent(w io.Writer, m MessagePayload) error` — mesmo nome em Phase 1 e em Phase 3
- ✅ `EncodeSyncComplete(w io.Writer, messagesStored int64) error` — consistente em Phase 1 e Phase 3
- ✅ `SyncOptions.EmitEvents bool` — nome consistente entre `internal/app/sync.go` e `cmd/wacli/sync.go`
- ✅ `parsedToEventPayload(pm wa.ParsedMessage) out.MessagePayload` — usada uma vez, definida uma vez
- ✅ `handleSyncEvent(id, evt)` — definida em sessions.js, chamada em sessions.js
- ✅ `forwardEventToWebhook(id, evt)` — definida, chamada
- ✅ `webhookUrl` (Node) vs `WEBHOOK_URL` (env) — documentado que são o mesmo valor

### 4. Riscos não cobertos / assumptions
- **Assume** que o admin-multitenant já mergeou — verificado em Task 0.1
- **Assume** que `/opt/waclaw` é writable como root — verdade (checado em investigação)
- **Assume** que `go1.23.4` no worker5 consegue buildar whatsmeow — é o que o próprio upstream usa (verificado `go version -m` no binário atual)
- **Não cobre** o caso de múltiplas sessões no `SessionManager` sendo criadas durante o swap — mitigado pelo `systemctl stop` antes do swap
- **Não cobre** upgrade automático do waclaw se o binário wacli mudar no futuro — fica como operação manual

---

## Deploy notes (preencher durante execução)

- **Data do deploy:** ____
- **Commit wacli na feature branch:** ____
- **Backup /opt/waclaw:** /opt/waclaw.bak-____
- **Backup wacli binary:** /home/orcabot/.local/bin/wacli.bak-____
- **Latência ping medida (5 amostras):** ____ ms — média: ____ ms
- **Áudio PTT end-to-end:** ____
- **Soak 30min:** RSS inicial ____ MB → RSS final ____ MB (delta ____%)
- **Regressões:** ____
