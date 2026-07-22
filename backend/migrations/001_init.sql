CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  icon TEXT NOT NULL CHECK (char_length(icon) BETWEEN 1 AND 40),
  color TEXT NOT NULL CHECK (char_length(color) BETWEEN 4 AND 24),
  kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  category_id BIGINT NOT NULL REFERENCES categories(id),
  comment TEXT NOT NULL DEFAULT '' CHECK (char_length(comment) <= 240),
  transaction_date TIMESTAMPTZ NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transactions_date_idx ON transactions (transaction_date DESC);
CREATE INDEX transactions_category_idx ON transactions (category_id);

CREATE TABLE monthly_budgets (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

CREATE TABLE saving_goals (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  target_amount_cents BIGINT NOT NULL CHECK (target_amount_cents > 0),
  current_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (current_amount_cents >= 0),
  icon TEXT NOT NULL DEFAULT 'PiggyBank',
  color TEXT NOT NULL DEFAULT '#38bdf8',
  deadline DATE,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recurring_payments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  category_id BIGINT NOT NULL REFERENCES categories(id),
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categories (name, icon, color, sort_order) VALUES
  ('Продукты', 'ShoppingBasket', '#22c55e', 10),
  ('Доставка и кафе', 'Utensils', '#f97316', 20),
  ('Животные', 'Heart', '#ec4899', 30),
  ('Машина', 'Car', '#3b82f6', 40),
  ('Дом и ЖКХ', 'Home', '#14b8a6', 50),
  ('Здоровье', 'HeartPulse', '#ef4444', 60),
  ('Маркетплейсы и покупки', 'ShoppingBag', '#8b5cf6', 70),
  ('Развлечения и поездки', 'Plane', '#06b6d4', 80),
  ('Одежда и косметика', 'Shirt', '#f43f5e', 90),
  ('Подарки', 'Gift', '#eab308', 100),
  ('Подписки и связь', 'Wifi', '#6366f1', 110),
  ('Другое', 'CircleEllipsis', '#64748b', 120)
ON CONFLICT DO NOTHING;

INSERT INTO categories (name, icon, color, kind, sort_order) VALUES
  ('Зарплата', 'WalletCards', '#22c55e', 'income', 10),
  ('Другое', 'CircleEllipsis', '#38bdf8', 'income', 20)
ON CONFLICT DO NOTHING;
