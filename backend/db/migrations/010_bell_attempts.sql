CREATE TABLE bell_attempts (
  id VARCHAR(64) PRIMARY KEY,
  purchase_id VARCHAR(64) NOT NULL REFERENCES flow_purchases(id) ON DELETE CASCADE,
  quote_id VARCHAR(64) NOT NULL REFERENCES bell_quotes(id) ON DELETE CASCADE,
  account_id VARCHAR(32) NOT NULL REFERENCES wallets(account_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','submitted','confirmed','failed','expired','superseded','cancelled')),
  unsigned_transaction TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  blockhash VARCHAR(64) NOT NULL,
  last_valid_block_height BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  simulation JSONB NOT NULL,
  signature VARCHAR(128) UNIQUE,
  receipt JSONB,
  reason TEXT,
  submitted_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((state = 'submitted') IS NOT TRUE OR (signature IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE UNIQUE INDEX bell_one_active_attempt ON bell_attempts(purchase_id) WHERE state IN ('prepared','submitted');
CREATE INDEX bell_attempts_account_time ON bell_attempts(account_id, created_at DESC);
ALTER TABLE flow_purchases ADD COLUMN attempt_id VARCHAR(64) REFERENCES bell_attempts(id) ON DELETE SET NULL;
