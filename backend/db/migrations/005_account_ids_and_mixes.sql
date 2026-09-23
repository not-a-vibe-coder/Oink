-- Account IDs replace tags as the identity every table hangs off, and elections become
-- mixes (docs/12-IDENTITY-ESCROW-ADMIN.md §2, §7).
--
-- Wallets created before this keep their tag, get an account ID, and keep a keystore sealed
-- against the old tag-based AAD. The client falls back to that AAD for them, and re-seals
-- under the account ID the next time the password changes or the wallet is recovered.

-- Account IDs are identifiers, not secrets, so random() is enough for the backfill; new ones
-- come from crypto.randomBytes in lib/accountId.ts. Same alphabet and shape.
CREATE FUNCTION pg_temp.oink_account_id() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'oink-' || string_agg(
           substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + floor(random() * 32)::int, 1)
             || CASE WHEN i = 4 THEN '-' ELSE '' END,
           '' ORDER BY i)
  FROM generate_series(1, 8) AS i
$$;

-- ── wallets ─────────────────────────────────────────────────────────────────
ALTER TABLE wallets ADD COLUMN account_id VARCHAR(14);
UPDATE wallets SET account_id = pg_temp.oink_account_id();
ALTER TABLE wallets ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE wallets ADD CONSTRAINT wallets_account_id_check
  CHECK (account_id ~ '^oink-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$');

-- Detach everything that points at wallets(tag) before the key moves.
ALTER TABLE sessions           DROP CONSTRAINT sessions_tag_fkey;
ALTER TABLE elections          DROP CONSTRAINT elections_tag_fkey;
ALTER TABLE election_revisions DROP CONSTRAINT election_revisions_tag_fkey;
ALTER TABLE transfers          DROP CONSTRAINT transfers_sender_tag_fkey;
ALTER TABLE transfers          DROP CONSTRAINT transfers_recipient_tag_fkey;
ALTER TABLE fee_sponsorships   DROP CONSTRAINT fee_sponsorships_tag_fkey;
ALTER TABLE invoices           DROP CONSTRAINT invoices_creator_tag_fkey;

ALTER TABLE wallets DROP CONSTRAINT wallets_pkey;
ALTER TABLE wallets ADD PRIMARY KEY (account_id);
-- The tag is now an optional alias, arriving through X.
ALTER TABLE wallets ALTER COLUMN tag DROP NOT NULL;
ALTER TABLE wallets ADD CONSTRAINT wallets_tag_key UNIQUE (tag);
DROP INDEX IF EXISTS idx_wallets_public_key; -- duplicated the UNIQUE constraint's own index

-- ── enrollments: the account ID is reserved at enroll/start ────────────────
ALTER TABLE enrollments ADD COLUMN account_id VARCHAR(14);
UPDATE enrollments SET account_id = pg_temp.oink_account_id();
ALTER TABLE enrollments ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_account_id_key UNIQUE (account_id);

-- ── tables that referenced a tag: add account_id, fill it through the tag, drop the tag ──
ALTER TABLE auth_challenges ADD COLUMN account_id VARCHAR(14);
UPDATE auth_challenges c SET account_id = w.account_id FROM wallets w WHERE w.tag = c.tag;
ALTER TABLE auth_challenges DROP COLUMN tag;

ALTER TABLE sessions ADD COLUMN account_id VARCHAR(14);
UPDATE sessions s SET account_id = w.account_id FROM wallets w WHERE w.tag = s.tag;
ALTER TABLE sessions ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE sessions DROP COLUMN tag;
ALTER TABLE sessions ADD CONSTRAINT sessions_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES wallets(account_id) ON DELETE CASCADE;
CREATE INDEX idx_sessions_account ON sessions(account_id);

ALTER TABLE login_attempts ADD COLUMN account_id VARCHAR(14);
UPDATE login_attempts a SET account_id = w.account_id FROM wallets w WHERE w.tag = a.tag;
ALTER TABLE login_attempts DROP COLUMN tag;
CREATE INDEX idx_login_attempts_account_time ON login_attempts(account_id, created_at DESC);

ALTER TABLE elections RENAME TO mixes;
ALTER SEQUENCE elections_id_seq RENAME TO mixes_id_seq;
ALTER INDEX elections_pkey RENAME TO mixes_pkey;
ALTER TABLE mixes ADD COLUMN account_id VARCHAR(14);
UPDATE mixes m SET account_id = w.account_id FROM wallets w WHERE w.tag = m.tag;
ALTER TABLE mixes ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE mixes DROP COLUMN tag;
ALTER TABLE mixes ADD CONSTRAINT mixes_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES wallets(account_id) ON DELETE CASCADE;
CREATE INDEX idx_mixes_account_active ON mixes(account_id) WHERE is_active;

ALTER TABLE election_revisions RENAME TO mix_revisions;
ALTER SEQUENCE election_revisions_id_seq RENAME TO mix_revisions_id_seq;
ALTER INDEX election_revisions_pkey RENAME TO mix_revisions_pkey;
ALTER TABLE mix_revisions ADD COLUMN account_id VARCHAR(14);
UPDATE mix_revisions r SET account_id = w.account_id FROM wallets w WHERE w.tag = r.tag;
ALTER TABLE mix_revisions ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE mix_revisions DROP COLUMN tag;
ALTER TABLE mix_revisions ADD CONSTRAINT mix_revisions_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES wallets(account_id) ON DELETE CASCADE;
CREATE INDEX idx_mix_revisions_account ON mix_revisions(account_id, created_at DESC);

ALTER TABLE transfers ADD COLUMN sender_account_id VARCHAR(14);
ALTER TABLE transfers ADD COLUMN recipient_account_id VARCHAR(14);
UPDATE transfers t SET sender_account_id = w.account_id FROM wallets w WHERE w.tag = t.sender_tag;
UPDATE transfers t SET recipient_account_id = w.account_id FROM wallets w WHERE w.tag = t.recipient_tag;
ALTER TABLE transfers DROP COLUMN sender_tag;
ALTER TABLE transfers DROP COLUMN recipient_tag;
ALTER TABLE transfers RENAME COLUMN election_applied TO mix_applied;
ALTER TABLE transfers ADD CONSTRAINT transfers_sender_account_id_fkey
  FOREIGN KEY (sender_account_id) REFERENCES wallets(account_id) ON DELETE SET NULL;
ALTER TABLE transfers ADD CONSTRAINT transfers_recipient_account_id_fkey
  FOREIGN KEY (recipient_account_id) REFERENCES wallets(account_id) ON DELETE SET NULL;
-- 'held' marks deposits into and releases out of held-payment wallets (docs/12 §5).
ALTER TABLE transfers DROP CONSTRAINT transfers_source_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_source_check
  CHECK (source IN ('app','invoice','external','bot','held'));
CREATE INDEX idx_transfers_sender_account    ON transfers(sender_account_id, created_at DESC);
CREATE INDEX idx_transfers_recipient_account ON transfers(recipient_account_id, created_at DESC);
CREATE INDEX idx_transfers_created_at        ON transfers(created_at DESC);

ALTER TABLE fee_sponsorships ADD COLUMN account_id VARCHAR(14);
UPDATE fee_sponsorships f SET account_id = w.account_id FROM wallets w WHERE w.tag = f.tag;
ALTER TABLE fee_sponsorships ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE fee_sponsorships DROP COLUMN tag;
ALTER TABLE fee_sponsorships ADD CONSTRAINT fee_sponsorships_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES wallets(account_id) ON DELETE CASCADE;
CREATE INDEX idx_fee_sponsorships_account_day ON fee_sponsorships(account_id, day);

ALTER TABLE invoices ADD COLUMN creator_account_id VARCHAR(14);
ALTER TABLE invoices ADD COLUMN payer_account_id VARCHAR(14);
UPDATE invoices i SET creator_account_id = w.account_id FROM wallets w WHERE w.tag = i.creator_tag;
UPDATE invoices i SET payer_account_id = w.account_id FROM wallets w WHERE w.tag = i.payer_tag;
ALTER TABLE invoices ALTER COLUMN creator_account_id SET NOT NULL;
ALTER TABLE invoices DROP COLUMN creator_tag;
ALTER TABLE invoices DROP COLUMN payer_tag;
ALTER TABLE invoices RENAME COLUMN apply_election TO apply_mix;
ALTER TABLE invoices ADD CONSTRAINT invoices_creator_account_id_fkey
  FOREIGN KEY (creator_account_id) REFERENCES wallets(account_id) ON DELETE CASCADE;
CREATE INDEX idx_invoices_creator_account ON invoices(creator_account_id, created_at DESC);
