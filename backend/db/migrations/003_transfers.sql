CREATE TABLE transfers (
    id                 BIGSERIAL PRIMARY KEY,
    signature          VARCHAR(128) UNIQUE NOT NULL,

    direction          VARCHAR(16) NOT NULL
                       CHECK (direction IN ('send','receive','swap','deposit','withdraw')),

    sender_tag         VARCHAR(20) REFERENCES wallets(tag) ON DELETE SET NULL,
    sender_wallet      VARCHAR(64) NOT NULL,
    recipient_tag      VARCHAR(20) REFERENCES wallets(tag) ON DELETE SET NULL,
    recipient_wallet   VARCHAR(64) NOT NULL,

    input_mint         VARCHAR(64)    NOT NULL,
    input_symbol       VARCHAR(32)    NOT NULL,
    input_amount       NUMERIC(36,18) NOT NULL,

    -- [{symbol,mint,basisPoints,outAmount,outAmountFormatted,priceImpactPct,safeSettled}]
    output_breakdown   JSONB          NOT NULL DEFAULT '[]'::jsonb,

    election_applied   BOOLEAN        NOT NULL DEFAULT FALSE,
    fee_sponsored      BOOLEAN        NOT NULL DEFAULT FALSE,
    fee_lamports       BIGINT,
    memo               TEXT,
    source             VARCHAR(24)    NOT NULL DEFAULT 'app'
                       CHECK (source IN ('app','invoice','external','bot')),
    status             VARCHAR(24)    NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('pending','confirmed','failed')),
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    confirmed_at       TIMESTAMPTZ
);

CREATE INDEX idx_transfers_sender_tag    ON transfers(sender_tag, created_at DESC);
CREATE INDEX idx_transfers_recipient_tag ON transfers(recipient_tag, created_at DESC);
CREATE INDEX idx_transfers_sender_wallet ON transfers(sender_wallet);
CREATE INDEX idx_transfers_recipient_wallet ON transfers(recipient_wallet);

-- Daily fee-sponsorship budget, enforced by the fee payer service.
CREATE TABLE fee_sponsorships (
    id            BIGSERIAL PRIMARY KEY,
    tag           VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    signature     VARCHAR(128),
    lamports      BIGINT      NOT NULL,
    day           DATE        NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fee_sponsorships_tag_day ON fee_sponsorships(tag, day);
