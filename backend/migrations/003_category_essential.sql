ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_essential BOOLEAN NOT NULL DEFAULT true;

UPDATE categories
SET is_essential=false
WHERE kind='expense' AND sort_order IN (20, 70, 80, 90, 100);
