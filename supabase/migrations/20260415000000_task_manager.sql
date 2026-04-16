-- ============================================================
-- Migration: Task Manager (full relational)
-- 5 tables: tasks, task_participants, task_conversations,
-- task_messages, task_comments.
-- ============================================================

-- ------------------------------------------------------------
-- tasks: core task entity
-- ------------------------------------------------------------
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to UUID REFERENCES auth.users(id),
  due_date TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_creator ON public.tasks(creator_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- task_participants: link WA contacts or PWA users to a task
-- Exactly one of (user_id) or (contact_jid + instance_id) is set.
-- ------------------------------------------------------------
CREATE TABLE public.task_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_jid TEXT,
  instance_id UUID REFERENCES public.instances(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('owner', 'assignee', 'participant', 'observer')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id),
  UNIQUE (task_id, contact_jid, instance_id)
);

CREATE INDEX idx_task_participants_task ON public.task_participants(task_id);
CREATE INDEX idx_task_participants_user ON public.task_participants(user_id);

ALTER TABLE public.task_participants ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- task_conversations: link chats/groups to a task
-- ------------------------------------------------------------
CREATE TABLE public.task_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  chat_name TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, instance_id, chat_jid)
);

CREATE INDEX idx_task_conversations_task ON public.task_conversations(task_id);

ALTER TABLE public.task_conversations ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- task_messages: pin specific WA messages as evidence/context
-- ------------------------------------------------------------
CREATE TABLE public.task_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  waclaw_msg_id TEXT NOT NULL,
  waclaw_session_id TEXT NOT NULL,
  snippet TEXT,
  sender_name TEXT,
  message_ts TIMESTAMPTZ,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, waclaw_msg_id, waclaw_session_id)
);

CREATE INDEX idx_task_messages_task ON public.task_messages(task_id);

ALTER TABLE public.task_messages ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- task_comments: forum/thread discussion per task
-- ------------------------------------------------------------
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  ref_waclaw_msg_id TEXT,
  ref_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_comments_task ON public.task_comments(task_id);

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Helper: can_access_task — true if creator or participant
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_task(tid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks WHERE id = tid AND creator_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.task_participants WHERE task_id = tid AND user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- RLS policies: tasks
-- ------------------------------------------------------------
CREATE POLICY "Read tasks user can access"
  ON public.tasks FOR SELECT TO authenticated
  USING (public.can_access_task(id));

CREATE POLICY "Creator inserts tasks"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creator or admin updates tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (creator_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "Creator or admin deletes tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (creator_id = auth.uid() OR public.is_super_admin());

-- ------------------------------------------------------------
-- RLS policies: child tables inherit access via can_access_task
-- ------------------------------------------------------------
CREATE POLICY "Access task_participants"
  ON public.task_participants FOR ALL TO authenticated
  USING (public.can_access_task(task_id))
  WITH CHECK (public.can_access_task(task_id));

CREATE POLICY "Access task_conversations"
  ON public.task_conversations FOR ALL TO authenticated
  USING (public.can_access_task(task_id))
  WITH CHECK (public.can_access_task(task_id));

CREATE POLICY "Access task_messages"
  ON public.task_messages FOR ALL TO authenticated
  USING (public.can_access_task(task_id))
  WITH CHECK (public.can_access_task(task_id));

CREATE POLICY "Access task_comments"
  ON public.task_comments FOR ALL TO authenticated
  USING (public.can_access_task(task_id))
  WITH CHECK (public.can_access_task(task_id));

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;

-- ------------------------------------------------------------
-- Auto-update trigger (reuses existing function if available)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_tasks_modtime
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

CREATE TRIGGER update_task_comments_modtime
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
