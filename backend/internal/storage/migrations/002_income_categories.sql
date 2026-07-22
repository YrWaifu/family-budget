ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'expense'
  CHECK (kind IN ('expense', 'income'));

UPDATE categories SET kind='expense' WHERE kind IS NULL OR kind='';

INSERT INTO categories (name, icon, color, kind, sort_order)
SELECT 'Зарплата', 'WalletCards', '#22c55e', 'income', 10
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Зарплата' AND kind='income');

INSERT INTO categories (name, icon, color, kind, sort_order)
SELECT 'Другое', 'CircleEllipsis', '#38bdf8', 'income', 20
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Другое' AND kind='income');
