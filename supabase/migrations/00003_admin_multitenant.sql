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
-- /api/admin/users/[id]/role via supabase.rpc(). Validates that
-- the caller (via auth.uid()) is a super_admin, bumps the bypass
-- flag, then updates.
--
-- IMPORTANT: this function must be called with a USER JWT (not the
-- service role), because auth.uid() is NULL under the service role.
-- The admin routes in Phase 3 will create a user-scoped Supabase
-- client from the caller's Bearer token specifically for RPC calls.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  target_user_id UUID,
  new_role TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'no authenticated caller (did you call with service role?)';
  END IF;

  IF new_role NOT IN ('user', 'super_admin') THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = caller
      AND role = 'super_admin'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'caller is not super_admin';
  END IF;

  IF target_user_id = caller AND new_role != 'super_admin' THEN
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
-- Same constraint: must be called with a USER JWT, not service role.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_user_status(
  target_user_id UUID,
  new_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'no authenticated caller (did you call with service role?)';
  END IF;

  IF new_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'invalid status: %', new_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = caller
      AND role = 'super_admin'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'caller is not super_admin';
  END IF;

  IF target_user_id = caller AND new_status = 'disabled' THEN
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
  SET role = 'super_admin', updated_at = now()
  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'andre@anf.com.br');
END;
$$;
