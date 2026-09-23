import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { CodeField, IdentifierField, PasswordField } from "@/components/oink/fields";
import { signIn } from "@/lib/wallet/unlock";

export const Route = createFileRoute("/unlock/")({
  component: UnlockPage,
});

function UnlockPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ready = identifier.length >= 3 && password.length > 0 && code.length === 6;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    setProgress(0);

    try {
      const result = await signIn({ identifier, password, totpCode: code, onProgress: setProgress });
      if (result.ok) {
        setPassword("");
        setCode("");
        void navigate({ to: "/app" });
        return;
      }
      setError(result.error ?? "That account, password or code doesn't match.");
      setCode("");
    } catch {
      setError("Oink could not reach the network. Check your connection and try again.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <main className="stage">
      <Link to="/" className="btn btn-quiet btn-sm" style={{ marginLeft: -13 }}>
        <ArrowLeft size={15} aria-hidden="true" /> Oink
      </Link>

      <header className="page-head" style={{ marginTop: "var(--s5)" }}>
        <h1 className="page-title">
          Welcome <span className="serif">back</span>
        </h1>
        <p className="page-sub">
          Your account ID or tag, your password and a code from your authenticator. Nothing else,
          on any device.
        </p>
      </header>

      <form className="stack" onSubmit={submit}>
        <div className="stack-tight">
          <IdentifierField id="unlock-identifier" value={identifier} onChange={setIdentifier} autoFocus />
          <PasswordField
            id="unlock-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <CodeField id="unlock-code" value={code} onChange={setCode} />
        </div>

        {busy && (
          <div className="progress" aria-label="Checking your credentials">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
            />
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>

      <hr className="rule" style={{ margin: "var(--s6) 0 var(--s4)" }} />

      <div className="stack-tight">
        <p className="meta">
          Lost your password or your authenticator?{" "}
          <Link to="/unlock/restore" className="link">
            Restore with your secret phrase
          </Link>
        </p>
        <p className="meta">
          Already have a wallet in Phantom or Solflare?{" "}
          <Link to="/unlock/import" className="link">
            Import it into Oink
          </Link>
        </p>
        <p className="meta">
          New here?{" "}
          <Link to="/create" className="link">
            Create a wallet
          </Link>
        </p>
      </div>
    </main>
  );
}
