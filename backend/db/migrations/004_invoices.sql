CREATE TABLE invoices (
    id               VARCHAR(64) PRIMARY KEY,     -- short, URL-safe (nanoid 12)
    creator_tag      VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    recipient_wallet VARCHAR(64) NOT NULL,

    amount           NUMERIC(36,18) NOT NULL,
    token_mint       VARCHAR(64) NOT NULL
                     DEFAULT 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    token_symbol     VARCHAR(16) NOT NULL DEFAULT 'USDC',
    memo             TEXT,

    apply_election   BOOLEAN     NOT NULL DEFAULT TRUE,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','expired','cancelled')),
    signature        VARCHAR(128),
    payer_wallet     VARCHAR(64),
    payer_tag        VARCHAR(20),

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL,
    paid_at          TIMESTAMPTZ
);

CREATE INDEX idx_invoices_creator_tag ON invoices(creator_tag, created_at DESC);
CREATE INDEX idx_invoices_status      ON invoices(status);
CREATE INDEX idx_invoices_expires_at  ON invoices(expires_at);
