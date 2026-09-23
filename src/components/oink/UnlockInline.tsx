import { useState, type FormEvent } from "react";
import { PasswordField } from "@/components/oink/fields";
import { unlockKey } from "@/lib/wallet/unlock";

/**
 * Shown in place, never as a redirect: a locked key in the middle of a send
 * should cost a password, not the user's place in the flow.
 *
 * No TOTP here. The session is already proven; the key is the spend authority,
 * and asking for a code again would only train people to reach for their phone
 * on every payment.
 */
export function UnlockInline({
  accountId,
  tag,
  publicKey,
  onUnlocked,
  reason = "Unlock to sign this transaction.",
  submitLabel = "Unlock",
}: {
  accountId: string;
  tag: string | null;
  publicKey: string;
  onUnlocked: () => void;
  reason?: string;
  submitLabel?: string;
}) {
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;

    setBusy(true);
    setError(null);
    setProgress(0);

    try {
      const ok = await unlockKey({ accountId, tag, publicKey, password, onProgress: setProgress });
      if (ok) {
        setPassword("");
        onUnlocked();
      } else {
        setError("That password doesn't match this wallet.");
      }
    } catch {
      setError("Oink could not reach the network. Try again.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <form className="panel stack-tight" onSubmit={submit}>
      <p className="eyebrow">Wallet locked</p>
      <p className="meta">{reason}</p>

      <PasswordField
        id="inline-unlock-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />

      {busy && (
        <div className="progress" aria-label="Deriving your key">
          <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>
        {busy ? "Unlocking…" : submitLabel}
      </button>
    </form>
  );
}
