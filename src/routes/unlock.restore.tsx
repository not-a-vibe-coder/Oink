import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { CopyButton } from "@/components/oink/CopyButton";
import { PhraseInput, emptyPhrase } from "@/components/oink/PhraseInput";
import { QrCode } from "@/components/oink/QrCode";
import { CodeField, PasswordField, TagField } from "@/components/oink/fields";
import { keypairFromEntropy } from "@/lib/crypto/derive";
import { toEntropy, validateMnemonic } from "@/lib/crypto/mnemonic";
import {
  enrollStart,
  getTagProfile,
  recoverChallenge,
  recoverComplete,
} from "@/lib/oink-server-fns";
import { deriveKeys, randomSalt, sealKeystore, zero, KDF_V1 } from "@/lib/wallet/credentials";
import { signMessage, unlockWith } from "@/lib/wallet/key-session";
import type { EnrollStartResponse } from "@/types/api";

export const Route = createFileRoute("/unlock/restore")({
  component: RestorePage,
});

const PHRASE_MISMATCH = "That phrase doesn't match this tag.";
const STEPS = ["Phrase", "New password", "New authenticator"] as const;

function RestorePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [tag, setTag] = useState("");
  const [words, setWords] = useState<string[]>(emptyPhrase);
  const [checking, setChecking] = useState(false);
  const [phraseError, setPhraseError] = useState<string | null>(null);

  // Held between steps so the same entropy is re-encrypted under the new
  // password. Never leaves this component and is zeroed on unmount.
  const [entropy, setEntropy] = useState<Uint8Array | null>(null);
  const [publicKey, setPublicKey] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [enrollment, setEnrollment] = useState<EnrollStartResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(
    () => () => {
      entropy?.fill(0);
    },
    [entropy],
  );

  const startEnrollment = useCallback(async () => {
    const result = await enrollStart({ data: { tagHint: tag } });
    if (result.ok) setEnrollment(result.data);
    else setFinishError(result.message);
  }, [tag]);

  useEffect(() => {
    if (step === 3 && !enrollment) void startEnrollment();
  }, [step, enrollment, startEnrollment]);

  const phrase = words.join(" ").trim();
  const phraseComplete = words.every((word) => word.length > 0);

  async function checkPhrase(event: FormEvent) {
    event.preventDefault();
    if (checking || !phraseComplete || tag.length < 3) return;

    setChecking(true);
    setPhraseError(null);

    try {
      if (!validateMnemonic(phrase)) {
        setPhraseError("Those 12 words aren't a valid recovery phrase. Check the spelling.");
        return;
      }

      const derivedEntropy = toEntropy(phrase);
      const derivedKey = keypairFromEntropy(derivedEntropy).publicKey.toBase58();

      // The public profile carries the wallet's address, so the pairing can be
      // checked here rather than after the user has set a new password.
      const profile = await getTagProfile({ data: { tag } }).catch(() => null);
      if (!profile || profile.publicKey !== derivedKey) {
        derivedEntropy.fill(0);
        setPhraseError(PHRASE_MISMATCH);
        return;
      }

      setEntropy(derivedEntropy);
      setPublicKey(derivedKey);
      setStep(2);
    } catch {
      setPhraseError(PHRASE_MISMATCH);
    } finally {
      setChecking(false);
    }
  }

  async function finishRecovery(event: FormEvent) {
    event.preventDefault();
    if (busy || !entropy || !enrollment || code.length !== 6) return;

    setBusy(true);
    setFinishError(null);
    setProgress(0);

    let encKey: Uint8Array | null = null;
    let authKey: Uint8Array | null = null;

    try {
      const challenge = await recoverChallenge({ data: { tag } });
      if (!challenge.ok) {
        setFinishError(challenge.code === "RATE_LIMITED" ? challenge.message : PHRASE_MISMATCH);
        return;
      }

      // Signing proves the keypair. It also leaves the wallet unlocked, which is
      // exactly where the user wants to be when this finishes.
      unlockWith(Uint8Array.from(entropy));
      const signature = signMessage(challenge.data.message);

      const salt = randomSalt();
      const derived = await deriveKeys(password, salt, KDF_V1, setProgress);
      encKey = derived.encKey;
      authKey = derived.authKey;

      const keystore = await sealKeystore({ encKey, entropy, tag, publicKey, salt });

      const result = await recoverComplete({
        data: {
          challengeId: challenge.data.challengeId,
          signature,
          publicKey,
          keystore,
          authKey: derived.authKeyBase64,
          totpEnrollmentId: enrollment.enrollmentId,
          totpCode: code,
        },
      });

      if (!result.ok) {
        setFinishError(
          result.code === "INVALID_CREDENTIALS"
            ? "That phrase or code doesn't match this tag."
            : result.message,
        );
        setCode("");
        return;
      }

      setDone(true);
    } catch {
      setFinishError("Oink could not reach the network. Try again.");
    } finally {
      zero(encKey, authKey);
      setBusy(false);
      setProgress(0);
    }
  }

  if (done) {
    return (
      <main className="stage">
        <header className="page-head">
          <h1 className="page-title">
            You're back in. <span className="serif">@{tag}</span>
          </h1>
          <p className="page-sub">
            Same address, same balance, same election. Your new password and authenticator are the
            only things that changed.
          </p>
        </header>

        <div className="notice" style={{ marginBottom: "var(--s4)" }}>
          <span>Every other device was signed out. Sign in again there when you need to.</span>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => {
            setEntropy(null);
            void navigate({ to: "/app" });
          }}
        >
          Open my wallet
        </button>
      </main>
    );
  }

  const passwordReady = password.length >= 10 && password === confirm;

  return (
    <main className="stage">
      <div className="row-between" style={{ marginBottom: "var(--s5)" }}>
        <Link to="/unlock" className="btn btn-quiet btn-sm" style={{ marginLeft: -13 }}>
          <ArrowLeft size={15} aria-hidden="true" /> Sign in
        </Link>
        <span className="step-count">
          {String(step).padStart(2, "0")} / 03 · {STEPS[step - 1]}
        </span>
      </div>

      <div className="steps" aria-hidden="true">
        {STEPS.map((name, index) => (
          <span
            key={name}
            className="step-mark"
            data-state={index + 1 < step ? "done" : index + 1 === step ? "current" : "todo"}
          />
        ))}
      </div>

      {step === 1 && (
        <form className="stack" onSubmit={checkPhrase}>
          <header className="page-head">
            <h1 className="page-title">Restore with your secret phrase</h1>
            <p className="page-sub">
              The 12 words are the wallet. They cover a forgotten password and a lost authenticator
              alike — you keep your tag, your address and your balance.
            </p>
          </header>

          <TagField id="restore-tag" label="Your tag" value={tag} onChange={setTag} autoFocus />

          <div className="field">
            <span className="field-label">Your 12 words</span>
            <PhraseInput words={words} onChange={setWords} disabled={checking} />
            <p className="hint">Paste all twelve at once and they'll fill in order.</p>
          </div>

          {phraseError && (
            <p className="form-error" role="alert">
              {phraseError}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={checking || !phraseComplete || tag.length < 3}
          >
            {checking ? "Checking…" : "Continue"}
          </button>

          <p className="footnote">
            Never type these words anywhere but here. Oink will never ask for them by email, chat or
            support ticket — there is no support channel.
          </p>
        </form>
      )}

      {step === 2 && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (passwordReady) setStep(3);
          }}
        >
          <header className="page-head">
            <h1 className="page-title">Set a new password</h1>
            <p className="page-sub">
              Your keys get re-encrypted under this password, in this browser. The wallet itself
              does not move.
            </p>
          </header>

          <PasswordField
            id="restore-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showStrength
            autoFocus
          />
          <PasswordField
            id="restore-confirm"
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={Boolean(confirm) && confirm !== password}
          />

          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!passwordReady}
            >
              Continue
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form className="stack" onSubmit={finishRecovery}>
          <header className="page-head">
            <h1 className="page-title">Add a new authenticator</h1>
            <p className="page-sub">
              The old one stops working the moment this finishes. Scan the code with whichever app
              you use now.
            </p>
          </header>

          {enrollment ? (
            <>
              <QrCode value={enrollment.otpauthUri} alt="New authenticator setup QR code" />

              <div className="row-between">
                <div style={{ minWidth: 0 }}>
                  <p className="eyebrow">Or enter this key</p>
                  <p className="mono" style={{ marginTop: 4 }}>
                    {enrollment.totpSecret}
                  </p>
                </div>
                <CopyButton value={enrollment.totpSecret} label="Copy key" />
              </div>

              <CodeField
                id="restore-code"
                value={code}
                onChange={setCode}
                invalid={Boolean(finishError)}
              />
            </>
          ) : (
            <div className="skeleton" style={{ height: 280, borderRadius: 22 }} />
          )}

          {busy && (
            <div className="progress" aria-label="Re-encrypting your wallet">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
              />
            </div>
          )}

          {finishError && (
            <p className="form-error" role="alert">
              {finishError}
            </p>
          )}

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setStep(2)}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || code.length !== 6 || !enrollment}
            >
              {busy ? "Restoring…" : "Finish"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
