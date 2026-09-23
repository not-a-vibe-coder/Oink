-- Linked identities and the admin dashboard (docs/12-IDENTITY-ESCROW-ADMIN.md §3, §4, §8).

-- Both identities are proven through a Privy identity token, never typed in. Email is stored
-- lowercased; X is keyed by the numeric X user ID because usernames can be renamed.
ALTER TABLE wallets ADD COLUMN email           VARCHAR(254);
ALTER TABLE wallets ADD COLUMN email_linked_at TIMESTAMPTZ;
ALTER TABLE wallets ADD COLUMN x_user_id       VARCHAR(32);
ALTER TABLE wallets ADD COLUMN x_username      VARCHAR(32);
ALTER TABLE wallets ADD COLUMN x_linked_at     TIMESTAMPTZ;
ALTER TABLE wallets ADD CONSTRAINT wallets_email_key UNIQUE (email);
ALTER TABLE wallets ADD CONSTRAINT wallets_x_user_id_key UNIQUE (x_user_id);
ALTER TABLE wallets ADD CONSTRAINT wallets_email_lower CHECK (email = lower(email));

-- Things that happened to an account, for the admin activity feed. Never holds key
-- material or credentials: kinds and small non-secret details only.
CREATE TABLE account_events (
    id          BIGSERIAL PRIMARY KEY,
    account_id  VARCHAR(14) REFERENCES wallets(account_id) ON DELETE SET NULL,
    kind        VARCHAR(32) NOT NULL,
    detail      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip_hash     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_events_created_at ON account_events(created_at DESC);
CREATE INDEX idx_account_events_account ON account_events(account_id, created_at DESC);

-- Admin sessions are separate from wallet sessions: neither grants the other.
CREATE TABLE admin_sessions (
    token_hash   TEXT         PRIMARY KEY,
    email        VARCHAR(254) NOT NULL,
    user_agent   TEXT,
    ip_hash      TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ  NOT NULL,
    revoked_at   TIMESTAMPTZ
);

-- An admin's verdict on one activity item or transfer.
CREATE TABLE admin_reviews (
    source       VARCHAR(16)  NOT NULL CHECK (source IN ('event','login','transfer')),
    source_id    BIGINT       NOT NULL,
    status       VARCHAR(16)  NOT NULL CHECK (status IN ('reviewed','flagged')),
    note         TEXT,
    admin_email  VARCHAR(254) NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, source_id)
);

-- Every admin login, table read and action.
CREATE TABLE admin_audit (
    id          BIGSERIAL PRIMARY KEY,
    admin_email VARCHAR(254) NOT NULL,
    action      VARCHAR(48)  NOT NULL,
    detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    ip_hash     TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_created_at ON admin_audit(created_at DESC);

-- One row per request admitted by an IP rate limiter. The limiter used to count
-- login_attempts by its own kind, which only the unlock and recover routes ever wrote, so
-- the challenge and enroll limits never engaged. Rows older than a day are pruned.
CREATE TABLE rate_limit_hits (
    id          BIGSERIAL PRIMARY KEY,
    bucket      VARCHAR(32) NOT NULL,
    ip_hash     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_hits_lookup ON rate_limit_hits(bucket, ip_hash, created_at DESC);
