CREATE TABLE bell_quotes (
  id VARCHAR(64) PRIMARY KEY,
  purchase_id VARCHAR(64) NOT NULL REFERENCES flow_purchases(id) ON DELETE CASCADE,
  account_id VARCHAR(32) NOT NULL REFERENCES wallets(account_id) ON DELETE CASCADE,
  policy JSONB NOT NULL,
  brief JSONB NOT NULL,
  provider_build JSONB,
  decision TEXT NOT NULL CHECK (decision IN ('pass','defer','unavailable')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE flow_purchases ADD COLUMN quote_id VARCHAR(64) REFERENCES bell_quotes(id) ON DELETE SET NULL;
CREATE INDEX bell_quotes_purchase_time ON bell_quotes(purchase_id, created_at DESC);
