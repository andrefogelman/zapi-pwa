-- Materialize drifted schema: tables that exist in prod but had no migration in this repo.
-- Source: supabase db dump --schema public (prod kzrdgugferddixtootqq), 2026-06-01.
-- Tables: group_messages, grupos_autorizados, scheduled_messages, scheduled_message_logs,
--   starred_messages, task_thread, waclaw_scheduled_messages, waclaw_transcriptions, zapi_config.
-- These already exist on the linked remote — mark applied there (do NOT re-run on prod):
--   supabase migration repair --status applied 20260601000000
-- On a fresh 'supabase db reset' this recreates them. CREATE TABLE uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "public"."group_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "text" NOT NULL,
    "group_name" "text" DEFAULT ''::"text" NOT NULL,
    "sender" "text" DEFAULT ''::"text" NOT NULL,
    "sender_name" "text" DEFAULT ''::"text" NOT NULL,
    "message_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


CREATE TABLE IF NOT EXISTS "public"."grupos_autorizados" (
    "group_id" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "subject_owner" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "group_lid" "text" DEFAULT ''::"text",
    "monitor_daily" boolean DEFAULT false NOT NULL,
    "transcribe_all" boolean DEFAULT false NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."scheduled_message_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scheduled_message_id" "uuid",
    "status" "text" NOT NULL,
    "error_message" "text",
    "executed_at" timestamp with time zone DEFAULT "now"()
);


CREATE TABLE IF NOT EXISTS "public"."scheduled_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient" "text" NOT NULL,
    "contact_name" "text" DEFAULT ''::"text" NOT NULL,
    "chat_jid" "text" DEFAULT ''::"text" NOT NULL,
    "content_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "media_url" "text",
    "media_filename" "text",
    "scheduled_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurrence_pattern" "text",
    "recurrence_interval" integer DEFAULT 1,
    "recurrence_days" integer[],
    "recurrence_end_date" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


CREATE TABLE IF NOT EXISTS "public"."starred_messages" (
    "user_id" "uuid" NOT NULL,
    "waclaw_session_id" "text" NOT NULL,
    "waclaw_msg_id" "text" NOT NULL,
    "chat_jid" "text" NOT NULL,
    "starred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."task_thread" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "waclaw_msg_id" "text",
    "from_jid" "text",
    "from_display_name" "text",
    "author_user_id" "uuid",
    "body" "text",
    "media_url" "text",
    "media_type" "text",
    "ts" bigint NOT NULL,
    "replied_to_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "task_thread_source_check" CHECK (("source" = ANY (ARRAY['wa_group'::"text", 'internal_comment'::"text"])))
);


CREATE TABLE IF NOT EXISTS "public"."waclaw_scheduled_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "waclaw_session_id" "text" NOT NULL,
    "chat_jid" "text" NOT NULL,
    "chat_name" "text",
    "text" "text",
    "scheduled_for" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "media_filename" "text",
    "media_mime_type" "text",
    "media_base64" "text",
    CONSTRAINT "waclaw_scheduled_messages_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text", 'canceled'::"text"])))
);


CREATE TABLE IF NOT EXISTS "public"."waclaw_transcriptions" (
    "waclaw_session_id" "text" NOT NULL,
    "waclaw_msg_id" "text" NOT NULL,
    "text" "text" NOT NULL,
    "summary" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."zapi_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "instance_id" "text" NOT NULL,
    "token" "text" NOT NULL,
    "webhook_token" "text" NOT NULL,
    "connected_phone" "text" NOT NULL,
    "my_phones" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "my_lids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "client_token" "text" DEFAULT ''::"text" NOT NULL,
    "neura_prompt" "text" DEFAULT ''::"text" NOT NULL,
    "neura_model" "text" DEFAULT 'gpt-4o'::"text" NOT NULL,
    "neura_temperature" real DEFAULT 0.5 NOT NULL,
    "neura_top_p" real DEFAULT 0.5 NOT NULL,
    "signature_text" "text" DEFAULT '


ALTER TABLE ONLY "public"."group_messages"
    ADD CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."grupos_autorizados"
    ADD CONSTRAINT "grupos_autorizados_pkey" PRIMARY KEY ("group_id");

ALTER TABLE ONLY "public"."scheduled_message_logs"
    ADD CONSTRAINT "scheduled_message_logs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."scheduled_messages"
    ADD CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."starred_messages"
    ADD CONSTRAINT "starred_messages_pkey" PRIMARY KEY ("user_id", "waclaw_session_id", "waclaw_msg_id");

ALTER TABLE ONLY "public"."task_thread"
    ADD CONSTRAINT "task_thread_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."task_thread"
    ADD CONSTRAINT "task_thread_task_id_waclaw_msg_id_key" UNIQUE ("task_id", "waclaw_msg_id");

ALTER TABLE ONLY "public"."waclaw_scheduled_messages"
    ADD CONSTRAINT "waclaw_scheduled_messages_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."waclaw_transcriptions"
    ADD CONSTRAINT "waclaw_transcriptions_pkey" PRIMARY KEY ("waclaw_session_id", "waclaw_msg_id");

ALTER TABLE ONLY "public"."zapi_config"
    ADD CONSTRAINT "zapi_config_pkey" PRIMARY KEY ("id");

CREATE INDEX "idx_group_messages_group_date" ON "public"."group_messages" USING "btree" ("group_id", "created_at" DESC);

CREATE INDEX "idx_starred_messages_session_chat" ON "public"."starred_messages" USING "btree" ("user_id", "waclaw_session_id", "chat_jid");

CREATE INDEX "idx_waclaw_scheduled_due" ON "public"."waclaw_scheduled_messages" USING "btree" ("status", "scheduled_for") WHERE ("status" = 'pending'::"text");

CREATE INDEX "idx_waclaw_scheduled_user_chat" ON "public"."waclaw_scheduled_messages" USING "btree" ("user_id", "waclaw_session_id", "chat_jid");

CREATE INDEX "idx_waclaw_transcriptions_session" ON "public"."waclaw_transcriptions" USING "btree" ("waclaw_session_id");

CREATE INDEX "task_thread_by_task_ts" ON "public"."task_thread" USING "btree" ("task_id", "ts" DESC);

ALTER TABLE ONLY "public"."scheduled_message_logs"
    ADD CONSTRAINT "scheduled_message_logs_scheduled_message_id_fkey" FOREIGN KEY ("scheduled_message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."starred_messages"
    ADD CONSTRAINT "starred_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."task_thread"
    ADD CONSTRAINT "task_thread_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."task_thread"
    ADD CONSTRAINT "task_thread_replied_to_id_fkey" FOREIGN KEY ("replied_to_id") REFERENCES "public"."task_thread"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."task_thread"
    ADD CONSTRAINT "task_thread_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."waclaw_scheduled_messages"
    ADD CONSTRAINT "waclaw_scheduled_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE POLICY "Auth delete scheduled" ON "public"."scheduled_messages" FOR DELETE TO "authenticated" USING (true);

CREATE POLICY "Auth insert scheduled" ON "public"."scheduled_messages" FOR INSERT TO "authenticated" WITH CHECK (true);

CREATE POLICY "Auth read logs" ON "public"."scheduled_message_logs" FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Auth read scheduled" ON "public"."scheduled_messages" FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Auth update scheduled" ON "public"."scheduled_messages" FOR UPDATE TO "authenticated" USING (true);

CREATE POLICY "Authenticated users can read grupos" ON "public"."grupos_autorizados" FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Only admin can delete grupos" ON "public"."grupos_autorizados" FOR DELETE TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") = 'andre@anf.com.br'::"text"));

CREATE POLICY "Only admin can insert grupos" ON "public"."grupos_autorizados" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'andre@anf.com.br'::"text"));

CREATE POLICY "Only admin can read config" ON "public"."zapi_config" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") = 'andre@anf.com.br'::"text"));

CREATE POLICY "Only admin can update config" ON "public"."zapi_config" FOR UPDATE TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") = 'andre@anf.com.br'::"text"));

CREATE POLICY "Only admin can update grupos" ON "public"."grupos_autorizados" FOR UPDATE USING ((("auth"."jwt"() ->> 'email'::"text") = 'andre@anf.com.br'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'andre@anf.com.br'::"text"));

CREATE POLICY "Users access transcriptions for their waclaw sessions" ON "public"."waclaw_transcriptions" TO "authenticated" USING (("waclaw_session_id" IN ( SELECT "instances"."waclaw_session_id"
   FROM "public"."instances"
  WHERE (("instances"."user_id" = "auth"."uid"()) AND ("instances"."waclaw_session_id" IS NOT NULL))))) WITH CHECK (("waclaw_session_id" IN ( SELECT "instances"."waclaw_session_id"
   FROM "public"."instances"
  WHERE (("instances"."user_id" = "auth"."uid"()) AND ("instances"."waclaw_session_id" IS NOT NULL)))));

CREATE POLICY "Users manage own stars" ON "public"."starred_messages" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "Users manage own waclaw scheduled messages" ON "public"."waclaw_scheduled_messages" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "Users see task_thread of accessible tasks" ON "public"."task_thread" USING ("public"."can_access_task"("task_id"));

ALTER TABLE "public"."group_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."grupos_autorizados" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."scheduled_message_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."scheduled_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."starred_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."task_thread" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."waclaw_scheduled_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."waclaw_transcriptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."zapi_config" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."group_messages" TO "anon";
GRANT ALL ON TABLE "public"."group_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."group_messages" TO "service_role";

GRANT ALL ON TABLE "public"."grupos_autorizados" TO "anon";
GRANT ALL ON TABLE "public"."grupos_autorizados" TO "authenticated";
GRANT ALL ON TABLE "public"."grupos_autorizados" TO "service_role";

GRANT ALL ON TABLE "public"."scheduled_message_logs" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_message_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_message_logs" TO "service_role";

GRANT ALL ON TABLE "public"."scheduled_messages" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_messages" TO "service_role";

GRANT ALL ON TABLE "public"."starred_messages" TO "anon";
GRANT ALL ON TABLE "public"."starred_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."starred_messages" TO "service_role";

GRANT ALL ON TABLE "public"."task_thread" TO "anon";
GRANT ALL ON TABLE "public"."task_thread" TO "authenticated";
GRANT ALL ON TABLE "public"."task_thread" TO "service_role";

GRANT ALL ON TABLE "public"."waclaw_scheduled_messages" TO "anon";
GRANT ALL ON TABLE "public"."waclaw_scheduled_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."waclaw_scheduled_messages" TO "service_role";

GRANT ALL ON TABLE "public"."waclaw_transcriptions" TO "anon";
GRANT ALL ON TABLE "public"."waclaw_transcriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."waclaw_transcriptions" TO "service_role";

GRANT ALL ON TABLE "public"."zapi_config" TO "anon";
GRANT ALL ON TABLE "public"."zapi_config" TO "authenticated";
GRANT ALL ON TABLE "public"."zapi_config" TO "service_role";

