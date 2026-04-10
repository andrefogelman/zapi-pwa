-- ============================================================
-- INSTANCES: Each user's WhatsApp connection via Z-API
-- ============================================================
CREATE TABLE public.instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Minha Instância',
  zapi_instance_id TEXT NOT NULL,
  zapi_token TEXT NOT NULL,
  zapi_client_token TEXT,
  session_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connecting', 'connected', 'disconnected')),
  connected_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own instances"
  ON public.instances FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- MESSAGES: Incoming/outgoing WhatsApp messages
-- ============================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender TEXT,
  text TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  from_me BOOLEAN NOT NULL DEFAULT false,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_instance_chat ON public.messages(instance_id, chat_jid);
CREATE INDEX idx_messages_status ON public.messages(status);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own instance messages"
  ON public.messages FOR ALL TO authenticated
  USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

-- ============================================================
-- TRANSCRIPTIONS: Audio transcription results
-- ============================================================
CREATE TABLE public.transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  summary TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transcriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own transcriptions"
  ON public.transcriptions FOR ALL TO authenticated
  USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

-- ============================================================
-- PUSH_SUBSCRIPTIONS: Web Push notification endpoints
-- ============================================================
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_instances_modtime
  BEFORE UPDATE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ============================================================
-- Enable Realtime for messages and transcriptions
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transcriptions;
