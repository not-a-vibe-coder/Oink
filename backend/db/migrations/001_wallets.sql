-- Core identity. The tag IS the account; the primary key gives atomic claim.
CREATE TABLE wallets (
    tag              VARCHAR(20) PRIMARY KEY
                     CHECK (tag ~ '^[a-z0-9_]{3,20}$'),
    public_key       VARCHAR(64) NOT NULL UNIQUE,
    keystore_version SMALLINT     NOT NULL DEFAULT 1,
    cipher           VARCHAR(32)  NOT NULL DEFAULT 'AES-256-GCM',
    ciphertext       TEXT         NOT NULL,
    nonce            TEXT         NOT NULL,
    kdf_salt         TEXT         NOT NULL,
    kdf_params       JSONB        NOT NULL,
    auth_key_hash    TEXT         NOT NULL,
    totp_secret_enc  TEXT         NOT NULL,
    totp_nonce       TEXT         NOT NULL,
    totp_last_step   BIGINT       NOT NULL DEFAULT 0,
    status           VARCHAR(16)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','locked','frozen')),
    display_name     VARCHAR(48),
    avatar_seed      VARCHAR(32),
    metadata         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ
);

CREATE INDEX idx_wallets_public_key ON wallets(public_key);
CREATE INDEX idx_wallets_created_at ON wallets(created_at DESC);

-- Short-lived enrollment state holds the server-encrypted authenticator secret before a tag
-- exists. It is also reused to enrol a replacement authenticator during phrase recovery.
CREATE TABLE enrollments (
    id              VARCHAR(40) PRIMARY KEY,
    totp_secret_enc TEXT        NOT NULL,
    totp_nonce      TEXT        NOT NULL,
    ip_hash         TEXT,
    consumed_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enrollments_expires_at ON enrollments(expires_at);

CREATE TABLE auth_challenges (
    id           VARCHAR(40) PRIMARY KEY,
    purpose      VARCHAR(16) NOT NULL DEFAULT 'unlock'
                 CHECK (purpose IN ('unlock','recover')),
    tag          VARCHAR(20),
    is_decoy     BOOLEAN     NOT NULL DEFAULT FALSE,
    sign_message TEXT,
    ip_hash      TEXT,
    consumed_at  TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_challenges_expires_at ON auth_challenges(expires_at);

-- Sessions grant access to account data only. They never authorize a transfer.
CREATE TABLE sessions (
    token_hash   TEXT        PRIMARY KEY,
    tag          VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    user_agent   TEXT,
    ip_hash      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_sessions_tag ON sessions(tag);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE login_attempts (
    id           BIGSERIAL PRIMARY KEY,
    tag          VARCHAR(20),
    ip_hash      TEXT,
    kind         VARCHAR(24) NOT NULL,
    succeeded    BOOLEAN     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_tag_time ON login_attempts(tag, created_at DESC);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip_hash, created_at DESC);
