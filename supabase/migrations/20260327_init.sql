-- Grupos autorizados
CREATE TABLE grupos_autorizados (
  group_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  subject_owner TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE grupos_autorizados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read grupos"
  ON grupos_autorizados FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert grupos"
  ON grupos_autorizados FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete grupos"
  ON grupos_autorizados FOR DELETE TO authenticated USING (true);

-- Z-API config (singleton)
CREATE TABLE zapi_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  token TEXT NOT NULL,
  webhook_token TEXT NOT NULL,
  connected_phone TEXT NOT NULL,
  my_phones TEXT[] NOT NULL DEFAULT '{}',
  my_lids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE zapi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read config"
  ON zapi_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update config"
  ON zapi_config FOR UPDATE TO authenticated USING (true);

-- Insert initial row (fill in real values via admin UI)
INSERT INTO zapi_config (instance_id, token, webhook_token, connected_phone, my_phones, my_lids)
VALUES ('', '', '', '5511993604399', '{5511993604399,551130833854}', '{249520503971936@lid}');
