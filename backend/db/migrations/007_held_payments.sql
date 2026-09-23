-- Paying an email or X account that has no Oink wallet yet (docs/12-IDENTITY-ESCROW-ADMIN.md §5, §6).

-- One Privy wallet per recipient identity, created ahead of their sign-up. Our refund signer
-- is an additional signer on it, limited by its policy to token transfers into the
-- destinations listed in allowed_destinations (senders' token accounts, then the claimant's).
CREATE TABLE held_wallets (
    id                   BIGSERIAL    PRIMARY KEY,
    identity_kind        VARCHAR(8)   NOT NULL CHECK (identity_kind IN ('email','x')),
    identity_value       VARCHAR(254) NOT NULL,   -- lowercased email, or the numeric X user ID
    identity_display     VARCHAR(254) NOT NULL,   -- the email, or @username as last seen
    privy_user_id        VARCHAR(80)  NOT NULL,
    privy_wallet_id      VARCHAR(80)  NOT NULL,
    address              VARCHAR(64)  NOT NULL UNIQUE,
    policy_id            VARCHAR(80)  NOT NULL,
    policy_rule_id       VARCHAR(80)  NOT NULL,
    allowed_destinations JSONB        NOT NULL DEFAULT '[]'::jsonb,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (identity_kind, identity_value)
);

-- One row per payment. The holding wallet pools every payment to the same person, so this
-- table, not the on-chain balance, is what says how much belongs to whom.
CREATE TABLE held_payments (
    id                         BIGSERIAL      PRIMARY KEY,
    held_wallet_id             BIGINT         NOT NULL REFERENCES held_wallets(id),
    sender_account_id          VARCHAR(14)    REFERENCES wallets(account_id) ON DELETE SET NULL,
    sender_wallet              VARCHAR(64)    NOT NULL,
    recipient_kind             VARCHAR(8)     NOT NULL CHECK (recipient_kind IN ('email','x')),
    recipient_value            VARCHAR(254)   NOT NULL,
    recipient_display          VARCHAR(254)   NOT NULL,
    mint                       VARCHAR(64)    NOT NULL,
    symbol                     VARCHAR(32)    NOT NULL,
    decimals                   SMALLINT       NOT NULL,
    amount_base                NUMERIC(40,0)  NOT NULL CHECK (amount_base > 0),
    deposit_signature          VARCHAR(128)   NOT NULL UNIQUE,
    note                       TEXT,
    -- held → claiming → claimed, or held → refunding → refunded. claiming/refunding are held
    -- only while a release is in flight; failed needs an admin retry.
    status                     VARCHAR(16)    NOT NULL DEFAULT 'held'
                               CHECK (status IN ('held','claiming','claimed','refunding','refunded','failed')),
    claimant_account_id        VARCHAR(14)    REFERENCES wallets(account_id) ON DELETE SET NULL,
    release_to                 VARCHAR(64),
    release_signature          VARCHAR(128),
    release_last_valid_height  BIGINT,
    attempts                   INTEGER        NOT NULL DEFAULT 0,
    last_error                 TEXT,
    notified_at                TIMESTAMPTZ,
    expires_at                 TIMESTAMPTZ    NOT NULL,
    released_at                TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_held_payments_due ON held_payments(status, expires_at);
CREATE INDEX idx_held_payments_recipient ON held_payments(recipient_kind, recipient_value) WHERE status = 'held';
CREATE INDEX idx_held_payments_sender ON held_payments(sender_account_id, created_at DESC);

ALTER TABLE admin_reviews DROP CONSTRAINT admin_reviews_source_check;
ALTER TABLE admin_reviews ADD CONSTRAINT admin_reviews_source_check
  CHECK (source IN ('event','login','transfer','held'));
