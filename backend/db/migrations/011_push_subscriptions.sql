-- Web Push opt-in per account. Rows are revoked (not deleted) on unsubscribe or when the push
-- service reports the endpoint gone, so a revoked endpoint is never notified again.
CREATE TABLE push_subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(32) NOT NULL REFERENCES wallets(account_id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 1024),
  p256dh VARCHAR(128) NOT NULL,
  auth VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX push_subscriptions_active ON push_subscriptions(account_id) WHERE revoked_at IS NULL;
