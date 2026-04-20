-- Add a sort_order column to instances so the user can reorder the
-- instance tabs and pick the one that loads first when the app opens.
-- Lower value = earlier. Ties fall back to created_at ascending.

ALTER TABLE public.instances
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Seed existing rows so their current visual order (by created_at) is
-- preserved on first load after this migration.
UPDATE public.instances
SET sort_order = subq.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS rn
  FROM public.instances
) subq
WHERE public.instances.id = subq.id;
