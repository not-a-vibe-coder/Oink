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
