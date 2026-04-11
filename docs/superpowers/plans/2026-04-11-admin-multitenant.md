# Admin Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin UI for multi-tenant management of zapi-pwa, migrate repo to a bun workspace monorepo, add per-user/per-instance transcription config, and add a daemon on worker5 that auto-transcribes WhatsApp audio via a thin webhook to Next.

**Architecture:** Monorepo with three packages — `shared` (pure types + validators), `pwa` (Next.js on Vercel), `daemon` (Node service on worker5). Business logic lives in `pwa`. Daemon subscribes to waclaw events and forwards audio-only messages to `POST /api/internal/on-audio`. Auth via Supabase with `user_settings.role` column for super-admin. Z-API legacy code stays intact but invisible.

**Tech Stack:** Next.js (current version, read `node_modules/next/dist/docs/` before writing), TypeScript strict, Bun workspaces, Supabase Postgres + Auth + RLS, OpenAI Whisper (`gpt-4o`), waclaw (self-hosted on worker5 `100.66.83.22:3100`), Vercel, systemd on worker5.

**Spec:** `/Users/andrefogelman/zapi-pwa/docs/superpowers/specs/2026-04-11-admin-multitenant-design.md` — refer to it for architectural background. This plan is self-contained; the spec is only for reference if context is unclear.

**Pre-work:** Confirm the value of `andre@anf.com.br` (the super-admin email hardcoded in the migration trigger and seed) is correct. Pick and write down `INTERNAL_WEBHOOK_SECRET` now (`openssl rand -hex 32`) — you'll paste it in multiple places.

---

## Phase 0 — Monorepo Refactor

**Objective:** Convert the flat repo into a bun workspace with `packages/pwa/`, `packages/shared/`, `packages/daemon/`. Zero logic change in this phase — everything that works now must still work after.

### Task 0.1: Create the root workspace `package.json`

**Files:**
- Create: `package.json` (new root file — current `package.json` will move to `packages/pwa/` in Task 0.3)
- Note: the existing `package.json` is at the repo root. We're renaming by moving, not overwriting.

- [ ] **Step 1: Read the current root package.json to capture deps**

Run: read `/Users/andrefogelman/zapi-pwa/package.json` — note `dependencies`, `devDependencies`, `scripts`. Do NOT edit yet.

- [ ] **Step 2: Create a temporary workspace root file at `/tmp/workspace-package.json`**

Content:
```json
{
  "name": "zapi-pwa-monorepo",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun --filter pwa dev",
    "build": "bun --filter pwa build",
    "lint": "bun --filter pwa lint",
    "typecheck": "bun --filter pwa typecheck"
  }
}
```

- [ ] **Step 3: Commit checkpoint before the move**

```bash
cd /Users/andrefogelman/zapi-pwa
git status  # must be clean. If not, stash or commit unrelated work first.
```

Do NOT apply the temporary file yet. The actual placement happens in Task 0.3 after the git mv.

### Task 0.2: Create `tsconfig.base.json` at repo root

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create the file with shared compiler options**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 2: Do NOT commit yet — commit in Task 0.6 along with the structural move.**

### Task 0.3: Move existing Next.js code into `packages/pwa/`

**Files:**
- Move: everything currently at `/Users/andrefogelman/zapi-pwa/{src,public,supabase,next.config.ts,next-env.d.ts,tsconfig.json,tsconfig.tsbuildinfo,vercel.json,package.json,bun.lock,package-lock.json,.env.local,.env.production}` → `packages/pwa/`
- Keep at root: `docs/`, `scripts/`, `.git/`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `.vercel/`, `node_modules/`

- [ ] **Step 1: Create the destination directory**

```bash
cd /Users/andrefogelman/zapi-pwa
mkdir -p packages/pwa
```

- [ ] **Step 2: Move source and config files with `git mv` to preserve history**

```bash
git mv src packages/pwa/src
git mv public packages/pwa/public
git mv next.config.ts packages/pwa/next.config.ts
git mv next-env.d.ts packages/pwa/next-env.d.ts
git mv tsconfig.json packages/pwa/tsconfig.json
git mv vercel.json packages/pwa/vercel.json
git mv package.json packages/pwa/package.json
```

- [ ] **Step 3: Move the lockfile and env files (not tracked but need to move physically)**

```bash
mv bun.lock packages/pwa/bun.lock 2>/dev/null || true
mv package-lock.json packages/pwa/package-lock.json 2>/dev/null || true
mv .env.local packages/pwa/.env.local 2>/dev/null || true
mv .env.production packages/pwa/.env.production 2>/dev/null || true
mv tsconfig.tsbuildinfo packages/pwa/tsconfig.tsbuildinfo 2>/dev/null || true
rm -rf .next 2>/dev/null || true  # build artifact, safe to drop; Next regenerates
```

**Note on `supabase/`**: the spec says `supabase/migrations/` stays at repo root (shared across packages conceptually). Do NOT move `supabase/`. Confirm it still exists at `/Users/andrefogelman/zapi-pwa/supabase/`.

- [ ] **Step 4: Verify the move**

```bash
ls -la packages/pwa/
# Expected: src/, public/, next.config.ts, package.json, tsconfig.json, vercel.json, etc.
ls -la
# Expected at root: packages/, supabase/, docs/, scripts/, .git/, AGENTS.md, etc.
```

### Task 0.4: Update `packages/pwa/tsconfig.json` to extend base

**Files:**
- Modify: `packages/pwa/tsconfig.json`

- [ ] **Step 1: Read current contents**

Run: read `/Users/andrefogelman/zapi-pwa/packages/pwa/tsconfig.json`

- [ ] **Step 2: Change the top of the file to extend the base**

The file currently has its own `compilerOptions`. Replace with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Remove any duplicate compilerOptions that are now in `tsconfig.base.json` (`strict`, `target`, `esModuleInterop`, etc.). Keep Next-specific ones (`plugins`, `paths`, `jsx`, `allowJs`, `noEmit`).

### Task 0.5: Update `packages/pwa/package.json` name field

**Files:**
- Modify: `packages/pwa/package.json`

- [ ] **Step 1: Change the `name` field to `"pwa"`**

This lets `bun --filter pwa <cmd>` target it from root.

```json
{
  "name": "pwa",
  ...
}
```

Keep all dependencies and scripts unchanged. Do NOT remove anything else.

### Task 0.6: Create the root `package.json`, skeleton shared and daemon packages

**Files:**
- Create: `package.json` (root)
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/daemon/package.json`
- Create: `packages/daemon/tsconfig.json`
- Create: `packages/daemon/src/index.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "zapi-pwa-monorepo",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun --filter pwa dev",
    "build": "bun --filter pwa build",
    "lint": "bun --filter pwa lint",
    "typecheck": "bun --filter pwa typecheck",
    "test:shared": "bun --filter zapi-shared test",
    "test:pwa": "bun --filter pwa test"
  }
}
```

- [ ] **Step 2: Create `packages/shared/package.json`**

```json
{
  "name": "zapi-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `packages/shared/src/index.ts` as empty placeholder**

```ts
// Populated in Phase 1.
export {};
```

- [ ] **Step 5: Create `packages/daemon/package.json`**

```json
{
  "name": "zapi-pwa-daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun run --watch src/index.ts"
  },
  "dependencies": {
    "zapi-shared": "workspace:*",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 6: Create `packages/daemon/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 7: Create `packages/daemon/src/index.ts` as empty placeholder**

```ts
// Populated in Phase 5.
console.log("daemon placeholder");
```

- [ ] **Step 8: Update root `.gitignore`** — add monorepo-specific patterns. Read current contents and append:

```
# Monorepo workspace artifacts
packages/*/node_modules
packages/*/.next
packages/*/dist
packages/*/.turbo
packages/*/tsconfig.tsbuildinfo

# Daemon secrets
packages/daemon/.env
```

Keep all existing entries.

### Task 0.7: Add `zapi-shared` as a dependency in `packages/pwa/package.json`

**Files:**
- Modify: `packages/pwa/package.json`

- [ ] **Step 1: Add the workspace dependency**

In the `dependencies` section (not devDependencies), add:

```json
"zapi-shared": "workspace:*"
```

- [ ] **Step 2: Ensure `zod` is in `dependencies`. If not, add it.**

```json
"zod": "^3.23.0"
```

### Task 0.8: Install and verify the workspace

- [ ] **Step 1: Run bun install from root**

```bash
cd /Users/andrefogelman/zapi-pwa
rm -rf node_modules packages/*/node_modules  # clean stale
bun install
```

Expected: installs complete without error. Check that `packages/pwa/node_modules/zapi-shared` exists as a symlink to `../../shared`.

- [ ] **Step 2: Run the existing Next build from root**

```bash
bun run build
```

Expected: Next compiles and produces `packages/pwa/.next/`. Zero new errors compared to pre-refactor. If errors about missing `@/...` imports, fix `packages/pwa/tsconfig.json` paths — should resolve from inside `packages/pwa/`.

- [ ] **Step 3: Run dev server briefly to sanity-check**

```bash
bun run dev &
sleep 5
curl -s http://localhost:3000/ -o /dev/null -w "%{http_code}\n"
kill %1 2>/dev/null || true
```

Expected: 200 or 307 redirect. If 500, investigate imports.

### Task 0.9: Commit the monorepo refactor

- [ ] **Step 1: Stage and commit**

```bash
cd /Users/andrefogelman/zapi-pwa
git add -A
git status  # sanity check — no unexpected deletions
git commit -m "$(cat <<'EOF'
refactor: restructure as bun workspace monorepo

Move Next.js app into packages/pwa/. Create empty skeletons for
packages/shared/ and packages/daemon/. Add root workspace package.json
and shared tsconfig.base.json. Zero logic changes; git mv preserves
history.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 0.10: Update Vercel project configuration

**No code changes — manual dashboard edit.**

- [ ] **Step 1: Open Vercel dashboard for the zapi-pwa project**

Navigate to Settings → General → Build & Development Settings.

- [ ] **Step 2: Set Root Directory**

Change "Root Directory" from (blank or `./`) to `packages/pwa`. Save.

- [ ] **Step 3: Set Install Command override**

Override "Install Command" to: `cd ../.. && bun install`

This makes Vercel install at the workspace root, letting `zapi-shared` resolve via symlink.

- [ ] **Step 4: Leave Build Command as default**

Default (`bun run build`) runs inside the configured root directory.

- [ ] **Step 5: Deploy a preview**

```bash
cd /Users/andrefogelman/zapi-pwa
git push origin main
```

Watch Vercel dashboard for the deploy. If it fails on install, adjust the install command. If it fails on build, check path aliases in `packages/pwa/tsconfig.json`.

- [ ] **Step 6: Smoke test the preview**

Open the preview URL, confirm `/login` loads and an authenticated user can reach `/app`. No new errors in browser console or Vercel logs.

---

## Phase 1 — Shared package and data model

### Task 1.1: Write `packages/shared/src/constants.ts`

**Files:**
- Create: `packages/shared/src/constants.ts`

- [ ] **Step 1: Create the file**

```ts
/**
 * Header name that the daemon uses to authenticate with /api/internal/on-audio.
 * Both sides import from here to avoid typo drift.
 */
export const INTERNAL_HEADER_SECRET = "X-Zapi-Internal-Secret";

/**
 * Optional header for daemon identification (future: mTLS, multiple daemons).
 */
export const INTERNAL_HEADER_DAEMON_ID = "X-Zapi-Daemon-Id";

/**
 * Maximum audio payload size. Above this, daemon skips without forwarding.
 * Whisper's documented limit is 25 MB.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Number of retry attempts in the daemon's forwarder. */
export const DAEMON_FORWARD_MAX_RETRIES = 3;

/** Backoff delays in ms between retries. Length must be >= DAEMON_FORWARD_MAX_RETRIES. */
export const DAEMON_FORWARD_BACKOFF_MS = [1000, 3000, 10000] as const;
```

- [ ] **Step 2: Verify the file compiles standalone**

```bash
cd /Users/andrefogelman/zapi-pwa/packages/shared
bunx tsc --noEmit
```

Expected: no errors.

### Task 1.2: Write `packages/shared/src/validators/events.ts` with tests

**Files:**
- Create: `packages/shared/src/validators/events.ts`
- Create: `packages/shared/src/validators/events.test.ts`

- [ ] **Step 1: Write the failing test first (TDD)**

Create `packages/shared/src/validators/events.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { OnAudioEventSchema, OnAudioResponseSchema } from "./events";

describe("OnAudioEventSchema", () => {
  const validEvent = {
    waclaw_session_id: "sess-abc",
    message_id: "msg-123",
    chat_jid: "5511999999999@s.whatsapp.net",
    chat_name: "John Doe",
    sender_phone: "5511988888888",
    sender_name: "Jane",
    from_me: false,
    is_group: false,
    audio_url: "https://worker5/audio/abc.ogg",
    audio_duration_seconds: 5,
    timestamp: "2026-04-11T12:00:00.000Z",
  };

  test("accepts a valid event", () => {
    const result = OnAudioEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  test("accepts sender_name null", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, sender_name: null });
    expect(result.success).toBe(true);
  });

  test("rejects empty waclaw_session_id", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, waclaw_session_id: "" });
    expect(result.success).toBe(false);
  });

  test("rejects invalid audio_url", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, audio_url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  test("rejects negative duration", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, audio_duration_seconds: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects non-ISO timestamp", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, timestamp: "yesterday" });
    expect(result.success).toBe(false);
  });
});

describe("OnAudioResponseSchema", () => {
  test("accepts queued status", () => {
    const r = OnAudioResponseSchema.safeParse({ status: "queued" });
    expect(r.success).toBe(true);
  });

  test("accepts failed with reason", () => {
    const r = OnAudioResponseSchema.safeParse({ status: "failed", reason: "timeout" });
    expect(r.success).toBe(true);
  });

  test("rejects invalid status", () => {
    const r = OnAudioResponseSchema.safeParse({ status: "bogus" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure (file events.ts doesn't exist)**

```bash
cd /Users/andrefogelman/zapi-pwa/packages/shared
bun test src/validators/events.test.ts
```

Expected: FAIL — cannot find module `./events`.

- [ ] **Step 3: Implement `packages/shared/src/validators/events.ts`**

```ts
import { z } from "zod";

/**
 * The event the daemon forwards to the Next /api/internal/on-audio route.
 * Single source of truth — type is inferred from the schema below.
 */
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

/** Response the Next route returns to the daemon. Used only for logs. */
export const OnAudioResponseSchema = z.object({
  status: z.enum(["queued", "skipped", "transcribed", "failed"]),
  reason: z.string().optional(),
});

export type OnAudioResponse = z.infer<typeof OnAudioResponseSchema>;
```

- [ ] **Step 4: Run the test again, expect pass**

```bash
bun test src/validators/events.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Update `packages/shared/src/index.ts` to re-export**

```ts
export * from "./constants";
export * from "./validators/events";
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add constants and OnAudioEvent validators"
```

### Task 1.3: Write the Supabase migration `00003_admin_multitenant.sql`

**Files:**
- Create: `supabase/migrations/00003_admin_multitenant.sql`

- [ ] **Step 1: Create the migration file with the full SQL**

```sql
-- ============================================================
-- Migration 00003: Admin multi-tenant
-- Adds user_settings, platform_config, instance_groups, and
-- supporting functions/triggers for role-based access control.
-- ============================================================

-- ------------------------------------------------------------
-- user_settings: per-user profile, role, footer
-- ------------------------------------------------------------
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

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- platform_config: singleton Neura config. PK=1 + CHECK = only
-- one row can ever exist. No tricks.
-- ------------------------------------------------------------
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

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- instance_groups: authorized groups per instance with flags
-- ------------------------------------------------------------
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

ALTER TABLE public.instance_groups ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- instances: add my_phones / my_lids for DM echo filter
-- ------------------------------------------------------------
ALTER TABLE public.instances
  ADD COLUMN my_phones TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN my_lids TEXT[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- is_super_admin(): used in RLS policies
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- protect_user_settings_sensitive(): trigger that prevents
-- role/status updates unless an admin RPC set the bypass flag.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_user_settings_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF COALESCE(current_setting('zapi.admin_bypass', true), '') = 'yes' THEN
    RETURN NEW;
  END IF;
  NEW.role := OLD.role;
  NEW.status := OLD.status;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_user_settings_sensitive
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_settings_sensitive();

-- ------------------------------------------------------------
-- admin_update_user_role(): SECURITY DEFINER function used by
-- /api/admin/users/[id]/role via supabase.rpc(). Validates the
-- caller, bumps the bypass flag, then updates.
-- ------------------------------------------------------------
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

  PERFORM set_config('zapi.admin_bypass', 'yes', true);

  UPDATE public.user_settings
  SET role = new_role, updated_at = now()
  WHERE user_id = target_user_id;
END;
$$;

-- ------------------------------------------------------------
-- admin_update_user_status(): mirror for disable/enable
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- handle_new_user(): trigger that creates user_settings on
-- auth.users INSERT. Also auto-promotes hardcoded super-admin(s).
-- ------------------------------------------------------------
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- RLS policies
-- ------------------------------------------------------------

-- user_settings
CREATE POLICY "Read own or all if admin"
  ON public.user_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "Update own row"
  ON public.user_settings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

-- platform_config
CREATE POLICY "Everyone authenticated reads platform_config"
  ON public.platform_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Only super-admin updates platform_config"
  ON public.platform_config FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- instance_groups: scoped via owning instance
CREATE POLICY "Users manage groups of own instances"
  ON public.instance_groups FOR ALL TO authenticated
  USING (instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid()))
  WITH CHECK (instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid()));

-- ------------------------------------------------------------
-- Seeds
-- ------------------------------------------------------------

-- 1. platform_config singleton.
-- Prompt literal from zapi-transcriber/src/lib/neura-prompt.ts as of this spec.
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

-- 2. Backfill user_settings for any auth.users already existing.
INSERT INTO public.user_settings (user_id, display_name, transcription_footer)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
  'Transcrição por IA by ' || COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) || ' 😜'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 3. Promote Andre as super-admin (idempotent; trigger handles future signups).
DO $$
BEGIN
  PERFORM set_config('zapi.admin_bypass', 'yes', true);
  UPDATE public.user_settings
  SET role = 'super_admin'
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'andre@anf.com.br');
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00003_admin_multitenant.sql
git commit -m "feat(db): migration 00003 admin multi-tenant (tables, RLS, RPCs, seeds)"
```

### Task 1.4: Apply migration to staging/local database

**No code changes — verification via Supabase CLI.**

- [ ] **Step 1: Verify Supabase CLI is connected to the right project**

```bash
cd /Users/andrefogelman/zapi-pwa
supabase status
```

Confirm the project ref matches the zapi-pwa Supabase project. If wrong, `supabase link --project-ref <ref>`.

- [ ] **Step 2: Push migration (start with a branch if Supabase branching is available)**

```bash
supabase db push --dry-run
# Review the SQL that will be applied. Confirm it's only 00003.
supabase db push
```

Expected: no errors. If error on platform_config CHECK or trigger conflict, fix in the migration and re-run.

- [ ] **Step 3: Verify tables exist**

```bash
supabase db execute "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('user_settings','platform_config','instance_groups')"
```

Expected: 3 rows.

- [ ] **Step 4: Verify Andre was promoted**

```bash
supabase db execute "SELECT u.email, us.role FROM auth.users u JOIN public.user_settings us ON us.user_id = u.id WHERE u.email = 'andre@anf.com.br'"
```

Expected: 1 row with role='super_admin'. If 0 rows and the user doesn't exist yet, that's fine — trigger will promote on first signup.

- [ ] **Step 5: Verify platform_config singleton**

```bash
supabase db execute "SELECT id, neura_model, neura_temperature FROM public.platform_config"
```

Expected: exactly 1 row, id=1, model='gpt-4o', temp=0.5.

---

## Phase 2 — Core libraries in `packages/pwa/src/lib/`

### Task 2.1: Add `getSupabaseServiceRole()` to `supabase-server.ts`

**Files:**
- Modify: `packages/pwa/src/lib/supabase-server.ts`

- [ ] **Step 1: Read current content**

Run: read the file.

- [ ] **Step 2: Add the service role getter**

Append at the bottom of the file:

```ts
import { createClient as createServiceRoleClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS. Never expose to browser code.
 * Use only in server-side routes that have already validated the caller.
 */
export function getSupabaseServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createServiceRoleClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

If `createClient` is already imported from `@supabase/supabase-js` under a different name, reuse that import. Do not duplicate.

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/lib/supabase-server.ts
git commit -m "feat(pwa): add getSupabaseServiceRole helper"
```

### Task 2.2: Create `lib/admin-auth.ts`

**Files:**
- Create: `packages/pwa/src/lib/admin-auth.ts`

- [ ] **Step 1: Create the helper**

```ts
import { getSupabaseServer, getSupabaseServiceRole, getUserFromToken } from "./supabase-server";
import type { User, SupabaseClient } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Validates that the request comes from an active super-admin.
 * Throws HttpError with 401 or 403 otherwise. Returns both the
 * user and a service-role client for subsequent admin operations.
 */
export async function requireSuperAdmin(request: Request): Promise<{
  user: User;
  supabaseAdmin: SupabaseClient;
}> {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) throw new HttpError(401, "unauthorized");

  const user = await getUserFromToken(token);
  if (!user) throw new HttpError(401, "unauthorized");

  const supabase = getSupabaseServer();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("role, status")
    .eq("user_id", user.id)
    .single();

  if (error || !settings) throw new HttpError(403, "forbidden");
  if (settings.role !== "super_admin" || settings.status !== "active") {
    throw new HttpError(403, "forbidden");
  }

  return { user, supabaseAdmin: getSupabaseServiceRole() };
}

/**
 * Helper to convert HttpError into Response in catch blocks.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("unexpected error in admin route:", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/lib/admin-auth.ts
git commit -m "feat(pwa): add requireSuperAdmin helper"
```

### Task 2.3: Create `lib/filter.ts` with TDD

**Files:**
- Create: `packages/pwa/src/lib/filter.ts`
- Create: `packages/pwa/src/lib/__tests__/filter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/pwa/src/lib/__tests__/filter.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { filterMessage } from "../filter";
import type { OnAudioEvent } from "zapi-shared";

const baseEvent: OnAudioEvent = {
  waclaw_session_id: "sess",
  message_id: "msg-1",
  chat_jid: "5511999999999@s.whatsapp.net",
  chat_name: "John",
  sender_phone: "5511988888888",
  sender_name: "Jane",
  from_me: false,
  is_group: false,
  audio_url: "https://worker/a.ogg",
  audio_duration_seconds: 5,
  timestamp: "2026-04-11T12:00:00.000Z",
};

const baseInstance = {
  my_phones: [] as string[],
  my_lids: [] as string[],
  connected_phone: "5511977777777",
};

describe("filterMessage — DMs", () => {
  test("DM from another person → process with reply", () => {
    const r = filterMessage({ event: baseEvent, instance: baseInstance, group: null });
    expect(r).toEqual({ action: "process", sendReply: true });
  });

  test("DM echo from own connected_phone → skip", () => {
    const r = filterMessage({
      event: { ...baseEvent, sender_phone: "5511977777777" },
      instance: baseInstance,
      group: null,
    });
    expect(r).toEqual({ action: "skip", reason: "self" });
  });

  test("DM from a number in my_phones → skip", () => {
    const r = filterMessage({
      event: { ...baseEvent, sender_phone: "5511966666666" },
      instance: { ...baseInstance, my_phones: ["5511966666666"] },
      group: null,
    });
    expect(r).toEqual({ action: "skip", reason: "self" });
  });
});

describe("filterMessage — groups", () => {
  const groupEvent: OnAudioEvent = {
    ...baseEvent,
    is_group: true,
    chat_jid: "120363@g.us",
  };

  test("group not in authorized list → skip", () => {
    const r = filterMessage({ event: groupEvent, instance: baseInstance, group: null });
    expect(r).toEqual({ action: "skip", reason: "group not authorized" });
  });

  test("group authorized, from me → process (reply per group config)", () => {
    const r = filterMessage({
      event: { ...groupEvent, from_me: true },
      instance: baseInstance,
      group: { transcribe_all: false, send_reply: false },
    });
    expect(r).toEqual({ action: "process", sendReply: false });
  });

  test("group authorized, not from me, transcribe_all=false → skip", () => {
    const r = filterMessage({
      event: groupEvent,
      instance: baseInstance,
      group: { transcribe_all: false, send_reply: true },
    });
    expect(r).toEqual({ action: "skip", reason: "transcribe_all disabled" });
  });

  test("group authorized, not from me, transcribe_all=true, send_reply=true → process with reply", () => {
    const r = filterMessage({
      event: groupEvent,
      instance: baseInstance,
      group: { transcribe_all: true, send_reply: true },
    });
    expect(r).toEqual({ action: "process", sendReply: true });
  });

  test("group authorized, transcribe_all=true, send_reply=false → process without reply", () => {
    const r = filterMessage({
      event: groupEvent,
      instance: baseInstance,
      group: { transcribe_all: true, send_reply: false },
    });
    expect(r).toEqual({ action: "process", sendReply: false });
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd /Users/andrefogelman/zapi-pwa
bun test packages/pwa/src/lib/__tests__/filter.test.ts
```

Expected: FAIL — module "../filter" not found.

- [ ] **Step 3: Implement `packages/pwa/src/lib/filter.ts`**

```ts
import type { OnAudioEvent } from "zapi-shared";

export interface FilterInstance {
  my_phones: string[];
  my_lids: string[];
  connected_phone: string | null;
}

export interface FilterGroup {
  transcribe_all: boolean;
  send_reply: boolean;
}

export type FilterDecision =
  | { action: "skip"; reason: string }
  | { action: "process"; sendReply: boolean };

/**
 * Decides whether an incoming audio event should be transcribed
 * and whether the transcription should be sent back to WhatsApp.
 *
 * Rules:
 * - Messages from the instance's own numbers: skip (echo prevention).
 * - DMs (not group): always process, always send reply.
 * - Groups not in authorized list: skip.
 * - Group authorized, from_me=true: process, reply per group setting.
 * - Group authorized, transcribe_all=false, not from_me: skip.
 * - Group authorized, transcribe_all=true: process, reply per group setting.
 */
export function filterMessage(input: {
  event: OnAudioEvent;
  instance: FilterInstance;
  group: FilterGroup | null;
}): FilterDecision {
  const { event, instance, group } = input;

  // Echo prevention
  if (
    event.sender_phone === instance.connected_phone ||
    instance.my_phones.includes(event.sender_phone) ||
    instance.my_lids.includes(event.chat_jid)
  ) {
    return { action: "skip", reason: "self" };
  }

  // DMs: always process, always reply
  if (!event.is_group) {
    return { action: "process", sendReply: true };
  }

  // Groups: must be authorized
  if (!group) {
    return { action: "skip", reason: "group not authorized" };
  }

  // Own audio in authorized group: always process
  if (event.from_me) {
    return { action: "process", sendReply: group.send_reply };
  }

  // Others' audio: only if transcribe_all
  if (!group.transcribe_all) {
    return { action: "skip", reason: "transcribe_all disabled" };
  }

  return { action: "process", sendReply: group.send_reply };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
bun test packages/pwa/src/lib/__tests__/filter.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pwa/src/lib/filter.ts packages/pwa/src/lib/__tests__/filter.test.ts
git commit -m "feat(pwa): filterMessage pure function with full test coverage"
```

### Task 2.4: Create `lib/footer.ts`

**Files:**
- Create: `packages/pwa/src/lib/footer.ts`
- Create: `packages/pwa/src/lib/__tests__/footer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/pwa/src/lib/__tests__/footer.test.ts
import { describe, expect, test } from "bun:test";
import { formatReply } from "../footer";

describe("formatReply", () => {
  test("joins text and footer with two newlines", () => {
    expect(formatReply("olá mundo", "IA 😜")).toBe("olá mundo\n\nIA 😜");
  });

  test("trims trailing whitespace from text", () => {
    expect(formatReply("olá\n", "IA 😜")).toBe("olá\n\nIA 😜");
  });

  test("handles empty footer gracefully", () => {
    expect(formatReply("olá", "")).toBe("olá");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
bun test packages/pwa/src/lib/__tests__/footer.test.ts
```

- [ ] **Step 3: Implement `packages/pwa/src/lib/footer.ts`**

```ts
/**
 * Appends the user's customized footer to a transcribed message.
 * Used when the reply is sent back to WhatsApp.
 */
export function formatReply(transcribedText: string, footer: string): string {
  const trimmed = transcribedText.replace(/\s+$/, "");
  if (!footer) return trimmed;
  return `${trimmed}\n\n${footer}`;
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/pwa/src/lib/footer.ts packages/pwa/src/lib/__tests__/footer.test.ts
git commit -m "feat(pwa): formatReply helper with tests"
```

### Task 2.5: Create `lib/waclaw.ts` client wrapper

**Files:**
- Create: `packages/pwa/src/lib/waclaw.ts`

- [ ] **Step 1: Create the client**

```ts
/**
 * Minimal waclaw REST client used by /api/instances/* and /api/internal/on-audio.
 * Works against the self-hosted waclaw service on worker5.
 *
 * Endpoint shapes are based on the hypothesis documented in the spec.
 * Validate with curl on first use and adjust if waclaw's real API differs.
 */

const WACLAW_URL = process.env.WACLAW_URL ?? "http://100.66.83.22:3100";
const WACLAW_API_KEY = process.env.WACLAW_API_KEY ?? "waclaw-dev-key";

function headers(): Record<string, string> {
  return {
    "X-API-Key": WACLAW_API_KEY,
    "Content-Type": "application/json",
  };
}

export interface WaclawSession {
  id: string;
  status: "pending" | "connecting" | "connected" | "disconnected";
  phone?: string;
}

export interface WaclawQR {
  qr: string;
  format: "string" | "png_base64";
}

export interface WaclawGroup {
  group_id: string;
  subject: string;
  subject_owner?: string;
  group_lid?: string;
}

export async function createSession(name: string): Promise<{ id: string }> {
  const res = await fetch(`${WACLAW_URL}/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`waclaw createSession ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getSessionStatus(sessionId: string): Promise<WaclawSession> {
  const res = await fetch(`${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`waclaw getSessionStatus ${res.status}`);
  return res.json();
}

export async function getSessionQR(sessionId: string): Promise<WaclawQR> {
  const res = await fetch(`${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}/qr`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`waclaw getSessionQR ${res.status}`);
  const body = await res.json();
  // Normalize: waclaw may return { qr: "2@..." } or { qr_png_base64: "..." }.
  if (typeof body.qr === "string") {
    return { qr: body.qr, format: "string" };
  }
  if (typeof body.qr_png_base64 === "string") {
    return { qr: body.qr_png_base64, format: "png_base64" };
  }
  throw new Error("waclaw QR response has neither qr nor qr_png_base64");
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`waclaw deleteSession ${res.status}`);
  }
}

export async function fetchSessionGroups(sessionId: string): Promise<WaclawGroup[]> {
  const res = await fetch(`${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}/groups`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`waclaw fetchSessionGroups ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.groups ?? []);
}

export async function sendMessage(params: {
  sessionId: string;
  chatJid: string;
  text: string;
  replyToMessageId?: string;
}): Promise<void> {
  const res = await fetch(
    `${WACLAW_URL}/sessions/${encodeURIComponent(params.sessionId)}/send-message`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        chat_jid: params.chatJid,
        text: params.text,
        reply_to: params.replyToMessageId,
      }),
    }
  );
  if (!res.ok) throw new Error(`waclaw sendMessage ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/lib/waclaw.ts
git commit -m "feat(pwa): waclaw REST client wrapper"
```

**Note:** If any of these endpoints return a 404 or different shape during integration testing in Phase 5, adjust the function body here. The public API (method names and return types) should stay stable.

### Task 2.6: Extend `lib/openai.ts` `transcribeAudio` to accept config

**Files:**
- Modify: `packages/pwa/src/lib/openai.ts`

- [ ] **Step 1: Read current content**

Run: read `packages/pwa/src/lib/openai.ts`. Locate the existing `transcribeAudio` function and note its current signature and how it calls `openai.audio.transcriptions.create`. You'll keep the same export name and file location, only change the signature.

- [ ] **Step 2: Replace the `transcribeAudio` function with this version**

Preserve any other exports in the file (e.g. `getOpenAIClient`). Only replace the `transcribeAudio` function body and signature.
```ts
export interface TranscribeConfig {
  model?: string;         // defaults to gpt-4o-transcribe or whisper-1
  prompt?: string;        // system prompt to bias the model
  temperature?: number;
  language?: string;      // optional ISO 639-1 (e.g. "pt")
}

export async function transcribeAudio(
  audio: ArrayBuffer,
  config: TranscribeConfig = {}
): Promise<string> {
  const client = getOpenAIClient(); // existing helper
  const file = new File([audio], "audio.ogg", { type: "audio/ogg" });

  // Whisper (whisper-1) is the canonical transcription endpoint.
  // gpt-4o-* accepted here lets users opt in if available in their account.
  const model = config.model ?? "whisper-1";

  const response = await client.audio.transcriptions.create({
    file,
    model,
    prompt: config.prompt,
    temperature: config.temperature,
    language: config.language ?? "pt",
  });
  return response.text;
}
```

If the existing function has call sites that pass just the buffer, the optional config keeps them backward-compatible. Do not break existing callers.

- [ ] **Step 3: Run the existing build/typecheck to confirm nothing broke**

```bash
cd /Users/andrefogelman/zapi-pwa
bun run typecheck
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/pwa/src/lib/openai.ts
git commit -m "feat(pwa): transcribeAudio accepts model/prompt/temperature config"
```

---

## Phase 3 — Backend routes

All routes in this phase follow the same pattern:
1. Create the file.
2. Test with `curl` against `bun run dev` locally.
3. Commit.

No TDD for routes — they're integration-heavy and easier to validate with curl. `filterMessage` and `formatReply` are already tested.

### Task 3.1: `/api/user-settings` — GET and PATCH

**Files:**
- Create: `packages/pwa/src/app/api/user-settings/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

async function auth(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  return getUserFromToken(token);
}

export async function GET(request: Request) {
  const user = await auth(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("user_settings")
    .select("display_name, transcription_footer, role")
    .eq("user_id", user.id)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function PATCH(request: Request) {
  const user = await auth(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.display_name === "string") updates.display_name = body.display_name;
  if (typeof body.transcription_footer === "string") {
    updates.transcription_footer = body.transcription_footer;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no valid fields" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("user_settings")
    .update(updates)
    .eq("user_id", user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Test with curl**

```bash
cd /Users/andrefogelman/zapi-pwa
bun run dev &
sleep 3
# Grab a session token via browser login, paste here:
TOKEN="<your supabase access token>"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/user-settings
kill %1 2>/dev/null || true
```

Expected: `{ "display_name": "...", "transcription_footer": "...", "role": "..." }`

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/api/user-settings/route.ts
git commit -m "feat(api): user-settings GET/PATCH"
```

### Task 3.2: `/api/admin/users` — list and invite

**Files:**
- Create: `packages/pwa/src/app/api/admin/users/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);

    // List auth users + settings + instance count in one fetch.
    // Supabase admin API lists users; settings are joined in JS.
    const { data: authList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw listErr;

    const userIds = authList.users.map((u) => u.id);

    const [{ data: settings }, { data: instances }] = await Promise.all([
      supabaseAdmin
        .from("user_settings")
        .select("user_id, display_name, role, status, transcription_footer, created_at")
        .in("user_id", userIds),
      supabaseAdmin
        .from("instances")
        .select("user_id")
        .in("user_id", userIds),
    ]);

    const settingsByUser = new Map((settings ?? []).map((s) => [s.user_id, s]));
    const instanceCount = new Map<string, number>();
    for (const i of instances ?? []) {
      instanceCount.set(i.user_id, (instanceCount.get(i.user_id) ?? 0) + 1);
    }

    const users = authList.users.map((u) => ({
      id: u.id,
      email: u.email,
      last_sign_in_at: u.last_sign_in_at,
      is_pending_invite: !u.last_sign_in_at && !u.confirmed_at,
      ...(settingsByUser.get(u.id) ?? { role: null, status: null, display_name: null }),
      instance_count: instanceCount.get(u.id) ?? 0,
    }));

    return Response.json({ users });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { email } = await request.json();
    if (typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "invalid email" }, { status: 400 });
    }

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`;
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (error) throw error;

    return Response.json({ user_id: data.user?.id, invite_sent: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Add `NEXT_PUBLIC_SITE_URL` to `packages/pwa/.env.local` if missing**

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

And set the production value (`https://zapi-pwa.vercel.app`) in Vercel dashboard env vars.

- [ ] **Step 3: Test with curl (super-admin token)**

```bash
bun run dev &
sleep 3
TOKEN="<super-admin token>"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/admin/users | head
kill %1 2>/dev/null || true
```

Expected: JSON with `users` array.

- [ ] **Step 4: Commit**

```bash
git add packages/pwa/src/app/api/admin/users/route.ts packages/pwa/.env.local
git commit -m "feat(api): admin users list + invite"
```

### Task 3.3: `/api/admin/users/[id]/resend`

**Files:**
- Create: `packages/pwa/src/app/api/admin/users/[id]/resend/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;

    // Look up email first
    const { data: userData, error: lookupErr } = await supabaseAdmin.auth.admin.getUserById(id);
    if (lookupErr || !userData.user?.email) throw lookupErr ?? new Error("user not found");

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`;
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email: userData.user.email,
      options: { redirectTo },
    });
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/users/[id]/resend/route.ts
git commit -m "feat(api): admin resend user invite"
```

### Task 3.4: `/api/admin/users/[id]/role`

**Files:**
- Create: `packages/pwa/src/app/api/admin/users/[id]/role/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;
    const { role } = await request.json();

    if (role !== "user" && role !== "super_admin") {
      return Response.json({ error: "invalid role" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc("admin_update_user_role", {
      target_user_id: id,
      new_role: role,
      caller_user_id: user.id,
    });
    if (error) {
      // Translate known RAISE EXCEPTION messages
      if (error.message.includes("cannot demote self")) {
        return Response.json({ error: "cannot demote self" }, { status: 400 });
      }
      if (error.message.includes("caller is not super_admin")) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      throw error;
    }

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/users/[id]/role/route.ts
git commit -m "feat(api): admin update user role via RPC"
```

### Task 3.5: `/api/admin/users/[id]/disable`

**Files:**
- Create: `packages/pwa/src/app/api/admin/users/[id]/disable/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;
    const { disabled } = await request.json();

    if (typeof disabled !== "boolean") {
      return Response.json({ error: "disabled must be boolean" }, { status: 400 });
    }

    const newStatus = disabled ? "disabled" : "active";

    const { error: rpcErr } = await supabaseAdmin.rpc("admin_update_user_status", {
      target_user_id: id,
      new_status: newStatus,
      caller_user_id: user.id,
    });
    if (rpcErr) {
      if (rpcErr.message.includes("cannot disable self")) {
        return Response.json({ error: "cannot disable self" }, { status: 400 });
      }
      throw rpcErr;
    }

    // Invalidate or restore auth sessions
    const banDuration = disabled ? "876000h" : "none";
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: banDuration,
    });
    if (authErr) throw authErr;

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/users/[id]/disable/route.ts
git commit -m "feat(api): admin disable/enable user with session invalidation"
```

### Task 3.6: `/api/admin/users/[id]/reset`

**Files:**
- Create: `packages/pwa/src/app/api/admin/users/[id]/reset/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(id);
    if (!userData.user?.email) {
      return Response.json({ error: "user has no email" }, { status: 400 });
    }

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`;
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: userData.user.email,
      options: { redirectTo },
    });
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/users/[id]/reset/route.ts
git commit -m "feat(api): admin send password recovery link"
```

### Task 3.7: `/api/admin/users/[id]` — DELETE

**Files:**
- Create: `packages/pwa/src/app/api/admin/users/[id]/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, supabaseAdmin } = await requireSuperAdmin(request);
    const { id } = await params;

    if (id === user.id) {
      return Response.json({ error: "cannot delete self" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw error;

    // Cascades handle instances, messages, transcriptions, user_settings.
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/users/[id]/route.ts
git commit -m "feat(api): admin delete user with cascade"
```

### Task 3.8: `/api/admin/platform-config` — GET and PUT

**Files:**
- Create: `packages/pwa/src/app/api/admin/platform-config/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

const ALLOWED_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "whisper-1"];

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);
    const { data, error } = await supabaseAdmin
      .from("platform_config")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { user, supabaseAdmin } = await requireSuperAdmin(request);
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (typeof body.neura_prompt === "string") updates.neura_prompt = body.neura_prompt;
    if (typeof body.neura_model === "string") {
      if (!ALLOWED_MODELS.includes(body.neura_model)) {
        return Response.json({ error: "invalid model" }, { status: 400 });
      }
      updates.neura_model = body.neura_model;
    }
    if (typeof body.neura_temperature === "number") {
      if (body.neura_temperature < 0 || body.neura_temperature > 2) {
        return Response.json({ error: "temperature must be [0,2]" }, { status: 400 });
      }
      updates.neura_temperature = body.neura_temperature;
    }
    if (typeof body.neura_top_p === "number") {
      if (body.neura_top_p < 0 || body.neura_top_p > 1) {
        return Response.json({ error: "top_p must be [0,1]" }, { status: 400 });
      }
      updates.neura_top_p = body.neura_top_p;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "no valid fields" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();
    updates.updated_by = user.id;

    const { error } = await supabaseAdmin
      .from("platform_config")
      .update(updates)
      .eq("id", 1);
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/platform-config/route.ts
git commit -m "feat(api): admin platform-config GET/PUT with validation"
```

### Task 3.9: `/api/admin/stats`

**Files:**
- Create: `packages/pwa/src/app/api/admin/stats/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { requireSuperAdmin, errorResponse } from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    const { supabaseAdmin } = await requireSuperAdmin(request);

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const iso = startOfDay.toISOString();

    const [
      { count: total_users },
      { count: connected_instances },
      { count: transcribed_today },
      { count: failed_today },
    ] = await Promise.all([
      supabaseAdmin.from("user_settings").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("instances")
        .select("*", { count: "exact", head: true })
        .eq("status", "connected"),
      supabaseAdmin
        .from("transcriptions")
        .select("*", { count: "exact", head: true })
        .gte("created_at", iso),
      supabaseAdmin
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("status", "transcription_failed")
        .gte("timestamp", iso),
    ]);

    return Response.json({
      total_users: total_users ?? 0,
      connected_instances: connected_instances ?? 0,
      transcribed_today: transcribed_today ?? 0,
      failed_today: failed_today ?? 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/admin/stats/route.ts
git commit -m "feat(api): admin stats endpoint for dashboard"
```

### Task 3.10: `/api/instances/[id]/qr` and `/status`

**Files:**
- Create: `packages/pwa/src/app/api/instances/[id]/qr/route.ts`
- Create: `packages/pwa/src/app/api/instances/[id]/status/route.ts`

- [ ] **Step 1: Create the QR route**

```ts
// packages/pwa/src/app/api/instances/[id]/qr/route.ts
export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { getSessionQR } from "@/lib/waclaw";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("waclaw_session_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!instance?.waclaw_session_id) {
    return Response.json({ error: "instance not found or not waclaw" }, { status: 404 });
  }

  try {
    const qr = await getSessionQR(instance.waclaw_session_id);
    return Response.json(qr);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 2: Create the status route**

```ts
// packages/pwa/src/app/api/instances/[id]/status/route.ts
export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { getSessionStatus } from "@/lib/waclaw";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("waclaw_session_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!instance?.waclaw_session_id) {
    return Response.json({ error: "instance not found or not waclaw" }, { status: 404 });
  }

  try {
    const session = await getSessionStatus(instance.waclaw_session_id);

    if (session.status === "connected" && session.phone) {
      await supabase
        .from("instances")
        .update({
          status: "connected",
          connected_phone: session.phone,
          my_phones: [session.phone],
        })
        .eq("id", id);
    }

    return Response.json(session);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/api/instances/[id]/qr/route.ts packages/pwa/src/app/api/instances/[id]/status/route.ts
git commit -m "feat(api): waclaw QR and status routes per instance"
```

### Task 3.11: `/api/instances/[id]/groups` — list + upsert

**Files:**
- Create: `packages/pwa/src/app/api/instances/[id]/groups/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

async function authAndOwn(request: Request, instanceId: string) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user) return null;
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("instances")
    .select("id")
    .eq("id", instanceId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { user, supabase } : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await auth.supabase
    .from("instance_groups")
    .select("*")
    .eq("instance_id", id)
    .order("subject");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ groups: data });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json();
  if (typeof body.group_id !== "string" || typeof body.subject !== "string") {
    return Response.json({ error: "group_id and subject required" }, { status: 400 });
  }

  const row = {
    instance_id: id,
    group_id: body.group_id,
    subject: body.subject,
    subject_owner: body.subject_owner ?? null,
    group_lid: body.group_lid ?? null,
    transcribe_all: body.transcribe_all ?? false,
    send_reply: body.send_reply ?? true,
    monitor_daily: body.monitor_daily ?? false,
  };

  const { error } = await auth.supabase
    .from("instance_groups")
    .upsert(row, { onConflict: "instance_id,group_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/instances/[id]/groups/route.ts
git commit -m "feat(api): instance groups list + upsert"
```

### Task 3.12: `/api/instances/[id]/groups/[groupId]` — PATCH and DELETE

**Files:**
- Create: `packages/pwa/src/app/api/instances/[id]/groups/[groupId]/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

type Params = Promise<{ id: string; groupId: string }>;

async function authAndOwn(request: Request, instanceId: string) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const user = await getUserFromToken(token);
  if (!user) return null;
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("instances")
    .select("id")
    .eq("id", instanceId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { supabase } : null;
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { id, groupId } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.transcribe_all === "boolean") updates.transcribe_all = body.transcribe_all;
  if (typeof body.send_reply === "boolean") updates.send_reply = body.send_reply;
  if (typeof body.monitor_daily === "boolean") updates.monitor_daily = body.monitor_daily;
  if (typeof body.subject === "string") updates.subject = body.subject;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "no valid fields" }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("instance_groups")
    .update(updates)
    .eq("instance_id", id)
    .eq("group_id", groupId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  const { id, groupId } = await params;
  const auth = await authAndOwn(request, id);
  if (!auth) return Response.json({ error: "forbidden" }, { status: 403 });

  const { error } = await auth.supabase
    .from("instance_groups")
    .delete()
    .eq("instance_id", id)
    .eq("group_id", groupId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/instances/[id]/groups/[groupId]/route.ts
git commit -m "feat(api): instance group PATCH and DELETE"
```

### Task 3.13: `/api/instances/[id]/groups/fetch` — pull live from waclaw

**Files:**
- Create: `packages/pwa/src/app/api/instances/[id]/groups/fetch/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";

import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { fetchSessionGroups } from "@/lib/waclaw";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("waclaw_session_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!instance?.waclaw_session_id) {
    return Response.json({ error: "instance not found" }, { status: 404 });
  }

  try {
    const groups = await fetchSessionGroups(instance.waclaw_session_id);
    return Response.json({ groups });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/api/instances/[id]/groups/fetch/route.ts
git commit -m "feat(api): fetch groups from waclaw for a session"
```

### Task 3.14: Adjust `/api/instances/route.ts` to default waclaw

**Files:**
- Modify: `packages/pwa/src/app/api/instances/route.ts`

- [ ] **Step 1: Read current content and locate the POST handler**

- [ ] **Step 2: Replace the POST handler body with waclaw-only logic**

```ts
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name } = body;
  // New instances are always waclaw. Z-API legacy stays for existing rows only.
  const provider = "waclaw";

  const supabase = getSupabaseServer();

  // Create waclaw session
  const waclawUrl = process.env.WACLAW_URL ?? "http://100.66.83.22:3100";
  const waclawKey = process.env.WACLAW_API_KEY ?? "waclaw-dev-key";
  const sessionRes = await fetch(`${waclawUrl}/sessions`, {
    method: "POST",
    headers: { "X-API-Key": waclawKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name: name ?? "Minha Instância" }),
  });
  if (!sessionRes.ok) {
    return Response.json({ error: "waclaw session creation failed" }, { status: 502 });
  }
  const { id: sessionId } = await sessionRes.json();

  const { data, error } = await supabase
    .from("instances")
    .insert({
      user_id: user.id,
      name: name ?? "Minha Instância",
      provider,
      zapi_instance_id: "",   // empty strings satisfy NOT NULL legacy columns
      zapi_token: "",
      zapi_client_token: null,
      waclaw_session_id: sessionId,
      status: "connecting",
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
```

Keep the `GET` handler unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/api/instances/route.ts
git commit -m "feat(api): instances POST always creates waclaw sessions"
```

### Task 3.15: `/api/internal/on-audio` — the hot path

**Files:**
- Create: `packages/pwa/src/app/api/internal/on-audio/route.ts`

- [ ] **Step 1: Create the route**

```ts
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import {
  OnAudioEventSchema,
  INTERNAL_HEADER_SECRET,
  type OnAudioResponse,
} from "zapi-shared";
import { getSupabaseServiceRole } from "@/lib/supabase-server";
import { filterMessage } from "@/lib/filter";
import { transcribeAudio } from "@/lib/openai";
import * as waclaw from "@/lib/waclaw";
import { formatReply } from "@/lib/footer";

export async function POST(req: Request): Promise<Response> {
  // 1. Shared-secret auth
  if (req.headers.get(INTERNAL_HEADER_SECRET) !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return Response.json({ status: "failed", reason: "unauthorized" } satisfies OnAudioResponse, {
      status: 401,
    });
  }

  // 2. Schema validation
  const parsed = OnAudioEventSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { status: "failed", reason: "invalid payload" } satisfies OnAudioResponse,
      { status: 400 }
    );
  }
  const event = parsed.data;
  const supabase = getSupabaseServiceRole();

  // 3. Instance lookup
  const { data: instance } = await supabase
    .from("instances")
    .select("id, user_id, my_phones, my_lids, connected_phone")
    .eq("waclaw_session_id", event.waclaw_session_id)
    .maybeSingle();
  if (!instance) {
    return Response.json({ status: "skipped", reason: "session not bound" });
  }

  // 4. Idempotency
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("instance_id", instance.id)
    .eq("message_id", event.message_id)
    .maybeSingle();
  if (existing) {
    return Response.json({ status: "skipped", reason: "duplicate" });
  }

  // 5. Fetch group (if applicable), platform config, user footer
  const [{ data: groups }, { data: config }, { data: userSettings }] = await Promise.all([
    event.is_group
      ? supabase
          .from("instance_groups")
          .select("*")
          .eq("instance_id", instance.id)
          .eq("group_id", event.chat_jid)
      : Promise.resolve({ data: [] as Array<{ transcribe_all: boolean; send_reply: boolean }> }),
    supabase.from("platform_config").select("*").eq("id", 1).single(),
    supabase
      .from("user_settings")
      .select("transcription_footer")
      .eq("user_id", instance.user_id)
      .single(),
  ]);

  // 6. Filter decision
  const decision = filterMessage({
    event,
    instance,
    group: groups?.[0] ?? null,
  });

  if (decision.action === "skip") {
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

  // 7. Download + transcribe
  let transcribedText: string;
  try {
    const audioRes = await fetch(event.audio_url);
    const audioBuffer = await audioRes.arrayBuffer();
    transcribedText = await transcribeAudio(audioBuffer, {
      model: config?.neura_model,
      prompt: config?.neura_prompt,
      temperature: config?.neura_temperature,
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
    return Response.json(
      { status: "failed", reason: String(err) } satisfies OnAudioResponse,
      { status: 500 }
    );
  }

  // 8. Persist
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

  if (messageRow) {
    await supabase.from("transcriptions").insert({
      message_id: messageRow.id,
      instance_id: instance.id,
      text: transcribedText,
      duration_ms: event.audio_duration_seconds * 1000,
    });
  }

  // 9. Reply to WhatsApp if decision says so
  if (decision.sendReply) {
    const footer = userSettings?.transcription_footer ?? "Transcrição por IA 😜";
    const replyText = formatReply(transcribedText, footer);
    try {
      await waclaw.sendMessage({
        sessionId: event.waclaw_session_id,
        chatJid: event.chat_jid,
        text: replyText,
        replyToMessageId: event.message_id,
      });
    } catch (err) {
      console.error("failed to send reply to whatsapp:", err);
      // Non-fatal — transcription is saved.
    }
  }

  return Response.json({ status: "transcribed" } satisfies OnAudioResponse);
}
```

- [ ] **Step 2: Add `INTERNAL_WEBHOOK_SECRET` to `packages/pwa/.env.local`**

```
INTERNAL_WEBHOOK_SECRET=<the 32-byte hex you generated at plan start>
```

And to Vercel dashboard env vars (same value).

- [ ] **Step 3: Test with curl (mock event)**

```bash
bun run dev &
sleep 3
SECRET="<same value>"
curl -s -X POST http://localhost:3000/api/internal/on-audio \
  -H "Content-Type: application/json" \
  -H "X-Zapi-Internal-Secret: $SECRET" \
  -d '{
    "waclaw_session_id": "nonexistent",
    "message_id": "test-1",
    "chat_jid": "5511@s.whatsapp.net",
    "chat_name": "Test",
    "sender_phone": "5511988888888",
    "sender_name": "Test Sender",
    "from_me": false,
    "is_group": false,
    "audio_url": "https://example.com/a.ogg",
    "audio_duration_seconds": 3,
    "timestamp": "2026-04-11T12:00:00.000Z"
  }'
kill %1 2>/dev/null || true
```

Expected: `{"status":"skipped","reason":"session not bound"}` — means the schema and auth are correct and the handler reached step 3.

- [ ] **Step 4: Commit**

```bash
git add packages/pwa/src/app/api/internal/on-audio/route.ts packages/pwa/.env.local
git commit -m "feat(api): internal on-audio route — hot path for daemon forwarding"
```

---

## Phase 4 — Frontend

### Task 4.1: Extend `middleware.ts` for `/admin` and disabled users

**Files:**
- Modify: `packages/pwa/src/middleware.ts`

- [ ] **Step 1: Replace the middleware with the extended version**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Public routes
  if (
    path === "/login" ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/webhook") ||
    path.startsWith("/api/internal/")
  ) {
    return NextResponse.next();
  }

  if (!path.startsWith("/app") && !path.startsWith("/admin")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Load user_settings once for both checks
  const { data: settings } = await supabase
    .from("user_settings")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  // Disabled users are kicked out
  if (settings?.status === "disabled") {
    return NextResponse.redirect(new URL("/login?disabled=1", request.url));
  }

  // /admin requires super_admin
  if (path.startsWith("/admin")) {
    if (settings?.role !== "super_admin" || settings?.status !== "active") {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/middleware.ts
git commit -m "feat(middleware): protect /admin for super_admin; block disabled users"
```

### Task 4.2: Add safety net upsert in `/app/layout.tsx`

**Files:**
- Modify: `packages/pwa/src/app/app/layout.tsx`

- [ ] **Step 1: Read current content**

- [ ] **Step 2: Add the upsert at the top of the server component**

If the layout is a server component (async function), add:

```ts
import { getSupabaseServer } from "@/lib/supabase-server";

// ... inside the async default export, before the return:
const supabase = getSupabaseServer();
const { data: { user } } = await supabase.auth.getUser();
if (user) {
  const displayName = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "você";
  await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        display_name: displayName,
        transcription_footer: `Transcrição por IA by ${displayName} 😜`,
      },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/app/layout.tsx
git commit -m "feat(app): safety-net upsert of user_settings on layout render"
```

### Task 4.3: `useUserSettings` hook

**Files:**
- Create: `packages/pwa/src/app/app/hooks/useUserSettings.ts`

- [ ] **Step 1: Create the hook**

```ts
"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export interface UserSettingsView {
  display_name: string | null;
  transcription_footer: string;
  role: "user" | "super_admin";
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/user-settings", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        setSettings(await res.json());
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function update(patch: Partial<Pick<UserSettingsView, "display_name" | "transcription_footer">>) {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    const res = await fetch("/api/user-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await res.text());
    setSettings((s) => (s ? { ...s, ...patch } : s));
  }

  return { settings, loading, error, update };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/app/hooks/useUserSettings.ts
git commit -m "feat(hooks): useUserSettings for current user"
```

### Task 4.4: `QRConnectWizard` component

**Files:**
- Create: `packages/pwa/src/app/app/components/QRConnectWizard.tsx`

- [ ] **Step 1: Install `react-qr-code` if not already a dep**

```bash
cd /Users/andrefogelman/zapi-pwa/packages/pwa
bun add react-qr-code
```

- [ ] **Step 2: Create the component**

```tsx
"use client";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Step = "name" | "qr" | "connected" | "error";

export function QRConnectWizard({ onDone }: { onDone: (instanceId: string) => void }) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ qr: string; format: "string" | "png_base64" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getToken(): Promise<string> {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    return session.access_token;
  }

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const token = await getToken();
      const createRes = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const instance = await createRes.json();
      setInstanceId(instance.id);

      const qrRes = await fetch(`/api/instances/${instance.id}/qr`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!qrRes.ok) throw new Error(await qrRes.text());
      setQr(await qrRes.json());
      setStep("qr");
    } catch (err) {
      setError(String(err));
      setStep("error");
    }
  }

  useEffect(() => {
    if (step !== "qr" || !instanceId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const token = await getToken();
        const res = await fetch(`/api/instances/${instanceId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.status === "connected") {
          setStep("connected");
          clearInterval(interval);
          setTimeout(() => onDone(instanceId), 1500);
        }
      } catch {
        // swallow and retry
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, instanceId, onDone]);

  const container = {
    maxWidth: 400,
    margin: "2rem auto",
    padding: "2rem",
    border: "1px solid #ddd",
    borderRadius: 8,
    textAlign: "center" as const,
    fontFamily: "sans-serif",
  };

  if (step === "name") {
    return (
      <div style={container}>
        <h2>Conectar WhatsApp</h2>
        <p style={{ color: "#666" }}>Dê um nome pra essa linha</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Celular principal"
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
          autoFocus
        />
        <button onClick={handleCreate} disabled={!name.trim()} style={{ padding: "0.5rem 1.5rem" }}>
          Continuar
        </button>
      </div>
    );
  }

  if (step === "qr" && qr) {
    return (
      <div style={container}>
        <h2>Escaneie com o WhatsApp</h2>
        <p style={{ color: "#666", fontSize: "0.9rem" }}>
          WhatsApp → Aparelhos conectados → Conectar aparelho
        </p>
        {qr.format === "string" ? (
          <div style={{ background: "#fff", padding: 16, display: "inline-block" }}>
            <QRCode value={qr.qr} size={256} />
          </div>
        ) : (
          <img src={`data:image/png;base64,${qr.qr}`} alt="QR" style={{ width: 256 }} />
        )}
        <p style={{ color: "#999", marginTop: "1rem" }}>Aguardando conexão...</p>
      </div>
    );
  }

  if (step === "connected") {
    return (
      <div style={container}>
        <h2>✓ Conectado!</h2>
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div style={container}>
      <h2>Erro</h2>
      <p style={{ color: "red" }}>{error}</p>
      <button onClick={() => setStep("name")} style={{ padding: "0.5rem 1.5rem" }}>
        Tentar de novo
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/app/components/QRConnectWizard.tsx packages/pwa/package.json packages/pwa/bun.lock
git commit -m "feat(ui): QRConnectWizard reusable component"
```

### Task 4.5: First-run wizard in `/app/page.tsx`

**Files:**
- Modify: `packages/pwa/src/app/app/page.tsx`

- [ ] **Step 1: Read current content and locate the top of the render tree**

- [ ] **Step 2: Add early return for zero-instances case**

Near the top of the default export, after loading state, add:

```tsx
import { QRConnectWizard } from "./components/QRConnectWizard";

// inside the component, after `const { instances, loading, refetch } = useInstances();`
if (loading) return <div style={{ padding: "2rem", textAlign: "center" }}>Carregando...</div>;

if (instances.length === 0) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5" }}>
      <div>
        <h1 style={{ textAlign: "center", marginBottom: "1rem" }}>Bem-vindo ao zapi-pwa</h1>
        <p style={{ textAlign: "center", color: "#666", marginBottom: "2rem" }}>
          Vamos conectar seu primeiro WhatsApp
        </p>
        <QRConnectWizard onDone={() => refetch()} />
      </div>
    </div>
  );
}
```

Keep the existing chat render below.

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/app/page.tsx
git commit -m "feat(app): first-run wizard when user has zero instances"
```

### Task 4.6: Add Admin link to `Sidebar.tsx`

**Files:**
- Modify: `packages/pwa/src/app/app/components/Sidebar.tsx`

- [ ] **Step 1: Read current content**

- [ ] **Step 2: Use `useUserSettings` hook and render link if super_admin**

Add near the bottom of the sidebar JSX (after the list of instances or settings button):

```tsx
import Link from "next/link";
import { useUserSettings } from "../hooks/useUserSettings";

// inside component body:
const { settings } = useUserSettings();

// inside JSX near the bottom:
{settings?.role === "super_admin" && (
  <Link
    href="/admin"
    title="Admin da plataforma"
    style={{
      display: "block",
      padding: "0.5rem",
      marginTop: "auto",
      color: "#1976d2",
      textDecoration: "none",
      fontSize: "0.9rem",
    }}
  >
    ⚙️ Admin
  </Link>
)}
```

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/app/components/Sidebar.tsx
git commit -m "feat(ui): sidebar admin link for super_admin users"
```

### Task 4.7: Extend `SettingsModal.tsx` with Perfil tab

**Files:**
- Modify: `packages/pwa/src/app/app/components/SettingsModal.tsx`

- [ ] **Step 1: Read current content to understand existing tab structure**

- [ ] **Step 2: Add state for tabs and a "perfil" tab at the top**

Add a `type Tab = "perfil" | "instancias" | "grupos" | <existing tabs>` and a tab switcher at the top of the modal. In the `perfil` panel, render:

```tsx
import { useUserSettings } from "../hooks/useUserSettings";

// inside the component:
const { settings, update } = useUserSettings();
const [localFooter, setLocalFooter] = useState("");
const [localName, setLocalName] = useState("");

useEffect(() => {
  if (settings) {
    setLocalFooter(settings.transcription_footer);
    setLocalName(settings.display_name ?? "");
  }
}, [settings]);

// in the perfil tab JSX:
<div>
  <label>Nome de exibição</label>
  <input
    value={localName}
    onChange={(e) => setLocalName(e.target.value)}
    style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
  />

  <label>Rodapé da transcrição</label>
  <input
    value={localFooter}
    onChange={(e) => setLocalFooter(e.target.value)}
    placeholder="Transcrição por IA by Andre 😜"
    style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
  />

  <div style={{ padding: "1rem", background: "#f5f5f5", borderRadius: 4, marginBottom: "1rem", fontSize: "0.9rem" }}>
    <strong>Preview:</strong>
    <div style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
      {`Olá, tudo bem? Esse é um exemplo de transcrição.\n\n${localFooter}`}
    </div>
  </div>

  <button
    onClick={() => update({ display_name: localName, transcription_footer: localFooter })}
    style={{ padding: "0.5rem 1rem" }}
  >
    Salvar perfil
  </button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/app/components/SettingsModal.tsx
git commit -m "feat(ui): SettingsModal Perfil tab (display_name + footer)"
```

### Task 4.8: SettingsModal Instâncias tab

**Files:**
- Modify: `packages/pwa/src/app/app/components/SettingsModal.tsx`

- [ ] **Step 1: Add Instâncias tab that lists instances and has "Add new line" button**

```tsx
// add import
import { QRConnectWizard } from "./QRConnectWizard";
import { useInstances } from "../hooks/useInstances";

// inside component:
const { instances, refetch } = useInstances();
const [showWizard, setShowWizard] = useState(false);

// in Instâncias tab JSX:
<div>
  {showWizard ? (
    <QRConnectWizard
      onDone={() => {
        setShowWizard(false);
        refetch();
      }}
    />
  ) : (
    <>
      <button onClick={() => setShowWizard(true)} style={{ padding: "0.5rem 1rem", marginBottom: "1rem" }}>
        + Adicionar nova linha
      </button>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Nome</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Telefone</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Status</th>
            <th style={{ padding: "0.5rem" }}></th>
          </tr>
        </thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem" }}>{i.name}</td>
              <td style={{ padding: "0.5rem" }}>{i.connected_phone ?? "—"}</td>
              <td style={{ padding: "0.5rem" }}>
                <span style={{
                  padding: "0.2rem 0.5rem",
                  borderRadius: 4,
                  fontSize: "0.8rem",
                  background: i.status === "connected" ? "#c8e6c9" : "#ffccbc",
                }}>
                  {i.status}
                </span>
              </td>
              <td style={{ padding: "0.5rem" }}>
                <button
                  onClick={async () => {
                    if (!confirm(`Remover linha "${i.name}"?`)) return;
                    const supabase = getSupabaseBrowser();
                    const { data: { session } } = await supabase.auth.getSession();
                    await fetch(`/api/instances/${i.id}`, {
                      method: "DELETE",
                      headers: { Authorization: `Bearer ${session!.access_token}` },
                    });
                    refetch();
                  }}
                  style={{ color: "red", background: "none", border: "none", cursor: "pointer" }}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/app/components/SettingsModal.tsx
git commit -m "feat(ui): SettingsModal Instâncias tab (list, add, remove)"
```

### Task 4.9: SettingsModal Grupos tab

**Files:**
- Modify: `packages/pwa/src/app/app/components/SettingsModal.tsx`

- [ ] **Step 1: Add Grupos tab scoped to the active instance**

The modal needs to know which instance is active — accept as prop or read from a context. If the modal already receives `activeInstanceId` from the parent, use that. Otherwise add a prop.

```tsx
interface Props {
  activeInstanceId: string | null;
  onClose: () => void;
}

// Inside Grupos tab:
const [groups, setGroups] = useState<Array<{
  group_id: string;
  subject: string;
  transcribe_all: boolean;
  send_reply: boolean;
  monitor_daily: boolean;
}>>([]);
const [fetchedGroups, setFetchedGroups] = useState<Array<{ group_id: string; subject: string }>>([]);
const [loading, setLoading] = useState(false);

async function loadGroups() {
  if (!activeInstanceId) return;
  const supabase = getSupabaseBrowser();
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/instances/${activeInstanceId}/groups`, {
    headers: { Authorization: `Bearer ${session!.access_token}` },
  });
  const data = await res.json();
  setGroups(data.groups ?? []);
}

async function fetchFromWhatsApp() {
  if (!activeInstanceId) return;
  setLoading(true);
  const supabase = getSupabaseBrowser();
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/instances/${activeInstanceId}/groups/fetch`, {
    headers: { Authorization: `Bearer ${session!.access_token}` },
  });
  const data = await res.json();
  setFetchedGroups(data.groups ?? []);
  setLoading(false);
}

async function importGroup(g: { group_id: string; subject: string }) {
  const supabase = getSupabaseBrowser();
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(`/api/instances/${activeInstanceId}/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
    body: JSON.stringify({ group_id: g.group_id, subject: g.subject }),
  });
  loadGroups();
}

async function toggleFlag(groupId: string, field: "transcribe_all" | "send_reply" | "monitor_daily", value: boolean) {
  const supabase = getSupabaseBrowser();
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(`/api/instances/${activeInstanceId}/groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
    body: JSON.stringify({ [field]: value }),
  });
  setGroups((prev) => prev.map((g) => g.group_id === groupId ? { ...g, [field]: value } : g));
}

useEffect(() => { loadGroups(); }, [activeInstanceId]);

// JSX:
<div>
  {!activeInstanceId ? (
    <p>Selecione uma instância primeiro.</p>
  ) : (
    <>
      <button onClick={fetchFromWhatsApp} disabled={loading} style={{ padding: "0.5rem 1rem", marginBottom: "1rem" }}>
        {loading ? "Buscando..." : "Buscar grupos do WhatsApp"}
      </button>

      {fetchedGroups.length > 0 && (
        <div style={{ border: "1px solid #ddd", padding: "0.5rem", marginBottom: "1rem" }}>
          <h4>Grupos encontrados (clique pra importar)</h4>
          {fetchedGroups.map((g) => (
            <div key={g.group_id} style={{ padding: "0.25rem", display: "flex", justifyContent: "space-between" }}>
              <span>{g.subject}</span>
              <button onClick={() => importGroup(g)} style={{ fontSize: "0.8rem" }}>Importar</button>
            </div>
          ))}
        </div>
      )}

      <h3>Autorizados</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #333" }}>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Nome</th>
            <th style={{ textAlign: "center", padding: "0.5rem" }} title="Transcrever todos os áudios do grupo">T</th>
            <th style={{ textAlign: "center", padding: "0.5rem" }} title="Enviar transcrição de volta no chat">R</th>
            <th style={{ textAlign: "center", padding: "0.5rem" }} title="Incluir em relatório diário">D</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.group_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem" }}>{g.subject}</td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={g.transcribe_all} onChange={(e) => toggleFlag(g.group_id, "transcribe_all", e.target.checked)} />
              </td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={g.send_reply} onChange={(e) => toggleFlag(g.group_id, "send_reply", e.target.checked)} />
              </td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={g.monitor_daily} onChange={(e) => toggleFlag(g.group_id, "monitor_daily", e.target.checked)} />
              </td>
              <td>
                <button
                  onClick={async () => {
                    const supabase = getSupabaseBrowser();
                    const { data: { session } } = await supabase.auth.getSession();
                    await fetch(`/api/instances/${activeInstanceId}/groups/${encodeURIComponent(g.group_id)}`, {
                      method: "DELETE",
                      headers: { Authorization: `Bearer ${session!.access_token}` },
                    });
                    loadGroups();
                  }}
                  style={{ color: "red", background: "none", border: "none" }}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )}
</div>
```

- [ ] **Step 2: Make sure parent passes `activeInstanceId` to `SettingsModal`** — if currently rendered without it, update the render site in `page.tsx` to pass `activeInstanceId={currentInstanceId}`.

- [ ] **Step 3: Commit**

```bash
git add packages/pwa/src/app/app/components/SettingsModal.tsx packages/pwa/src/app/app/page.tsx
git commit -m "feat(ui): SettingsModal Grupos tab per active instance"
```

### Task 4.10: `/admin/layout.tsx`

**Files:**
- Create: `packages/pwa/src/app/admin/layout.tsx`

- [ ] **Step 1: Create the shell layout**

```tsx
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <aside
        style={{
          width: 220,
          background: "#1a1a1a",
          color: "#fff",
          padding: "1.5rem 1rem",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", marginBottom: "2rem" }}>zapi-pwa admin</h1>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Link href="/admin" style={linkStyle}>Dashboard</Link>
          <Link href="/admin/users" style={linkStyle}>Usuários</Link>
          <Link href="/admin/neura" style={linkStyle}>Neura</Link>
          <Link
            href="/app"
            style={{ ...linkStyle, marginTop: "2rem", opacity: 0.6 }}
          >
            ← Voltar ao chat
          </Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: "2rem 3rem", background: "#f5f5f5" }}>
        {children}
      </main>
    </div>
  );
}

const linkStyle = {
  color: "#fff",
  textDecoration: "none",
  padding: "0.5rem 0.75rem",
  borderRadius: 4,
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/admin/layout.tsx
git commit -m "feat(admin): layout shell with sidebar nav"
```

### Task 4.11: `/admin/page.tsx` — dashboard

**Files:**
- Create: `packages/pwa/src/app/admin/page.tsx`

- [ ] **Step 1: Create the dashboard**

```tsx
"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Stats {
  total_users: number;
  connected_instances: number;
  transcribed_today: number;
  failed_today: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch("/api/admin/stats", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        setStats(await res.json());
      } catch (err) {
        setError(String(err));
      }
    })();
  }, []);

  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!stats) return <div>Carregando...</div>;

  const cards = [
    { label: "Usuários", value: stats.total_users },
    { label: "Instâncias conectadas", value: stats.connected_instances },
    { label: "Transcrições hoje", value: stats.transcribed_today },
    { label: "Falhas hoje", value: stats.failed_today, red: stats.failed_today > 0 },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginTop: "1.5rem" }}>
        {cards.map((c) => (
          <div key={c.label} style={{ padding: "1.5rem", background: "#fff", borderRadius: 8, border: "1px solid #ddd" }}>
            <div style={{ color: "#666", fontSize: "0.85rem" }}>{c.label}</div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: c.red ? "#c00" : "#333", marginTop: "0.5rem" }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/admin/page.tsx
git commit -m "feat(admin): dashboard with stat cards"
```

### Task 4.12: `/admin/users/page.tsx` — users table

**Files:**
- Create: `packages/pwa/src/app/admin/users/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "super_admin" | null;
  status: "active" | "disabled" | null;
  instance_count: number;
  last_sign_in_at: string | null;
  is_pending_invite: boolean;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitingEmail, setInvitingEmail] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [me, setMe] = useState<string | null>(null);

  async function token() {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    setMe(session.user.id);
    return session.access_token;
  }

  async function load() {
    setLoading(true);
    const t = await token();
    const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${t}` } });
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function invite() {
    if (!invitingEmail.includes("@")) return;
    const t = await token();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ email: invitingEmail }),
    });
    if (res.ok) {
      setMsg("Convite enviado!");
      setInvitingEmail("");
      load();
    } else {
      setMsg(`Erro: ${await res.text()}`);
    }
    setTimeout(() => setMsg(""), 3000);
  }

  async function doAction(userId: string, path: string, method: string, body?: unknown) {
    const t = await token();
    const res = await fetch(`/api/admin/users/${userId}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      setMsg(`Erro: ${await res.text()}`);
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    load();
  }

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      <h1>Usuários</h1>

      <div style={{ background: "#fff", padding: "1rem", borderRadius: 8, marginBottom: "1.5rem", border: "1px solid #ddd" }}>
        <h3 style={{ marginTop: 0 }}>Convidar novo usuário</h3>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="email"
            placeholder="email@exemplo.com"
            value={invitingEmail}
            onChange={(e) => setInvitingEmail(e.target.value)}
            style={{ flex: 1, padding: "0.5rem" }}
          />
          <button onClick={invite} style={{ padding: "0.5rem 1rem" }}>Convidar</button>
        </div>
        {msg && <p style={{ marginTop: "0.5rem", color: msg.startsWith("Erro") ? "red" : "green" }}>{msg}</p>}
      </div>

      <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#eee", textAlign: "left" }}>
            <th style={{ padding: "0.75rem" }}>Email</th>
            <th style={{ padding: "0.75rem" }}>Nome</th>
            <th style={{ padding: "0.75rem" }}>Role</th>
            <th style={{ padding: "0.75rem" }}>Status</th>
            <th style={{ padding: "0.75rem" }}>Linhas</th>
            <th style={{ padding: "0.75rem" }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === me;
            return (
              <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.75rem" }}>{u.email}{u.is_pending_invite ? " (pendente)" : ""}</td>
                <td style={{ padding: "0.75rem" }}>{u.display_name ?? "—"}</td>
                <td style={{ padding: "0.75rem" }}>{u.role ?? "—"}</td>
                <td style={{ padding: "0.75rem" }}>{u.status ?? "—"}</td>
                <td style={{ padding: "0.75rem" }}>{u.instance_count}</td>
                <td style={{ padding: "0.75rem", fontSize: "0.85rem" }}>
                  {u.is_pending_invite && (
                    <button onClick={() => doAction(u.id, "/resend", "POST")}>Reenviar</button>
                  )}{" "}
                  <button onClick={() => doAction(u.id, "/reset", "POST")}>Reset senha</button>{" "}
                  {!isSelf && (
                    <>
                      <button
                        onClick={() => doAction(u.id, "/role", "PATCH", { role: u.role === "super_admin" ? "user" : "super_admin" })}
                      >
                        {u.role === "super_admin" ? "Rebaixar" : "Promover"}
                      </button>{" "}
                      <button
                        onClick={() => doAction(u.id, "/disable", "PATCH", { disabled: u.status !== "disabled" })}
                      >
                        {u.status === "disabled" ? "Reativar" : "Desabilitar"}
                      </button>{" "}
                      <button
                        onClick={() => {
                          if (!confirm(`Deletar ${u.email}? Apaga TODAS as instâncias e mensagens em cascata.`)) return;
                          doAction(u.id, "", "DELETE");
                        }}
                        style={{ color: "red" }}
                      >
                        Deletar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/admin/users/page.tsx
git commit -m "feat(admin): users table with full CRUD actions"
```

### Task 4.13: `/admin/neura/page.tsx` — platform config editor

**Files:**
- Create: `packages/pwa/src/app/admin/neura/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface PlatformConfig {
  neura_prompt: string;
  neura_model: string;
  neura_temperature: number;
  neura_top_p: number;
}

const MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "whisper-1"];

export default function AdminNeuraPage() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function token() {
    const supabase = getSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    return session.access_token;
  }

  useEffect(() => {
    (async () => {
      const t = await token();
      const res = await fetch("/api/admin/platform-config", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) setConfig(await res.json());
    })();
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    const t = await token();
    const res = await fetch("/api/admin/platform-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({
        neura_prompt: config.neura_prompt,
        neura_model: config.neura_model,
        neura_temperature: config.neura_temperature,
        neura_top_p: config.neura_top_p,
      }),
    });
    setSaving(false);
    setMsg(res.ok ? "Salvo!" : `Erro: ${await res.text()}`);
    setTimeout(() => setMsg(""), 3000);
  }

  if (!config) return <div>Carregando...</div>;

  return (
    <div style={{ maxWidth: 700 }}>
      <h1>Neura</h1>

      <label>System Prompt</label>
      <textarea
        value={config.neura_prompt}
        onChange={(e) => setConfig({ ...config, neura_prompt: e.target.value })}
        style={{ width: "100%", minHeight: 300, fontFamily: "monospace", fontSize: "0.85rem", padding: "0.5rem", marginBottom: "1rem" }}
      />

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Modelo</label>
          <select
            value={config.neura_model}
            onChange={(e) => setConfig({ ...config, neura_model: e.target.value })}
            style={{ width: "100%", padding: "0.5rem" }}
          >
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Temperature ({config.neura_temperature})</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={config.neura_temperature}
            onChange={(e) => setConfig({ ...config, neura_temperature: parseFloat(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Top P ({config.neura_top_p})</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.neura_top_p}
            onChange={(e) => setConfig({ ...config, neura_top_p: parseFloat(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <button onClick={save} disabled={saving} style={{ padding: "0.5rem 1rem", marginTop: "1.5rem" }}>
        {saving ? "Salvando..." : "Salvar"}
      </button>
      {msg && <p style={{ color: msg.startsWith("Erro") ? "red" : "green", marginTop: "0.5rem" }}>{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/pwa/src/app/admin/neura/page.tsx
git commit -m "feat(admin): neura platform config editor"
```

### Task 4.14: Full frontend smoke test

- [ ] **Step 1: Start dev server and test the flows manually**

```bash
cd /Users/andrefogelman/zapi-pwa
bun run dev
```

Open `http://localhost:3000` and verify:
- Login with Andre's Google account → lands in `/app`
- Sidebar shows `⚙️ Admin` link
- Click `/admin` → dashboard loads with stats
- `/admin/users` → Andre is listed as super_admin, actions disabled for self
- `/admin/neura` → current prompt loads, save works
- Back to `/app` → open `SettingsModal` → Perfil, Instâncias, Grupos tabs render
- Instâncias tab → click "Add new line" → wizard opens → name + create → QR appears (may be fake if waclaw isn't reachable locally; that's OK — validate in Phase 5)

- [ ] **Step 2: Fix anything that breaks. Commit fixes as encountered.**

- [ ] **Step 3: Deploy to Vercel preview and repeat the smoke test against the preview URL**

```bash
git push origin main
```

Vercel auto-deploys. Smoke test again on the preview URL.

---

## Phase 5 — Daemon

### Task 5.1: Validate waclaw events protocol

**No code changes — investigation only.**

- [ ] **Step 1: SSH to worker5 and discover the events endpoint**

```bash
ssh openclaw@100.66.83.22
curl -i http://localhost:3100/events -H "X-API-Key: <real key>"
# If 404, try:
curl -i http://localhost:3100/sessions -H "X-API-Key: <real key>"
# Look at waclaw process or source to find the real event stream endpoint.
```

- [ ] **Step 2: Document findings in `packages/daemon/README.md`**

```markdown
# zapi-pwa-daemon

## Waclaw events protocol

Discovered on 2026-04-11:
- Endpoint: `<actual path>`
- Protocol: `<SSE | WebSocket | long-poll>`
- Auth: `<header | query param>`
- Payload shape: `<JSON schema>`
```

- [ ] **Step 3: If none of SSE/WS/long-poll exist, fall back to polling**

Document the fallback: daemon will GET `/sessions` every 30s and `GET /sessions/:id/messages?since=<cursor>` per session. Note: this is slower and loses near-realtime but still works. Adjust Task 5.4 accordingly.

### Task 5.2: Write `packages/daemon/src/logger.ts`

**Files:**
- Create: `packages/daemon/src/logger.ts`

- [ ] **Step 1: Create the file**

```ts
function ts() {
  return new Date().toISOString();
}

export const log = {
  info: (msg: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ ts: ts(), level: "info", msg, ...extra })),
  warn: (msg: string, extra: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ ts: ts(), level: "warn", msg, ...extra })),
  error: (msg: string, extra: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ ts: ts(), level: "error", msg, ...extra })),
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/logger.ts
git commit -m "feat(daemon): structured JSON logger"
```

### Task 5.3: Write `packages/daemon/src/forwarder.ts`

**Files:**
- Create: `packages/daemon/src/forwarder.ts`

- [ ] **Step 1: Create the forwarder**

```ts
import {
  INTERNAL_HEADER_SECRET,
  DAEMON_FORWARD_MAX_RETRIES,
  DAEMON_FORWARD_BACKOFF_MS,
  OnAudioResponseSchema,
  type OnAudioEvent,
  type OnAudioResponse,
} from "zapi-shared";
import { log } from "./logger";

const NEXT_URL = process.env.ZAPI_PWA_URL ?? "https://zapi-pwa.vercel.app";
const SECRET = process.env.INTERNAL_WEBHOOK_SECRET ?? "";

export async function forwardAudioEvent(event: OnAudioEvent): Promise<OnAudioResponse> {
  if (!SECRET) throw new Error("INTERNAL_WEBHOOK_SECRET not set");

  let lastErr: unknown;
  for (let attempt = 0; attempt < DAEMON_FORWARD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${NEXT_URL}/api/internal/on-audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_HEADER_SECRET]: SECRET,
        },
        body: JSON.stringify(event),
      });

      if (res.ok) {
        const parsed = OnAudioResponseSchema.safeParse(await res.json());
        if (parsed.success) return parsed.data;
        throw new Error("invalid response from Next");
      }

      // 4xx = permanent, do not retry
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Next returned ${res.status}: ${await res.text()}`);
      }

      // 5xx / network = retry
      lastErr = new Error(`Next returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }

    const backoff = DAEMON_FORWARD_BACKOFF_MS[attempt];
    if (backoff != null) {
      log.warn("retry forward", { attempt, backoff });
      await sleep(backoff);
    }
  }

  throw lastErr ?? new Error("unknown forward failure");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/forwarder.ts
git commit -m "feat(daemon): forwarder with retry/backoff"
```

### Task 5.4: Write `packages/daemon/src/waclaw-client.ts`

**Files:**
- Create: `packages/daemon/src/waclaw-client.ts`

- [ ] **Step 1: Create the client using the protocol validated in Task 5.1**

Default template assumes SSE. Adjust based on findings:

```ts
import { MAX_AUDIO_BYTES, type OnAudioEvent } from "zapi-shared";
import { log } from "./logger";

interface ConnectOptions {
  waclawUrl: string;
  apiKey: string;
  onAudioMessage: (event: OnAudioEvent) => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Subscribes to waclaw events and calls onAudioMessage for each audio.
 * Reconnects with exponential backoff on failure.
 */
export async function connectAndSubscribe(opts: ConnectOptions): Promise<void> {
  let backoffMs = 1000;
  const maxBackoffMs = 30_000;

  while (true) {
    try {
      await connect(opts);
      backoffMs = 1000;
    } catch (err) {
      opts.onError(err);
      log.warn("reconnecting", { backoff_ms: backoffMs });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }
}

async function connect(opts: ConnectOptions): Promise<void> {
  // TODO: replace with real protocol from Task 5.1
  const res = await fetch(`${opts.waclawUrl}/events`, {
    headers: {
      "X-API-Key": opts.apiKey,
      Accept: "text/event-stream",
    },
  });
  if (!res.ok || !res.body) {
    throw new Error(`waclaw /events responded ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("waclaw stream ended");

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const raw = JSON.parse(line.slice(6));
        const audio = extractAudioEvent(raw);
        if (audio) {
          opts.onAudioMessage(audio).catch((err) =>
            log.error("onAudioMessage threw", { err: String(err) })
          );
        }
      } catch (err) {
        log.warn("failed to parse event", { line, err: String(err) });
      }
    }
  }
}

/**
 * Converts a raw waclaw event into OnAudioEvent. Returns null if not audio,
 * too large, or missing critical fields.
 *
 * Adjust the field mapping to match the shape discovered in Task 5.1.
 */
function extractAudioEvent(raw: any): OnAudioEvent | null {
  if (raw?.type !== "message" || !raw?.message?.audio) return null;
  const m = raw.message;
  if (typeof m.audio.size_bytes === "number" && m.audio.size_bytes > MAX_AUDIO_BYTES) {
    log.warn("audio too large, skipping", { size: m.audio.size_bytes });
    return null;
  }
  return {
    waclaw_session_id: raw.session_id ?? "",
    message_id: m.id ?? "",
    chat_jid: m.chat_jid ?? "",
    chat_name: m.chat_name ?? "",
    sender_phone: m.from ?? "",
    sender_name: m.sender_name ?? null,
    from_me: Boolean(m.from_me),
    is_group: (m.chat_jid ?? "").endsWith("@g.us"),
    audio_url: m.audio.url ?? "",
    audio_duration_seconds: m.audio.duration_seconds ?? 0,
    timestamp: new Date(m.timestamp).toISOString(),
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/waclaw-client.ts
git commit -m "feat(daemon): waclaw event subscription client"
```

### Task 5.5: Write `packages/daemon/src/index.ts`

**Files:**
- Modify: `packages/daemon/src/index.ts` (replace placeholder)

- [ ] **Step 1: Replace with the real main**

```ts
import { connectAndSubscribe } from "./waclaw-client";
import { forwardAudioEvent } from "./forwarder";
import { log } from "./logger";

const WACLAW_URL = process.env.WACLAW_URL ?? "http://localhost:3100";
const WACLAW_API_KEY = process.env.WACLAW_API_KEY ?? "";

async function main() {
  log.info("daemon starting", { waclaw_url: WACLAW_URL });

  await connectAndSubscribe({
    waclawUrl: WACLAW_URL,
    apiKey: WACLAW_API_KEY,
    onAudioMessage: async (event) => {
      try {
        const result = await forwardAudioEvent(event);
        log.info("forwarded", { msg: event.message_id, status: result.status });
      } catch (err) {
        log.error("forward failed permanently", { msg: event.message_id, err: String(err) });
      }
    },
    onError: (err) => log.error("waclaw subscription error", { err: String(err) }),
  });
}

process.on("SIGTERM", () => {
  log.info("SIGTERM received, shutting down");
  process.exit(0);
});
process.on("SIGINT", () => {
  log.info("SIGINT received, shutting down");
  process.exit(0);
});

main().catch((err) => {
  log.error("fatal", { err: String(err) });
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/index.ts
git commit -m "feat(daemon): main bootstrap with signal handlers"
```

### Task 5.6: systemd unit file

**Files:**
- Create: `packages/daemon/systemd/zapi-pwa-daemon.service`

- [ ] **Step 1: Create the unit**

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

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/systemd/zapi-pwa-daemon.service
git commit -m "feat(daemon): systemd unit for worker5 deploy"
```

### Task 5.7: Deploy script

**Files:**
- Create: `scripts/deploy-daemon.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

WORKER="openclaw@100.66.83.22"
REMOTE_DIR="/home/openclaw/zapi-pwa"

echo "→ Pulling latest on worker5"
ssh "$WORKER" "cd $REMOTE_DIR && git pull origin main"

echo "→ Installing dependencies"
ssh "$WORKER" "cd $REMOTE_DIR && bun install"

echo "→ Restarting systemd service"
ssh "$WORKER" "sudo systemctl restart zapi-pwa-daemon"

echo "→ Status"
ssh "$WORKER" "systemctl status zapi-pwa-daemon --no-pager"

echo "✓ daemon deployed"
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/deploy-daemon.sh
git add scripts/deploy-daemon.sh
git commit -m "feat(daemon): deploy script for worker5"
```

### Task 5.8: First-time manual deploy on worker5

**No code changes — infrastructure setup.**

- [ ] **Step 1: Push local changes**

```bash
git push origin main
```

- [ ] **Step 2: SSH to worker5 and clone**

```bash
ssh openclaw@100.66.83.22
cd ~
# If already cloned in a previous phase, git pull instead.
git clone https://github.com/andrefogelman/zapi-pwa.git || (cd zapi-pwa && git pull)
cd zapi-pwa
bun install
```

- [ ] **Step 3: Create `.env` for daemon**

```bash
cat > packages/daemon/.env <<EOF
WACLAW_URL=http://localhost:3100
WACLAW_API_KEY=<the real waclaw key>
ZAPI_PWA_URL=https://zapi-pwa.vercel.app
INTERNAL_WEBHOOK_SECRET=<same value as Vercel env>
EOF
chmod 600 packages/daemon/.env
```

- [ ] **Step 4: Install the systemd unit**

```bash
sudo cp packages/daemon/systemd/zapi-pwa-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable zapi-pwa-daemon
sudo systemctl start zapi-pwa-daemon
sudo systemctl status zapi-pwa-daemon --no-pager
```

Expected: `active (running)`.

- [ ] **Step 5: Watch logs for a minute**

```bash
sudo journalctl -u zapi-pwa-daemon -f
```

Expected: JSON lines with `"level":"info"` and `"msg":"daemon starting"`. No immediate errors. If errors, fix and `systemctl restart`.

Press Ctrl+C when satisfied.

---

## Phase 6 — End-to-end smoke test

### Task 6.1: Family smoke test matrix

**No code changes — manual verification.**

- [ ] **Step 1: Create a test user from a different Google account**

From your logged-in Andre super-admin:
1. Navigate to `/admin/users`
2. Invite `<son's email>`
3. Log in as son in incognito; accept the invite link; land in `/app`

- [ ] **Step 2: Son creates first instance**

Expected: first-run wizard appears, son enters a name, QR code renders, scans with a test phone, status polls until "connected", chat UI replaces wizard.

- [ ] **Step 3: Son opens SettingsModal → Grupos tab**

Expected: "Buscar grupos do WhatsApp" button. Click, see list of groups. Import one. Set `transcribe_all=true`, `send_reply=true`.

- [ ] **Step 4: From a different phone, send an audio to the authorized group**

Expected within 15s:
- Audio appears in son's chat UI with transcription below
- WhatsApp group receives a reply message with the transcription + footer (son's default footer is `"Transcrição por IA by <son-name> 😜"`)

- [ ] **Step 5: Send audio to a group NOT in the authorized list**

Expected: audio appears in chat UI without transcription. No reply sent.

- [ ] **Step 6: Send a DM audio to the test phone from another number**

Expected: audio is transcribed AND a reply goes back to the DM sender with the footer.

- [ ] **Step 7: Test filter — `transcribe_all=false`**

Go back to Grupos tab, toggle `transcribe_all` off for the same group. From another phone, send audio. Expected: skipped (no transcription, no reply). Your own audio in that group is still transcribed.

- [ ] **Step 8: Test admin actions**

As Andre super-admin in `/admin/users`:
- Reset son's password → verify son gets email
- Disable son → verify son's next request redirects to `/login?disabled=1`
- Re-enable → verify son can log in again
- Promote son to super_admin → verify sidebar shows Admin link for son
- Demote son back

- [ ] **Step 9: Test self-protection**

As Andre:
- Try demoting yourself → expect 400 "cannot demote self"
- Try disabling yourself → expect 400 "cannot disable self"
- Try deleting yourself → expect 400 "cannot delete self"

- [ ] **Step 10: Test Neura editor**

Go to `/admin/neura`, change temperature from 0.5 to 0.3, save. Send a new audio. Check that `platform_config.neura_temperature = 0.3` in DB (`supabase db execute "SELECT neura_temperature FROM platform_config"`).

- [ ] **Step 11: Final commit and tag**

```bash
git tag -a v1.0.0-admin-multitenant -m "admin multi-tenant feature complete"
git push origin v1.0.0-admin-multitenant
```

---

## Self-review checklist (after plan completion)

- Spec coverage: all 6 sections from the spec have corresponding tasks. ✓
- Placeholder scan: no TBD / TODO / "implement later". Known TODO (waclaw protocol) is handled as a dedicated task (5.1). ✓
- Type consistency: `filterMessage` signature matches `FilterInstance`/`FilterGroup`/`FilterDecision` used in on-audio route. `OnAudioEvent` type is consistent between daemon, shared, and pwa. ✓
- No "similar to Task N" references — all code is embedded per task. ✓
- Every commit has exact file paths. ✓
- TDD used for pure functions (`filterMessage`, `formatReply`, shared validators). Integration testing via curl for routes. Manual smoke testing for UI. ✓
