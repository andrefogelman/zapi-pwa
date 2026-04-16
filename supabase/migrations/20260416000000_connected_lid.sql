-- Separate connected_lid from connected_phone.
-- Context: historically `connected_phone` was assumed to be E.164 but in
-- LID-addressed sessions WhatsApp may return `<digits>@lid`. Storing both
-- forms explicitly lets echo-prevention and contact matching consult either
-- without string-parsing the mixed column.

ALTER TABLE public.instances
  ADD COLUMN IF NOT EXISTS connected_lid TEXT;

COMMENT ON COLUMN public.instances.connected_phone IS
  'Phone number (E.164) of the connected WhatsApp account. May also contain @lid on legacy sessions — prefer connected_lid for LID checks.';
COMMENT ON COLUMN public.instances.connected_lid IS
  'Local Identifier (@lid form) of the connected WhatsApp account, when exposed by the server. Nullable.';
