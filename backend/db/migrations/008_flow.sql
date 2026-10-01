CREATE TABLE flow_settings (
  account_id VARCHAR(32) PRIMARY KEY REFERENCES wallets(account_id) ON DELETE CASCADE,
  cash_target_base NUMERIC(30,0) NOT NULL DEFAULT 0 CHECK (cash_target_base >= 0),
  weights JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(weights) = 'array'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE flow_invoices (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(32) NOT NULL REFERENCES wallets(account_id) ON DELETE CASCADE,
  recipient_wallet VARCHAR(64) NOT NULL,
  amount_base NUMERIC(30,0) NOT NULL CHECK (amount_base > 0),
  token_mint VARCHAR(64) NOT NULL,
  reference VARCHAR(64) NOT NULL UNIQUE,
  signature VARCHAR(128) UNIQUE,
  receipt_slot BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'paid') = (signature IS NOT NULL AND receipt_slot IS NOT NULL AND received_at IS NOT NULL))
);
CREATE TABLE flow_payments (
  id VARCHAR(64) PRIMARY KEY,
  invoice_id VARCHAR(64) NOT NULL UNIQUE REFERENCES flow_invoices(id) ON DELETE CASCADE,
  account_id VARCHAR(32) NOT NULL REFERENCES wallets(account_id) ON DELETE CASCADE,
  signature VARCHAR(128) NOT NULL UNIQUE,
  payment_base NUMERIC(30,0) NOT NULL CHECK (payment_base > 0),
  cash_base NUMERIC(30,0) NOT NULL CHECK (cash_base >= 0),
  investment_base NUMERIC(30,0) NOT NULL CHECK (investment_base >= 0),
  settings_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (payment_base = cash_base + investment_base)
);
CREATE TABLE flow_purchases (
  id VARCHAR(64) PRIMARY KEY,
  payment_id VARCHAR(64) NOT NULL REFERENCES flow_payments(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL CHECK (symbol IN ('SPYx','AAPLx','NVDAx')),
  amount_base NUMERIC(30,0) NOT NULL CHECK (amount_base > 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','deferred','approved','submitted','confirmed','failed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, symbol)
);
CREATE INDEX flow_payments_account_time ON flow_payments(account_id, created_at DESC);
CREATE INDEX flow_invoices_account_time ON flow_invoices(account_id, created_at DESC);
CREATE INDEX flow_purchases_payment_state ON flow_purchases(payment_id, state);
