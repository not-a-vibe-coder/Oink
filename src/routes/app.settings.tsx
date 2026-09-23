import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, LogOut } from "lucide-react";
import { CopyButton } from "@/components/oink/CopyButton";
import { CodeField, PasswordField } from "@/components/oink/fields";
import { useDeviceSessions, useLogout, useRevokeSession } from "@/hooks/useOink";
import { useWalletSession } from "@/lib/app-session";
import { fromEntropy } from "@/lib/crypto/mnemonic";
import { authChallenge, revealKeystore, rotateKeystore } from "@/lib/oink-server-fns";
import { describeDevice, timeAgo } from "@/lib/format";
import {
  deriveKeys,
  fromBase64,
  openKeystore,
  randomSalt,
  sealKeystore,
  zero,
  KDF_V1,
} from "@/lib/wallet/credentials";
import { lock } from "@/lib/wallet/key-session";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { accountId, tag, publicKey } = useWalletSession();
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <main className="stage stage-wide">
      <header className="page-head">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">
          Everything that decides who can open this wallet, and how you take it somewhere else.
        </p>
      </header>

      <div className="stack">
        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
            Account
          </h2>
          <div className="panel">
            <div className="row-between">
              <div>
                <p className="ledger-title mono">{accountId}</p>
                <p className="meta" style={{ marginTop: 4 }}>
                  Your account ID. Sign in with it on any device
                  {tag ? <>, or with @{tag}</> : null}.
                </p>
              </div>
              <CopyButton value={accountId} label="Copy" className="btn btn-quiet btn-sm" />
            </div>
          </div>
        </section>

        <ChangePassword accountId={accountId} tag={tag} publicKey={publicKey} />
        <RevealPhrase accountId={accountId} tag={tag} publicKey={publicKey} />
        <Devices />

        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
            Auto-lock
          </h2>
          <div className="panel">
            <p className="meta">
              Your key leaves memory after 15 minutes of no activity, and whenever you close the
              tab. Your session stays signed in, so balances still load — sending asks for your
              password again.
            </p>
          </div>
        </section>

        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
            Connections
          </h2>
          <div className="panel">
            <div className="row-between">
              <div>
                <p className="ledger-title">X / Oinkbot</p>
                <p className="meta" style={{ marginTop: 4 }}>
                  Pay by mention, once it ships. Never required to use Oink.
                </p>
              </div>
              <span className="badge">Coming soon</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
            Lost your authenticator
          </h2>
          <div className="panel">
            <p className="meta">
              There are no backup codes, by design. Your 12-word phrase restores the wallet with a
              new password and a new authenticator, and keeps your account ID, tag, address and balance.
            </p>
            <Link
              to="/unlock/restore"
              className="btn btn-outline btn-sm"
              style={{ marginTop: "var(--s3)" }}
            >
              Restore with my phrase
            </Link>
          </div>
        </section>

        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
            This device
          </h2>
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={logout.isPending}
            onClick={async () => {
              lock();
              await logout.mutateAsync();
              void navigate({ to: "/unlock" });
            }}
          >
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </section>
      </div>
    </main>
  );
}

// ── Change password ────────────────────────────────────────────────────────

function ChangePassword({
  accountId,
  tag,
  publicKey,
}: {
  accountId: string;
  tag: string | null;
  publicKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = current.length > 0 && next.length >= 10 && next === confirm && code.length === 6;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    setProgress(0);

    let oldEnc: Uint8Array | null = null;
    let oldAuth: Uint8Array | null = null;
    let newEnc: Uint8Array | null = null;
    let newAuth: Uint8Array | null = null;
    let entropy: Uint8Array | null = null;

    try {
      const challenge = await authChallenge({ data: { identifier: accountId } });
      if (!challenge.ok) {
        setError("That password or code doesn't match.");
        return;
      }

      const oldKeys = await deriveKeys(
        current,
        fromBase64(challenge.data.kdfSalt),
        challenge.data.kdfParams,
        (value) => setProgress(value * 0.5),
      );
      oldEnc = oldKeys.encKey;
      oldAuth = oldKeys.authKey;

      entropy = await openKeystore({
        encKey: oldEnc,
        blob: challenge.data.keystore,
        accountId,
        publicKey,
        tag,
      });
      if (!entropy) {
        setError("That password or code doesn't match.");
        return;
      }

      // A new salt for the new password: the same wallet, wrapped again.
      const salt = randomSalt();
      const newKeys = await deriveKeys(next, salt, KDF_V1, (value) =>
        setProgress(0.5 + value * 0.5),
      );
      newEnc = newKeys.encKey;
      newAuth = newKeys.authKey;

      const keystore = await sealKeystore({ encKey: newEnc, entropy, accountId, publicKey, salt });

      const result = await rotateKeystore({
        data: {
          oldAuthKey: oldKeys.authKeyBase64,
          totpCode: code,
          keystore,
          newAuthKey: newKeys.authKeyBase64,
        },
      });

      if (!result.ok) {
        setError(
          result.code === "INVALID_CREDENTIALS"
            ? "That password or code doesn't match."
            : result.message,
        );
        return;
      }

      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
    } catch {
      setError("Oink could not reach the network. Nothing was changed.");
    } finally {
      zero(oldEnc, oldAuth, newEnc, newAuth, entropy);
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2 className="eyebrow">Password</h2>
        {!open && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(true)}>
            Change
          </button>
        )}
      </div>

      {done ? (
        <div className="callout" data-tone="seal">
          <strong>Password changed.</strong> Your keys were re-encrypted in this browser and every
          other device was signed out.
        </div>
      ) : !open ? (
        <div className="panel">
          <p className="meta">
            Changing it re-encrypts your keys here and signs out every other device. Your address
            and balance never move.
          </p>
        </div>
      ) : (
        <form className="panel stack-tight" onSubmit={submit}>
          <PasswordField
            id="current-password"
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            autoFocus
          />
          <PasswordField
            id="next-password"
            label="New password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            showStrength
          />
          <PasswordField
            id="next-confirm"
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={Boolean(confirm) && confirm !== next}
          />
          <CodeField id="rotate-code" value={code} onChange={setCode} />

          {busy && (
            <div className="progress">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
              />
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!ready || busy}
            >
              {busy ? "Re-encrypting…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ── Reveal the phrase ──────────────────────────────────────────────────────

function RevealPhrase({
  accountId,
  tag,
  publicKey,
}: {
  accountId: string;
  tag: string | null;
  publicKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  const [held, setHeld] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0 || code.length !== 6) return;

    setBusy(true);
    setError(null);

    let encKey: Uint8Array | null = null;
    let authKey: Uint8Array | null = null;
    let entropy: Uint8Array | null = null;

    try {
      const challenge = await authChallenge({ data: { identifier: accountId } });
      if (!challenge.ok) {
        setError("That password or code doesn't match.");
        return;
      }

      const derived = await deriveKeys(
        password,
        fromBase64(challenge.data.kdfSalt),
        challenge.data.kdfParams,
      );
      encKey = derived.encKey;
      authKey = derived.authKey;

      const revealed = await revealKeystore({
        data: { authKey: derived.authKeyBase64, totpCode: code },
      });
      if (!revealed.ok) {
        setError("That password or code doesn't match.");
        setCode("");
        return;
      }

      entropy = await openKeystore({
        encKey,
        blob: revealed.data.keystore,
        accountId,
        publicKey,
        tag,
      });
      if (!entropy) {
        setError("That password or code doesn't match.");
        return;
      }

      setWords(fromEntropy(entropy).split(" "));
      setPassword("");
      setCode("");
    } catch {
      setError("Oink could not reach the network. Try again.");
    } finally {
      zero(encKey, authKey, entropy);
      setBusy(false);
    }
  }

  function hide() {
    setWords(null);
    setHeld(false);
    setOpen(false);
  }

  return (
    <section>
      <div className="section-head">
        <h2 className="eyebrow">Secret phrase</h2>
        {!open && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(true)}>
            <Eye size={14} aria-hidden="true" /> Show
          </button>
        )}
      </div>

      {!open ? (
        <div className="panel">
          <p className="meta">
            The same 12 words open this wallet in Phantom or Solflare — a real reason to look, and
            the only backup you have. Oink stores them encrypted and cannot read them.
          </p>
        </div>
      ) : words ? (
        <div className="panel stack-tight">
          <div className="callout" data-tone="warn">
            Anyone who sees these words owns this wallet. No screenshots — screenshots end up in
            cloud backups.
          </div>

          <div
            className="words"
            data-hidden={!held}
            onPointerDown={() => setHeld(true)}
            onPointerUp={() => setHeld(false)}
            onPointerLeave={() => setHeld(false)}
            style={{ cursor: "pointer", touchAction: "none" }}
          >
            {words.map((word, index) => (
              <span className="word" key={word + index}>
                <span className="word-index tnum">{index + 1}</span>
                <span className="word-text">{word}</span>
              </span>
            ))}
          </div>
          <p className="hint">{held ? "Release to hide." : "Press and hold to read."}</p>

          <div className="btn-row">
            <CopyButton
              value={words.join(" ")}
              label="Copy phrase"
              className="btn btn-outline btn-sm"
            />
            <button type="button" className="btn btn-quiet btn-sm" onClick={hide}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="panel stack-tight" onSubmit={submit}>
          <p className="meta">Confirm it's you: your password and a code.</p>
          <PasswordField
            id="reveal-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            autoFocus
          />
          <CodeField id="reveal-code" value={code} onChange={setCode} />

          {error && <p className="form-error">{error}</p>}

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || password.length === 0 || code.length !== 6}
            >
              {busy ? "Checking…" : "Show my phrase"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ── Devices ────────────────────────────────────────────────────────────────

function Devices() {
  const devices = useDeviceSessions();
  const revoke = useRevokeSession();
  const sessions = devices.data?.sessions ?? [];

  return (
    <section>
      <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
        Signed in
      </h2>

      {devices.isPending ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : (
        <div className="ledger">
          {sessions.map((session) => (
            <div className="ledger-row" key={session.tokenHashPrefix}>
              <span className="ledger-main">
                <span className="ledger-title">{describeDevice(session.userAgent)}</span>
                <span className="ledger-sub">
                  Last used {timeAgo(session.lastUsedAt)}
                  {session.isCurrent ? " · this device" : ""}
                </span>
              </span>
              {!session.isCurrent && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={revoke.isPending}
                  onClick={() => void revoke.mutateAsync(session.tokenHashPrefix)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
