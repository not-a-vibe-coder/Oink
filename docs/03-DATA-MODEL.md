# OINK — Data Model

Fresh PostgreSQL database. **Nothing is migrated from TENDER's database.** Forward-only
numbered migrations in `backend/db/migrations/`, applied by the runner ported from
`backend/src/db/migrate.ts`.

Conventions carried over from TENDER: `TIMESTAMPTZ` everywhere, `JSONB` for open blobs,
basis points as integers, lowercase-normalised identifiers, explicit indexes.

---

## 001_wallets.sql

```sql
-- Core identity. The tag IS the account; the primary key gives atomic claim.
CREATE TABLE wallets (
    tag              VARCHAR(20) PRIMARY KEY
                     CHECK (tag ~ '^[a-z0-9_]{3,20}$'),
    public_key       VARCHAR(64) NOT NULL UNIQUE,

    -- Encrypted keystore. Server can never decrypt any of this.
    keystore_version SMALLINT     NOT NULL DEFAULT 1,
    cipher           VARCHAR(32)  NOT NULL DEFAULT 'AES-256-GCM',
    ciphertext       TEXT         NOT NULL,          -- base64
    nonce            TEXT         NOT NULL,          -- base64, 12 bytes
    kdf_salt         TEXT         NOT NULL,          -- base64, 16 bytes
    kdf_params       JSONB        NOT NULL,          -- {alg,v,m,t,p,len}

    -- Password proof. Argon2id over the client-derived authKey.
    auth_key_hash    TEXT         NOT NULL,

    -- Second factor. Secret is AES-256-GCM sealed with OINK_KMS_KEY.
    totp_secret_enc  TEXT         NOT NULL,
    totp_nonce       TEXT         NOT NULL,
    totp_last_step   BIGINT       NOT NULL DEFAULT 0,

    status           VARCHAR(16)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','locked','frozen')),
    display_name     VARCHAR(48),
    avatar_seed      VARCHAR(32),                    -- deterministic pig avatar
    metadata         JSONB        NOT NULL DEFAULT '{}'::jsonb,

    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ
);

CREATE INDEX idx_wallets_public_key ON wallets(public_key);
CREATE INDEX idx_wallets_created_at ON wallets(created_at DESC);

-- There is no recovery-code table by design. The 12-word secret phrase is the only
-- fallback: it reproduces the keypair, and an Ed25519 signature over a server nonce
-- proves ownership of the tag. See 02-WALLET-AND-AUTH-SPEC.md §6.

-- Short-lived enrollment state. Holds the TOTP secret before a tag exists.
-- Also used during secret-phrase recovery, to enrol a replacement authenticator.
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

-- Single-use challenges for unlock and for secret-phrase recovery.
CREATE TABLE auth_challenges (
    id          VARCHAR(40) PRIMARY KEY,
    purpose     VARCHAR(16) NOT NULL DEFAULT 'unlock'
                CHECK (purpose IN ('unlock','recover')),
    tag         VARCHAR(20),                 -- NULL for a decoy challenge
    is_decoy    BOOLEAN     NOT NULL DEFAULT FALSE,
    -- 'recover' only: the exact text the client must sign with the restored keypair.
    sign_message TEXT,
    ip_hash     TEXT,
    consumed_at TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_challenges_expires_at ON auth_challenges(expires_at);

-- Sessions. Read-scope only; never authorises moving funds.
CREATE TABLE sessions (
    token_hash   TEXT        PRIMARY KEY,      -- sha256 of the opaque token
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

-- Throttling ledger for unlock and enrollment.
CREATE TABLE login_attempts (
    id           BIGSERIAL PRIMARY KEY,
    tag          VARCHAR(20),
    ip_hash      TEXT,
    kind         VARCHAR(24) NOT NULL,   -- 'unlock' | 'enroll' | 'totp' | 'recover'
    succeeded    BOOLEAN     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_attempts_tag_time ON login_attempts(tag, created_at DESC);
CREATE INDEX idx_login_attempts_ip_time  ON login_attempts(ip_hash, created_at DESC);
```

---

## 002_elections.sql

Direct descendant of TENDER's `handle_elections`. Same basis-points contract: active rows
for one tag must sum to exactly `10000`.

```sql
CREATE TABLE elections (
    id            BIGSERIAL PRIMARY KEY,
    tag           VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    asset_symbol  VARCHAR(32) NOT NULL,
    asset_mint    VARCHAR(64) NOT NULL,
    decimals      SMALLINT    NOT NULL DEFAULT 6,
    basis_points  INTEGER     NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_elections_tag_active ON elections(tag) WHERE is_active;

-- Audit trail of election changes, for the activity feed.
CREATE TABLE election_revisions (
    id         BIGSERIAL PRIMARY KEY,
    tag        VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    snapshot   JSONB       NOT NULL,   -- [{symbol,mint,basisPoints}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_election_revisions_tag ON election_revisions(tag, created_at DESC);
```

**Update rule (ported):** deactivate all rows for the tag, insert the new set, write a
revision. Reject any set that does not sum to 10000.

---

## 003_transfers.sql

Replaces TENDER's `settlements`. One row per confirmed on-chain movement.

```sql
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
```

---

## 004_invoices.sql

Adapted from TENDER's `invoices` — tag-keyed instead of handle-keyed.

```sql
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
```

---

## 005_social.sql

Quality-of-life tables. Not on the critical path — build after Phase 4.

```sql
-- Address book of tags the user has paid.
CREATE TABLE contacts (
    id          BIGSERIAL PRIMARY KEY,
    owner_tag   VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    contact_tag VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    nickname    VARCHAR(48),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_tag, contact_tag)
);

-- Requests for money: "@ada asks @pascal for 20 USDC".
CREATE TABLE payment_requests (
    id            VARCHAR(64) PRIMARY KEY,
    from_tag      VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    to_tag        VARCHAR(20) NOT NULL REFERENCES wallets(tag) ON DELETE CASCADE,
    amount        NUMERIC(36,18) NOT NULL,
    token_symbol  VARCHAR(16) NOT NULL DEFAULT 'USDC',
    memo          TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','declined','expired')),
    signature     VARCHAR(128),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_payment_requests_to   ON payment_requests(to_tag, status);
CREATE INDEX idx_payment_requests_from ON payment_requests(from_tag, status);
```

---

## 006_bot.sql — Phase 2 only

Do not build this until the core wallet ships. See `07-OINKBOT-X.md`.

```sql
CREATE TABLE x_links (
    tag         VARCHAR(20) PRIMARY KEY REFERENCES wallets(tag) ON DELETE CASCADE,
    x_user_id   VARCHAR(64) NOT NULL UNIQUE,
    x_username  VARCHAR(64) NOT NULL,
    scopes      TEXT[]      NOT NULL DEFAULT '{}',
    linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_x_links_username ON x_links(LOWER(x_username));

-- The bot stages an intent; the user confirms it in the app, where the key lives.
CREATE TABLE bot_intents (
    id             VARCHAR(64) PRIMARY KEY,
    source_ref     VARCHAR(128) UNIQUE,      -- tweet id, for idempotency
    author_x_id    VARCHAR(64),
    author_tag     VARCHAR(20) REFERENCES wallets(tag) ON DELETE CASCADE,
    action         VARCHAR(24) NOT NULL,     -- 'send' | 'buy' | 'sell' | 'elect'
    target_tag     VARCHAR(20),
    amount         NUMERIC(36,18),
    token_symbol   VARCHAR(32),
    memo           TEXT,
    parsed         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status         VARCHAR(24) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','executed','dismissed','expired')),
    signature      VARCHAR(128),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_bot_intents_author_tag ON bot_intents(author_tag, status);

CREATE TABLE x_bot_tokens (
    id            VARCHAR(32) PRIMARY KEY DEFAULT 'default',
    access_token  TEXT        NOT NULL,
    refresh_token TEXT        NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE x_bot_cursors (
    stream       VARCHAR(64) PRIMARY KEY,
    last_seen_id VARCHAR(128) NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

---

## Retention and hygiene

A scheduled job (or a cheap `pg_cron` entry) runs hourly:

```sql
DELETE FROM enrollments     WHERE expires_at < NOW() - INTERVAL '1 day';
DELETE FROM auth_challenges WHERE expires_at < NOW() - INTERVAL '1 day';
DELETE FROM sessions        WHERE expires_at < NOW() - INTERVAL '30 days';
DELETE FROM login_attempts  WHERE created_at < NOW() - INTERVAL '30 days';
UPDATE invoices SET status = 'expired'
  WHERE status = 'pending' AND expires_at < NOW();
```

**Never delete `wallets` rows.** A deleted wallet row is a permanently unrecoverable user
wallet. Account closure sets `status = 'frozen'` and nothing else.
