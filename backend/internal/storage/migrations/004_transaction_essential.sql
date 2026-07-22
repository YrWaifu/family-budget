ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_essential BOOLEAN;

UPDATE transactions t
SET is_essential=c.is_essential
FROM categories c
WHERE t.category_id=c.id AND t.is_essential IS NULL;

ALTER TABLE transactions
  ALTER COLUMN is_essential SET DEFAULT true,
  ALTER COLUMN is_essential SET NOT NULL;
