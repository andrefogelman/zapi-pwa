# Admin multi-tenant + import do zapi-transcriber

**Status:** design approved, awaiting user review before implementation-planning
**Date:** 2026-04-11
**Repo:** `andrefogelman/zapi-pwa`

## Contexto

O zapi-pwa hoje é um PWA tipo WhatsApp multi-usuário via Supabase Auth, com `instances.user_id → auth.users` e RLS por usuário. O chat UI vive em `/app` e lê mensagens de sessões waclaw (self-hosted em worker5). Existe também código Z-API legado (`/api/webhook`, `/api/instances/qr`, `src/lib/zapi.ts`) que não é usado pelo chat mas permanece no repo.

O zapi-transcriber (repo separado) tem funcionalidade de admin que queremos trazer:
- Prompt/modelo/temperature da "Neura" editável
- Grupos autorizados com flags `transcribe_all`, `monitor_daily`
- Filtro que decide transcrever ou não
- Reply automático no WhatsApp com rodapé customizado
- `/api/summary` por período
- Admin UI com abas

O transcriber é single-tenant (singleton `zapi_config`, grupos globais). O zapi-pwa precisa ser multi-tenant: múltiplos usuários, cada um com múltiplas instâncias, cada instância com seus próprios grupos.

## Goals

1. Página administrativa `/admin` para gerenciar a plataforma (só super-admin).
2. Gestão de usuários (convidar, listar, promover/rebaixar, desabilitar, deletar, resetar senha).
3. Editor do prompt/modelo/temperature da Neura (singleton global).
4. Por usuário: múltiplas instâncias de WhatsApp via waclaw, cada uma conectada por QR.
5. Por instância: grupos autorizados com flags independentes (`transcribe_all`, `send_reply`, `monitor_daily`).
6. Rodapé de transcrição customizado por usuário (ex: `"Transcrição por IA by Andre 😜"`).
7. Transcrição automática via daemon no worker5, com filtro respeitando regras por instância/grupo.
8. DMs sempre transcritas e sempre com reply de volta.
9. Monorepo workspaces pra suportar o daemon sem duplicar código.

## Non-goals

- Não migrar as instâncias Z-API existentes — mantemos código Z-API legado invisível, novas instâncias só nascem waclaw.
- Não cobrir transcrição automática pra instâncias Z-API legadas — elas continuam como estão (on-demand no PWA).
- Não implementar "impersonar usuário" nem "ver instâncias de outro usuário" (decisão: exceder escopo).
- Não implementar queue externa (Redis, etc.) — retry com backoff no daemon é suficiente pro MVP.
- Não implementar auditoria de ações admin além do `updated_by` no `platform_config`.
- Não implementar `/api/summary` nesse spec — fica pra uma evolução depois que o admin estiver estável (embora a rota já exista em progresso no repo, não commitada).

## Decisões-chave tomadas no brainstorming

| Tópico | Decisão |
|---|---|
| Tenancy | 1 usuário = N instâncias waclaw; Neura é singleton global; `transcription_footer` por usuário |
| Super-admin | Coluna `role` em `user_settings` com valores `'user' \| 'super_admin'`; trigger anti-auto-promoção; seed hardcoded `andre@anf.com.br` |
| Onboarding | Convite via `supabase.auth.admin.inviteUserByEmail`; super-admin é o único que convida |
| Ações admin | listar, convidar, reenviar convite, promover/rebaixar, desabilitar, deletar, resetar senha |
| Roteamento | Config pessoal no `SettingsModal` existente (novas abas); `/admin/*` separado só pra super-admin |
| Filtro transcrição | DMs sempre on; DM com `send_reply` sempre on; grupos exigem autorização explícita |
| Provedor | Waclaw-only pra features novas; Z-API fica como código legado intocado |
| Auto-transcribe | Daemon novo no worker5 escuta eventos waclaw e forwarda pro Next |
| Arquitetura | Monorepo workspaces (3a): `packages/shared`, `packages/pwa`, `packages/daemon`; daemon magro |

## Arquitetura em alto nível

```
┌───────────────────────────────────────────────────────────────┐
│                     worker5 (100.66.83.22)                     │
│                                                                 │
│   waclaw (já existente)          zapi-pwa-daemon (novo)        │
│   porta 3100                ◄────┐                              │
│   sessões WhatsApp multi-user    │ subscribe events            │
│                                   │                              │
│                                   └─► POST /api/internal/on-audio│
└────────────────────────────────────────┬───────────────────────┘
                                         │ HTTPS + header secret
                                         ▼
┌───────────────────────────────────────────────────────────────┐
│                   Vercel — zapi-pwa (Next.js)                  │
│                                                                 │
│  /api/internal/on-audio                                         │
│    │                                                             │
│    ├─► filterMessage(event, instance, group)                    │
│    ├─► Whisper via platform_config (neura_*)                    │
│    ├─► INSERT messages + transcriptions (Supabase)              │
│    └─► (if shouldReply) waclaw.sendMessage(text + footer)       │
│                                                                 │
│  /api/admin/*  (super-admin only — validado em middleware + code)│
│  /api/instances/*  (owner-only RLS)                             │
│  /api/user-settings  (self-only)                                │
│                                                                 │
│  /app    → chat UI (existente, lê waclaw via proxy)             │
│  /admin  → dashboard, users, neura                              │
└────────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────┐
│                         Supabase                                │
│                                                                 │
│  auth.users                                                     │
│  public.user_settings  ───────► role, status, footer            │
│  public.platform_config ──────► singleton Neura config          │
│  public.instances ────────────► waclaw_session_id, my_phones    │
│  public.instance_groups ──────► (instance_id, group_id) flags   │
│  public.messages / transcriptions / push_subscriptions          │
│                                                                 │
│  RLS: user_settings (self or super_admin)                       │
│       platform_config (read all, write super_admin)             │
│       instance_groups (scoped via instances.user_id)            │
└───────────────────────────────────────────────────────────────┘
```

## Estrutura do monorepo

Refactor em um commit único (`refactor: restructure as bun workspace monorepo`), movendo tudo via `git mv` pra preservar histórico.

```
zapi-pwa/
├── package.json                    # workspaces: ["packages/*"]
├── bun.lock                        # lock único
├── tsconfig.base.json              # tsconfig compartilhado (strict, target, paths)
├── .vercel/                        # root directory = packages/pwa (configurar no dashboard)
├── .gitignore                      # adicionar packages/*/node_modules, dist, .next
├── supabase/
│   └── migrations/
│       ├── 00001_foundation.sql          # existente — não mexer
│       ├── 00002_add_provider.sql        # existente — não mexer
│       └── 00003_admin_multitenant.sql   # novo
├── docs/
│   └── superpowers/specs/
│       └── 2026-04-11-admin-multitenant-design.md
├── scripts/
│   └── deploy-daemon.sh            # ssh worker5 → git pull → bun install → systemctl restart
│
└── packages/
    ├── shared/                     # 📦 zapi-shared
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts            # barrel
    │       ├── constants.ts        # INTERNAL_HEADER_SECRET, MAX_AUDIO_BYTES, backoff
    │       └── validators/
    │           └── events.ts       # OnAudioEventSchema + inferred type
    │
    ├── pwa/                        # 📦 Next.js (zapi-pwa atual inteiro)
    │   ├── package.json            # deps: zapi-shared (workspace:*), ...existente
    │   ├── next.config.ts
    │   ├── tsconfig.json
    │   ├── public/
    │   └── src/
    │       ├── middleware.ts       # estendida (proteção /admin + disabled check)
    │       ├── app/
    │       │   ├── app/            # chat UI (existente, com ajustes)
    │       │   │   ├── page.tsx                 # first-run wizard se instances vazias
    │       │   │   └── components/
    │       │   │       ├── SettingsModal.tsx    # estendido: abas Perfil, Instâncias, Grupos
    │       │   │       ├── QRConnectWizard.tsx  # 🆕 reusável
    │       │   │       └── Sidebar.tsx          # link Admin se super_admin
    │       │   ├── admin/          # 🆕
    │       │   │   ├── layout.tsx
    │       │   │   ├── page.tsx                 # dashboard stats
    │       │   │   ├── users/page.tsx
    │       │   │   └── neura/page.tsx
    │       │   └── api/
    │       │       ├── webhook/route.ts             # 🚫 Z-API legado — não tocar
    │       │       ├── transcribe/route.ts          # 🚫 existente — não tocar
    │       │       ├── internal/
    │       │       │   └── on-audio/route.ts        # 🆕 daemon bate aqui
    │       │       ├── admin/
    │       │       │   ├── users/route.ts           # 🆕 GET (list), POST (invite)
    │       │       │   ├── users/[id]/route.ts      # 🆕 DELETE
    │       │       │   ├── users/[id]/role/route.ts        # 🆕 PATCH
    │       │       │   ├── users/[id]/disable/route.ts     # 🆕 PATCH
    │       │       │   ├── users/[id]/reset/route.ts       # 🆕 POST
    │       │       │   ├── users/[id]/resend/route.ts      # 🆕 POST
    │       │       │   ├── stats/route.ts           # 🆕 GET — dashboard numbers
    │       │       │   └── platform-config/route.ts # 🆕 GET, PUT
    │       │       ├── user-settings/route.ts       # 🆕 GET, PATCH
    │       │       └── instances/
    │       │           ├── route.ts                 # 🔧 existente, ajustar (waclaw-only)
    │       │           ├── [id]/route.ts            # 🔧 existente, validar delete cascata
    │       │           ├── [id]/qr/route.ts         # 🆕 waclaw QR
    │       │           ├── [id]/status/route.ts     # 🆕 waclaw status polling
    │       │           ├── [id]/groups/route.ts     # 🆕 GET, POST
    │       │           ├── [id]/groups/fetch/route.ts        # 🆕 puxar grupos do waclaw
    │       │           └── [id]/groups/[groupId]/route.ts    # 🆕 PATCH, DELETE
    │       └── lib/
    │           ├── admin-auth.ts   # 🆕 requireSuperAdmin(req)
    │           ├── filter.ts       # 🆕 filterMessage pura
    │           ├── footer.ts       # 🆕 formatReply pura
    │           ├── waclaw.ts       # 🆕 client waclaw (create/qr/status/send/groups/delete)
    │           ├── zapi.ts         # 🚫 existente — não tocar (legado)
    │           ├── openai.ts       # 🔧 estender transcribeAudio pra aceitar model/prompt/temp
    │           └── supabase-server.ts  # 🔧 adicionar getSupabaseServiceRole()
    │
    └── daemon/                     # 📦 zapi-pwa-daemon
        ├── package.json            # deps: zapi-shared (workspace:*), zod
        ├── tsconfig.json
        ├── systemd/
        │   └── zapi-pwa-daemon.service
        ├── README.md
        └── src/
            ├── index.ts            # bootstrap, signal handlers
            ├── waclaw-client.ts    # connectAndSubscribe com reconnect/backoff
            ├── forwarder.ts        # POST pro Next com retry/backoff
            └── logger.ts           # JSON structured logs
```

### Convenções

- **`shared/` é puro**: zero imports de `next/*`, `window`, `fs`. Só TypeScript + zod.
- **Sem build step no shared**: consumidores importam `.ts` direto via workspace link.
- **`supabase/` fica na raiz do repo** (não dentro de packages).
- **Vercel config**: `rootDirectory = packages/pwa`, `installCommand = bun install` (roda na raiz), `buildCommand = bun run build` (herda `packages/pwa/package.json`).
- **OpenAI key só no Next**: daemon nem vê Whisper.
- **Supabase service role só no Next**: daemon não toca no DB direto.

## Data model

Uma única migration nova: `supabase/migrations/00003_admin_multitenant.sql`. Nada existente é dropado ou alterado destrutivamente.

### Tabelas novas

**`public.user_settings`**

```sql
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'super_admin')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  transcription_footer TEXT NOT NULL
    DEFAULT 'Transcrição por IA 😜',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`public.platform_config`** — singleton Neura (PK INTEGER + CHECK, sem truques)

```sql
CREATE TABLE public.platform_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  neura_prompt TEXT NOT NULL,
  neura_model TEXT NOT NULL DEFAULT 'gpt-4o',
  neura_temperature NUMERIC(3,2) NOT NULL DEFAULT 0.5
    CHECK (neura_temperature >= 0 AND neura_temperature <= 2),
  neura_top_p NUMERIC(3,2) NOT NULL DEFAULT 0.5
    CHECK (neura_top_p >= 0 AND neura_top_p <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
```

Só uma linha possível: PK fixa em 1, CHECK impede outros valores, segundo INSERT dá `duplicate key`.

**`public.instance_groups`**

```sql
CREATE TABLE public.instance_groups (
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  group_lid TEXT,
  subject TEXT NOT NULL,
  subject_owner TEXT,
  transcribe_all BOOLEAN NOT NULL DEFAULT false,
  send_reply BOOLEAN NOT NULL DEFAULT true,
  monitor_daily BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, group_id)
);

CREATE INDEX idx_instance_groups_instance ON public.instance_groups(instance_id);
```

### Alterações em tabelas existentes

```sql
-- instances ganha colunas pra filter saber quais números ignorar (eco próprio)
ALTER TABLE public.instances
  ADD COLUMN my_phones TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN my_lids TEXT[] NOT NULL DEFAULT '{}';
```

Nenhuma outra mudança em `instances`, `messages`, `transcriptions`, `push_subscriptions`. Colunas Z-API legadas permanecem.

### RLS

**`user_settings`**

```sql
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own or all if admin"
  ON public.user_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "Update own row"
  ON public.user_settings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

-- Sem policy de INSERT (tudo via trigger) nem DELETE (tudo via service role admin API).
```

**`platform_config`**

```sql
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone authenticated reads"
  ON public.platform_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Only super-admin updates"
  ON public.platform_config FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
```

**`instance_groups`**

```sql
ALTER TABLE public.instance_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage groups of own instances"
  ON public.instance_groups FOR ALL TO authenticated
  USING (instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid()))
  WITH CHECK (instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid()));
```

### Funções e triggers

**`is_super_admin()`**

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
      AND status = 'active'
  );
$$;
```

**`protect_user_settings_sensitive()`** — impede qualquer UPDATE direto em `role`/`status` a menos que o bypass tenha sido explicitamente setado pela função admin

```sql
CREATE OR REPLACE FUNCTION public.protect_user_settings_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Bypass: se uma função admin setou zapi.admin_bypass='yes' via SET LOCAL,
  -- confiamos que ela já validou o caller e deixamos passar.
  IF COALESCE(current_setting('zapi.admin_bypass', true), '') = 'yes' THEN
    RETURN NEW;
  END IF;

  -- Sem bypass: role e status não podem mudar em UPDATE direto.
  -- (Inclusive service role sem passar pela função admin — defense in depth.)
  NEW.role := OLD.role;
  NEW.status := OLD.status;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_user_settings_sensitive
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_settings_sensitive();
```

**Por que não confiar em `is_super_admin()` direto no trigger**: quando o service role roda o UPDATE, `auth.uid()` retorna NULL, `is_super_admin()` retorna false, e o trigger reverteria — mesmo que seja o admin legítimo chamando via API. Por isso o bypass explícito é obrigatório: a função admin (SECURITY DEFINER) valida o caller em código e sinaliza via `set_config` que aquele UPDATE específico pode passar.

**Funções admin que o Next usa** (via `rpc('admin_update_user_role', ...)` e `rpc('admin_update_user_status', ...)`):

```sql
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  target_user_id UUID,
  new_role TEXT,
  caller_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF new_role NOT IN ('user', 'super_admin') THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;

  -- Caller precisa ser super_admin ativo (validado via parâmetro, não auth.uid())
  IF NOT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = caller_user_id
      AND role = 'super_admin'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'caller is not super_admin';
  END IF;

  IF target_user_id = caller_user_id AND new_role != 'super_admin' THEN
    RAISE EXCEPTION 'cannot demote self';
  END IF;

  -- Sinaliza pro trigger que pode passar. SET LOCAL expira no fim da transação.
  PERFORM set_config('zapi.admin_bypass', 'yes', true);

  UPDATE public.user_settings
  SET role = new_role, updated_at = now()
  WHERE user_id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_status(
  target_user_id UUID,
  new_status TEXT,
  caller_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF new_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'invalid status: %', new_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = caller_user_id
      AND role = 'super_admin'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'caller is not super_admin';
  END IF;

  IF target_user_id = caller_user_id AND new_status = 'disabled' THEN
    RAISE EXCEPTION 'cannot disable self';
  END IF;

  PERFORM set_config('zapi.admin_bypass', 'yes', true);

  UPDATE public.user_settings
  SET status = new_status, updated_at = now()
  WHERE user_id = target_user_id;
END;
$$;
```

E dentro da função `admin_update_user_role`:

```sql
PERFORM set_config('zapi.admin_bypass', 'yes', true);  -- local scope
UPDATE public.user_settings SET ...;
-- set_config com is_local=true expira no fim da transação
```

Isso garante que:
1. Cliente autenticado via JWT não consegue mexer role/status (trigger reverte).
2. Super-admin via função admin consegue (bypass setado explicitamente).
3. Service role sem passar pela função não consegue (bypass não setado).

**`handle_new_user()`** — cria `user_settings` e já promove super-admin se email na lista

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_display_name TEXT;
  v_is_super BOOLEAN;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  -- Lista hardcoded de super-admins iniciais
  v_is_super := NEW.email = ANY (ARRAY['andre@anf.com.br']);

  INSERT INTO public.user_settings (
    user_id,
    display_name,
    transcription_footer,
    role
  )
  VALUES (
    NEW.id,
    v_display_name,
    'Transcrição por IA by ' || v_display_name || ' 😜',
    CASE WHEN v_is_super THEN 'super_admin' ELSE 'user' END
  );
  -- SEM ON CONFLICT: se falhar, aborta transação do auth.users (fail-fast)
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

Safety net no `packages/pwa/src/app/app/layout.tsx` (server component) faz upsert idempotente por precaução:

```ts
await supabase
  .from("user_settings")
  .upsert(
    {
      user_id: user.id,
      display_name: user.user_metadata?.full_name ?? user.email?.split("@")[0],
      transcription_footer:
        `Transcrição por IA by ${user.user_metadata?.full_name ?? user.email?.split("@")[0]} 😜`,
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );
```

### Seeds

```sql
-- 1. platform_config singleton.
-- O prompt abaixo é literalmente o NEURA_SYSTEM_PROMPT de
-- /Users/andrefogelman/zapi-transcriber/src/lib/neura-prompt.ts na data desse spec.
-- Aspas simples escapadas com doubling pra SQL.
INSERT INTO public.platform_config (neura_prompt, neura_model, neura_temperature, neura_top_p)
VALUES (
  E'**Perfil da Assistente de Inteligência Artificial - Resumidora**\n\n'
  E'**Nome:** Neura\n\n'
  E'**Objetivo:**\n'
  E'Realizar resumos precisos e objetivos das mensagens de texto recebidas, usando sempre portugues, garantindo clareza, eficiência e fidelidade ao conteúdo original.\n\n'
  E'## somente apresentar o output em Portugues##\n\n'
  E'**Principais Habilidades:**\n'
  E'* Compreensão avançada de texto.\n'
  E'* Capacidade de síntese objetiva e precisa.\n'
  E'* Habilidade em destacar informações essenciais.\n'
  E'* Manutenção do contexto original das mensagens.\n'
  E'* Capacidade de ouvir e transcrever mensagens de audio.\n\n'
  E'**Personalidade:**\n'
  E'* Objetiva e direta.\n'
  E'* Clara e concisa.\n'
  E'* Confiável e imparcial.\n'
  E'* Proativa em identificar informações críticas.\n\n'
  E'**Funções:**\n'
  E'* Receber mensagens de texto variadas.\n'
  E'* Analisar e interpretar rapidamente conteúdos recebidos.\n'
  E'* Produzir resumos curtos, mantendo fidelidade ao conteúdo original.\n'
  E'* Retornar mensagens resumidas em formato acessível e fácil de ler.\n\n'
  E'**Formato das Respostas:**\n'
  E'* A resposta tem de ser sempre em Portugues do Brasil.\n'
  E'* Se necessário traduza o texto para Portugues.\n'
  E'* Texto curto e claro.\n'
  E'* Estrutura padronizada (introdução breve, pontos principais, conclusão quando necessário).\n'
  E'* Quando houver enumeração de itens organizar em diferentes linhas.\n'
  E'* Dar especial atenção as regras gramaticais.\n'
  E'* Procurar pontuar as frases e iniciar novas frases com maiúsculas.\n'
  E'* Caso tenha um audio que seja inteligível responda - "Não consegui entender"\n'
  E'* Não usar termos como tá, colocar no lugar está, ou tô colocar no lugar de estou e outros casos similares.',
  'gpt-4o', 0.5, 0.5
);

-- 2. Popular user_settings pra qualquer user que já exista em auth.users
INSERT INTO public.user_settings (user_id, display_name, transcription_footer)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
  'Transcrição por IA by ' || COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) || ' 😜'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 3. Promover Andre como super-admin (se já existe em auth.users).
-- Se ainda não existir, o trigger handle_new_user promove quando a conta for criada.
-- Precisa de DO block porque PERFORM/set_config só rodam dentro de plpgsql.
DO $$
BEGIN
  PERFORM set_config('zapi.admin_bypass', 'yes', true);
  UPDATE public.user_settings
  SET role = 'super_admin'
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'andre@anf.com.br');
END;
$$;
```

### Cascades

Já existentes via FKs:
- `auth.users` DELETE → `instances` → `messages` → `transcriptions`
- `auth.users` DELETE → `user_settings`, `push_subscriptions`
- `instances` DELETE → `instance_groups`

Rota `DELETE /api/admin/users/[id]` chama `supabase.auth.admin.deleteUser(id)` com service role, Supabase propaga cascata.

### Realtime

Nenhuma tabela nova entra em `supabase_realtime`. Admin UI faz refetch on save.

## Package `shared`

```
packages/shared/src/
├── index.ts            # export * de constants e validators/events
├── constants.ts
└── validators/
    └── events.ts
```

**`constants.ts`**

```ts
export const INTERNAL_HEADER_SECRET = "X-Zapi-Internal-Secret";
export const INTERNAL_HEADER_DAEMON_ID = "X-Zapi-Daemon-Id";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper limit
export const DAEMON_FORWARD_MAX_RETRIES = 3;
export const DAEMON_FORWARD_BACKOFF_MS = [1000, 3000, 10000] as const;
```

**`validators/events.ts`** — single source of truth (type inferido do zod, sem arquivo separado de types)

```ts
import { z } from "zod";

export const OnAudioEventSchema = z.object({
  waclaw_session_id: z.string().min(1),
  message_id: z.string().min(1),
  chat_jid: z.string().min(1),
  chat_name: z.string(),
  sender_phone: z.string(),
  sender_name: z.string().nullable(),
  from_me: z.boolean(),
  is_group: z.boolean(),
  audio_url: z.string().url(),
  audio_duration_seconds: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});

export type OnAudioEvent = z.infer<typeof OnAudioEventSchema>;

export const OnAudioResponseSchema = z.object({
  status: z.enum(["queued", "skipped", "transcribed", "failed"]),
  reason: z.string().optional(),
});

export type OnAudioResponse = z.infer<typeof OnAudioResponseSchema>;
```

**`package.json`**

```json
{
  "name": "zapi-shared",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": { "zod": "^3.23.0" }
}
```

## Rotas backend em `packages/pwa`

### Bloco 1 — `/api/admin/*` (super-admin only)

Helper `lib/admin-auth.ts`:

```ts
export async function requireSuperAdmin(request: Request): Promise<{
  user: User;
  supabaseAdmin: SupabaseClient; // service role
}> {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) throw new HttpError(401, "unauthorized");

  const user = await getUserFromToken(token);
  if (!user) throw new HttpError(401, "unauthorized");

  const supabase = getSupabaseServer();
  const { data: settings } = await supabase
    .from("user_settings")
    .select("role, status")
    .eq("user_id", user.id)
    .single();

  if (settings?.role !== "super_admin" || settings?.status !== "active") {
    throw new HttpError(403, "forbidden");
  }

  return { user, supabaseAdmin: getSupabaseServiceRole() };
}
```

Rotas:

| Método | Path | Função |
|---|---|---|
| GET | `/api/admin/users` | lista todos users + stats (email, role, status, instance_count, last_sign_in) |
| POST | `/api/admin/users` | `inviteUserByEmail(email)`. body: `{ email }` |
| POST | `/api/admin/users/[id]/resend` | reenviar convite |
| PATCH | `/api/admin/users/[id]/role` | `{ role: 'user'\|'super_admin' }`. Chama `supabaseAdmin.rpc('admin_update_user_role', { target_user_id, new_role, caller_user_id })`. A função SQL valida caller + self-demote + dispara bypass do trigger. Rota traduz `RAISE EXCEPTION` em 400/403. |
| PATCH | `/api/admin/users/[id]/disable` | `{ disabled: boolean }`. Chama `supabaseAdmin.rpc('admin_update_user_status', { target_user_id, new_status, caller_user_id })`. Em seguida, se `disabled=true`, também chama `supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' })` pra invalidar sessões ativas; se `disabled=false`, `{ ban_duration: 'none' }` pra liberar. |
| POST | `/api/admin/users/[id]/reset` | `auth.admin.generateLink({ type: 'recovery' })` |
| DELETE | `/api/admin/users/[id]` | `auth.admin.deleteUser(id)`. Bloqueia self. |
| GET | `/api/admin/stats` | `{ total_users, connected_instances, transcribed_today, failed_today }` |
| GET | `/api/admin/platform-config` | singleton row |
| PUT | `/api/admin/platform-config` | valida temperature/top_p/model, updated_by=caller.id |

### Bloco 2 — `/api/user-settings`

| Método | Path | Função |
|---|---|---|
| GET | `/api/user-settings` | retorna `display_name`, `transcription_footer` (NUNCA role/status) |
| PATCH | `/api/user-settings` | atualiza `display_name`, `transcription_footer`. Trigger protege role/status. |

### Bloco 3 — `/api/instances/*`

| Método | Path | Status | Função |
|---|---|---|---|
| GET | `/api/instances` | 🔧 existente | filtrar `provider='waclaw'` por default; `?include_legacy=true` mostra Z-API |
| POST | `/api/instances` | 🔧 existente | forçar `provider='waclaw'`; rejeitar `'zapi'` |
| GET | `/api/instances/[id]` | 🔧 existente | ownership check |
| DELETE | `/api/instances/[id]` | 🔧 existente | chama `waclaw.deleteSession` antes do delete |
| GET | `/api/instances/[id]/qr` | 🆕 | `GET ${WACLAW_URL}/sessions/${session_id}/qr` → `{ qr: string, format }` |
| GET | `/api/instances/[id]/status` | 🆕 | `GET ${WACLAW_URL}/sessions/${session_id}` → status. Se connected, atualiza `connected_phone`, `my_phones`. |
| 🚫 | `/api/instances/qr` | 🚫 existente | Z-API legado, não tocar |

### Bloco 4 — `/api/instances/[id]/groups/*`

| Método | Path | Função |
|---|---|---|
| GET | `/api/instances/[id]/groups` | lista grupos autorizados da instância |
| POST | `/api/instances/[id]/groups` | upsert de grupo por `(instance_id, group_id)` |
| PATCH | `/api/instances/[id]/groups/[groupId]` | toggle `transcribe_all`, `send_reply`, `monitor_daily` |
| DELETE | `/api/instances/[id]/groups/[groupId]` | remover grupo |
| GET | `/api/instances/[id]/groups/fetch` | puxa grupos ao vivo do waclaw — não persiste |

### Bloco 5 — `/api/internal/on-audio` (hot path)

```ts
// packages/pwa/src/app/api/internal/on-audio/route.ts
export const maxDuration = 60;

import { OnAudioEventSchema, INTERNAL_HEADER_SECRET } from "zapi-shared";
import { getSupabaseServiceRole } from "@/lib/supabase-server";
import { filterMessage } from "@/lib/filter";
import { transcribeAudio } from "@/lib/openai";
import { buildWaclawClient } from "@/lib/waclaw";
import { formatReply } from "@/lib/footer";

export async function POST(req: Request) {
  // 1. Auth via header secret
  if (req.headers.get(INTERNAL_HEADER_SECRET) !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return Response.json({ status: "failed", reason: "unauthorized" }, { status: 401 });
  }

  // 2. Schema validation
  const parsed = OnAudioEventSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ status: "failed", reason: "invalid payload" }, { status: 400 });
  }
  const event = parsed.data;
  const supabase = getSupabaseServiceRole();

  // 3. Instance lookup por waclaw_session_id
  const { data: instance } = await supabase
    .from("instances")
    .select("id, user_id, my_phones, my_lids, connected_phone")
    .eq("waclaw_session_id", event.waclaw_session_id)
    .maybeSingle();
  if (!instance) {
    return Response.json({ status: "skipped", reason: "session not bound" });
  }

  // 4. Idempotência — pula duplicata
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("instance_id", instance.id)
    .eq("message_id", event.message_id)
    .maybeSingle();
  if (existing) {
    return Response.json({ status: "skipped", reason: "duplicate" });
  }

  // 5. Carregar grupo (se aplicável) + config + footer do user em paralelo
  const [{ data: groups }, { data: config }, { data: userSettings }] = await Promise.all([
    event.is_group
      ? supabase.from("instance_groups").select("*")
          .eq("instance_id", instance.id).eq("group_id", event.chat_jid)
      : Promise.resolve({ data: [] }),
    supabase.from("platform_config").select("*").eq("id", 1).single(),
    supabase.from("user_settings").select("transcription_footer")
      .eq("user_id", instance.user_id).single(),
  ]);

  // 6. Filtro (função pura em lib/filter.ts)
  const decision = filterMessage({ event, instance, group: groups?.[0] ?? null });

  if (decision.action === "skip") {
    // Grava o áudio como recebido mesmo assim, pro chat UI mostrar
    await supabase.from("messages").insert({
      instance_id: instance.id,
      message_id: event.message_id,
      chat_jid: event.chat_jid,
      sender: event.sender_name ?? event.sender_phone,
      type: "audio",
      from_me: event.from_me,
      media_url: event.audio_url,
      status: "received",
      timestamp: event.timestamp,
    });
    return Response.json({ status: "skipped", reason: decision.reason });
  }

  // 7. Whisper
  let transcribedText: string;
  try {
    const audioRes = await fetch(event.audio_url);
    const audioBuffer = await audioRes.arrayBuffer();
    transcribedText = await transcribeAudio(audioBuffer, {
      model: config.neura_model,
      prompt: config.neura_prompt,
      temperature: config.neura_temperature,
    });
  } catch (err) {
    await supabase.from("messages").insert({
      instance_id: instance.id,
      message_id: event.message_id,
      chat_jid: event.chat_jid,
      sender: event.sender_name ?? event.sender_phone,
      type: "audio",
      from_me: event.from_me,
      media_url: event.audio_url,
      status: "transcription_failed",
      timestamp: event.timestamp,
    });
    return Response.json({ status: "failed", reason: String(err) }, { status: 500 });
  }

  // 8. Persist message + transcription
  const { data: messageRow } = await supabase
    .from("messages")
    .insert({
      instance_id: instance.id,
      message_id: event.message_id,
      chat_jid: event.chat_jid,
      sender: event.sender_name ?? event.sender_phone,
      text: transcribedText,
      type: "audio",
      from_me: event.from_me,
      media_url: event.audio_url,
      status: "received",
      timestamp: event.timestamp,
    })
    .select("id")
    .single();

  await supabase.from("transcriptions").insert({
    message_id: messageRow!.id,
    instance_id: instance.id,
    text: transcribedText,
    duration_ms: event.audio_duration_seconds * 1000,
  });

  // 9. Reply no WhatsApp se a decisão mandou
  if (decision.sendReply) {
    const footer = userSettings?.transcription_footer ?? "Transcrição por IA 😜";
    const replyText = formatReply(transcribedText, footer);
    try {
      const waclaw = buildWaclawClient();
      await waclaw.sendMessage({
        sessionId: event.waclaw_session_id,
        chatJid: event.chat_jid,
        text: replyText,
        replyToMessageId: event.message_id,
      });
    } catch (err) {
      console.error("Failed to send reply:", err);
      // Falha no reply não é fatal — transcrição já está salva.
    }
  }

  return Response.json({ status: "transcribed" });
}
```

### `lib/filter.ts` — função pura testável

```ts
import type { OnAudioEvent } from "zapi-shared";

interface Instance { my_phones: string[]; my_lids: string[]; connected_phone: string | null }
interface Group { transcribe_all: boolean; send_reply: boolean }

export type FilterDecision =
  | { action: "skip"; reason: string }
  | { action: "process"; sendReply: boolean };

export function filterMessage(input: {
  event: OnAudioEvent;
  instance: Instance;
  group: Group | null;
}): FilterDecision {
  const { event, instance, group } = input;

  // Eco próprio — pula
  if (
    event.sender_phone === instance.connected_phone ||
    instance.my_phones.includes(event.sender_phone) ||
    instance.my_lids.includes(event.chat_jid)
  ) {
    return { action: "skip", reason: "self" };
  }

  if (!event.is_group) {
    // DM — sempre transcreve, sempre reply
    return { action: "process", sendReply: true };
  }

  // Grupo sem autorização
  if (!group) {
    return { action: "skip", reason: "group not authorized" };
  }

  // fromMe em grupo autorizado — transcreve, reply pela config
  if (event.from_me) {
    return { action: "process", sendReply: group.send_reply };
  }

  // Grupo autorizado mas transcribe_all=false — pula
  if (!group.transcribe_all) {
    return { action: "skip", reason: "transcribe_all disabled" };
  }

  // Grupo autorizado com transcribe_all=true
  return { action: "process", sendReply: group.send_reply };
}
```

Cobertura de testes em `packages/pwa/src/lib/__tests__/filter.test.ts`: eco próprio, DM, grupo não autorizado, grupo fromMe, grupo transcribe_all true/false, reply on/off.

### `lib/footer.ts`

```ts
export function formatReply(transcribedText: string, footer: string): string {
  return `${transcribedText}\n\n${footer}`;
}
```

### `lib/waclaw.ts` — client waclaw

Wrapper pro endpoint do worker5. Métodos: `createSession`, `getQR(sessionId)`, `getStatus(sessionId)`, `sendMessage({sessionId, chatJid, text, replyToMessageId})`, `fetchGroups(sessionId)`, `deleteSession(sessionId)`. Usa `WACLAW_URL` e `WACLAW_API_KEY` do env.

## Daemon em `packages/daemon`

### Responsabilidade única

Escutar eventos de todas as sessões waclaw ativas no worker5 e, **quando a mensagem é áudio**, encaminhar pro `/api/internal/on-audio`. Nada mais.

**Ignora**: texto, imagem, vídeo, documento — chat UI lê essas direto do waclaw via proxy.

**Não acessa**: Supabase, OpenAI, waclaw send-message. Tudo passa pelo Next.

### Arquivos

```
packages/daemon/src/
├── index.ts            # bootstrap, signal handlers
├── waclaw-client.ts    # connectAndSubscribe, reconnect com backoff
├── forwarder.ts        # POST pro Next com retry/backoff
└── logger.ts           # JSON structured logs (console → systemd journal)
```

**`index.ts`** — main loop:

```ts
import { connectAndSubscribe } from "./waclaw-client";
import { forwardAudioEvent } from "./forwarder";
import { log } from "./logger";

async function main() {
  log.info("daemon starting");
  await connectAndSubscribe({
    waclawUrl: process.env.WACLAW_URL!,
    apiKey: process.env.WACLAW_API_KEY!,
    onAudioMessage: async (event) => {
      try {
        const result = await forwardAudioEvent(event);
        log.info("forwarded", { msg: event.message_id, status: result.status });
      } catch (err) {
        log.error("forward failed permanently", { msg: event.message_id, err });
      }
    },
    onError: (err) => log.error("waclaw subscription error", { err }),
  });
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
main().catch((err) => { log.error("fatal", { err }); process.exit(1); });
```

**`waclaw-client.ts`** — contra interface SSE (TODO: validar protocolo real no dia 1):

Reconexão com backoff expo (1s → 30s max). Extrai `OnAudioEvent` de cada evento; descarta não-áudio; descarta áudio > `MAX_AUDIO_BYTES`. Fire-and-forget pra `onAudioMessage` (não bloqueia loop).

**`forwarder.ts`** — POST `${ZAPI_PWA_URL}/api/internal/on-audio` com header `INTERNAL_HEADER_SECRET`, até `DAEMON_FORWARD_MAX_RETRIES` tentativas com backoff `DAEMON_FORWARD_BACKOFF_MS`. 4xx = permanente (não retry). 5xx ou network = retry.

**`logger.ts`** — console.log/warn/error em JSON linha-a-linha.

### systemd unit

```ini
[Unit]
Description=zapi-pwa transcribe daemon (waclaw → Next forwarder)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/zapi-pwa/packages/daemon
Environment="PATH=/home/openclaw/.local/share/fnm/node-versions/v24.14.0/installation/bin:/home/openclaw/.local/bin:/usr/local/bin:/usr/bin"
EnvironmentFile=/home/openclaw/zapi-pwa/packages/daemon/.env
ExecStart=/home/openclaw/.local/bin/bun run src/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### `.env` do daemon (worker5, fora do git)

```
WACLAW_URL=http://localhost:3100
WACLAW_API_KEY=<real>
ZAPI_PWA_URL=https://zapi-pwa.vercel.app
INTERNAL_WEBHOOK_SECRET=<mesmo valor do env da Vercel>
```

### Deploy script

```bash
#!/usr/bin/env bash
# scripts/deploy-daemon.sh
set -euo pipefail
WORKER="openclaw@100.66.83.22"
REMOTE_DIR="/home/openclaw/zapi-pwa"
ssh "$WORKER" "cd $REMOTE_DIR && git pull origin main && bun install"
ssh "$WORKER" "sudo systemctl restart zapi-pwa-daemon"
ssh "$WORKER" "systemctl status zapi-pwa-daemon --no-pager"
```

### Bootstrap inicial no worker5 (uma vez)

```bash
ssh openclaw@100.66.83.22
cd ~ && git clone https://github.com/andrefogelman/zapi-pwa.git
cd zapi-pwa && bun install
cp packages/daemon/systemd/zapi-pwa-daemon.service /etc/systemd/system/
# editar /home/openclaw/zapi-pwa/packages/daemon/.env
sudo systemctl daemon-reload
sudo systemctl enable --now zapi-pwa-daemon
```

## Frontend em `packages/pwa`

### Middleware

Estende `src/middleware.ts` pra:
1. Proteger `/admin/*` — precisa ser `super_admin` ativo (check via query em `user_settings`).
2. Bloquear `/app/*` pra users com `status='disabled'`.
3. Não proteger `/api/internal/*` (daemon autentica via header).

### `/admin/*`

```
src/app/admin/
├── layout.tsx    # shell lateral (Dashboard | Usuários | Neura | Voltar ao chat)
├── page.tsx      # dashboard: 4 cards de stats
├── users/page.tsx    # tabela + ações (invite, reset, promote, disable, delete)
└── neura/page.tsx    # form do platform_config
```

**`admin/users/page.tsx`** state:
```
users, invitingEmail, loading, confirmingDelete
```

UI: form de convite no topo, tabela com todas as ações por linha. Ações que afetam o próprio caller ficam desabilitadas (self-demote, self-disable, self-delete).

**`admin/neura/page.tsx`**: form com textarea (prompt), select (model), dois sliders (temperature, top_p). Copy-paste visual da aba Neura do transcriber, backend diferente.

### `SettingsModal` estendido

Novas abas no modal existente (`src/app/app/components/SettingsModal.tsx`):

1. **Perfil** — `display_name`, `transcription_footer` (com preview ao lado: `{texto exemplo}\n\n{footer}`).
2. **Instâncias** — lista, "Adicionar nova linha" (abre `QRConnectWizard`), remover.
3. **Grupos** — depende da `activeInstanceId` do `InstanceTabs`. Botão "Buscar grupos do WhatsApp". Tabela com checkboxes `transcribe_all`, `send_reply`, `monitor_daily`.
4. Footer do modal: se `userSettings.role === 'super_admin'`, link "⚙️ Configuração da plataforma → /admin".

### `QRConnectWizard` (componente novo, reusável)

Steps: `name` → `qr` → `connecting` → `connected` → `error`.

Usa `POST /api/instances`, `GET /api/instances/[id]/qr`, polling de `GET /api/instances/[id]/status` a cada 2s. Renderiza QR via `react-qr-code` (SVG do string) ou `<img>` (se waclaw devolver PNG base64). Endpoint normaliza ambos via `{ qr: string, format: "string" | "png_base64" }`.

Usado em **dois lugares**:
1. `/app/page.tsx` quando `instances.length === 0` (first-run fullscreen).
2. `SettingsModal > Instâncias > Adicionar nova linha` (modal).

### Sidebar

Ajuste em `Sidebar.tsx`: link `⚙️ Admin` no rodapé se `userSettings.role === 'super_admin'`. Check via novo hook `useUserSettings` que faz `GET /api/user-settings` na montagem.

## Env vars

**Vercel + `.env.local`:**
```
INTERNAL_WEBHOOK_SECRET=<random 32 bytes hex>
WACLAW_URL=http://100.66.83.22:3100
WACLAW_API_KEY=<existente>
SUPABASE_SERVICE_ROLE_KEY=<existente>
SUPABASE_URL=<existente>
NEXT_PUBLIC_SUPABASE_URL=<existente>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<existente>
OPENAI_API_KEY=<existente>
```

**Worker5 daemon `.env`:**
```
WACLAW_URL=http://localhost:3100
WACLAW_API_KEY=<real>
ZAPI_PWA_URL=https://zapi-pwa.vercel.app
INTERNAL_WEBHOOK_SECRET=<mesmo valor da Vercel>
```

## Ordem de implementação sugerida

1. **Fase 0 — Monorepo refactor** (commit único, zero mudança lógica)
   - Criar `package.json` raiz com workspaces
   - `git mv` de tudo pra `packages/pwa/`
   - Criar `packages/shared/` vazio com `package.json` + `tsconfig.json`
   - Criar `packages/daemon/` vazio
   - Atualizar Vercel dashboard `rootDirectory = packages/pwa`
   - Deploy preview pra validar build
   - Deploy produção

2. **Fase 1 — Shared + data model**
   - Preencher `packages/shared/src/` com `constants.ts` e `validators/events.ts`
   - Escrever `supabase/migrations/00003_admin_multitenant.sql`
   - `supabase db push` contra DB de staging primeiro, depois produção
   - Verificar promoção do `andre@anf.com.br` funcionou

3. **Fase 2 — Rotas backend (sem daemon ainda)**
   - `lib/admin-auth.ts`, `lib/filter.ts`, `lib/footer.ts`, `lib/waclaw.ts`
   - Rotas `/api/admin/*`, `/api/user-settings`, `/api/instances/[id]/qr`, `/api/instances/[id]/status`, `/api/instances/[id]/groups/*`
   - Rota `/api/internal/on-audio` (ainda sem daemon pra bater nela — testa com curl manual)
   - Testes unitários de `filterMessage`

4. **Fase 3 — Frontend**
   - Middleware estendido
   - `/admin/layout.tsx`, `/admin/page.tsx`, `/admin/users/page.tsx`, `/admin/neura/page.tsx`
   - `QRConnectWizard` componente
   - `SettingsModal` com abas novas (Perfil, Instâncias, Grupos)
   - First-run wizard em `/app/page.tsx`
   - Link Admin na Sidebar
   - Safety net upsert em `/app/layout.tsx`

5. **Fase 4 — Daemon**
   - Validar protocolo real de eventos do waclaw (curl worker5:3100/events)
   - Ajustar `waclaw-client.ts` pro protocolo confirmado
   - Implementar `forwarder.ts`, `index.ts`, `logger.ts`
   - Deploy manual inicial no worker5 (clone, systemd unit, enable)
   - Criar `scripts/deploy-daemon.sh` pra futuros deploys

6. **Fase 5 — Smoke test end-to-end**
   - Convidar usuário-teste
   - Aceitar convite, cair no `/app`, ver first-run
   - Criar instância, escanear QR com celular real
   - Entrar num grupo, autorizar o grupo no SettingsModal
   - Enviar áudio → verificar que transcreveu → verificar que respondeu no chat com rodapé correto
   - Enviar DM → verificar transcrição + reply
   - Enviar áudio em grupo NÃO autorizado → verificar que NÃO transcreve
   - Teste `transcribe_all=false` (só fromMe)
   - Teste admin: promover, desabilitar, deletar

## Riscos e TODOs conhecidos

1. **Protocolo de eventos do waclaw é TODO.** O daemon está escrito contra hipótese SSE. Validar com `curl http://100.66.83.22:3100/events` no dia 1. Se for WebSocket: edit de 15 min em `waclaw-client.ts`. Se waclaw não expuser eventos globais: plano B é polling `/sessions` + `/sessions/:id/messages?since=cursor` a cada 30s.

2. **Downtime do daemon = áudios perdidos.** Sem persistência de cursor no disco local. Pro MVP é aceitável; chat UI ainda mostra áudio bruto via waclaw direto. Evolução futura: gravar `last_processed_message_id` em `/var/lib/zapi-pwa-daemon/cursor.json` e reconsumir `since=cursor` ao startar.

3. **Sem métricas/health.** systemd journal é a única observabilidade. Suficiente pra MVP.

4. **Sem mTLS entre daemon e Vercel.** Auth é shared secret no header. OK pra MVP (secret random 32 bytes).

5. **Singleton `platform_config` não versionado.** Mudar prompt Neura hoje sobrescreve histórico. Se precisar auditoria/rollback no futuro, adicionar `platform_config_history` numa migration separada.

6. **Vercel cold start + Whisper latency.** Cada áudio = 1 HTTP worker5→Vercel + 1 Whisper (2-10s). Cold start ~500ms é ruído. Pra volume alto (>100/dia) considerar Vercel Pro pra evitar frio.

7. **Migração Z-API legado.** Código Z-API fica intocado. Se daqui a 1 mês ninguém bater em `/api/webhook`, uma migration separada pode dropar as colunas `zapi_instance_id`, `zapi_token`, `zapi_client_token`, `session_token`, `provider` e apagar `src/lib/zapi.ts`. Fora do escopo desse spec.

8. **Trigger `handle_new_user` fail-fast.** Se o INSERT em `user_settings` falhar por qualquer motivo (constraint bug, por exemplo), o signup do Supabase falha. É o comportamento correto — evita órfãos — mas significa que bugs no trigger bloqueiam logins novos. Testar bem o trigger com migrations contra staging antes de produção.

## Como usar esse spec

Essa seção explica ao leitor humano ou ao próximo agente como consumir o documento.

1. Ler o spec inteiro.
2. Confirmar as decisões em "Decisões-chave tomadas no brainstorming" com o usuário se o contexto estiver obscuro.
3. Passar pro skill `writing-plans` que vai quebrar em tarefas executáveis.
4. Cada fase da "Ordem de implementação sugerida" vira um grupo de tarefas.
5. As rotas listadas nas tabelas são a checklist de backend.
6. O data model SQL é literal — copiar pra migration sem reinterpretar.

## Referências no repo atual

- Middleware: `src/middleware.ts` (existente, estender)
- Supabase server client: `src/lib/supabase-server.ts` (existente, adicionar `getSupabaseServiceRole`)
- OpenAI client: `src/lib/openai.ts` (existente, estender `transcribeAudio` pra aceitar config)
- Chat UI: `src/app/app/page.tsx` + `src/app/app/components/*` (existente)
- Z-API legado: `src/app/api/webhook/route.ts`, `src/app/api/instances/qr/route.ts`, `src/lib/zapi.ts` (não tocar)
- Transcriber como referência: `/Users/andrefogelman/zapi-transcriber/src/app/admin/page.tsx`, `src/lib/filters.ts`, `src/lib/config.ts`, `src/lib/neura-prompt.ts`, `src/app/api/groups/fetch/route.ts`
