import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Download, ShieldAlert } from "lucide-react";
import { CopyButton } from "@/components/oink/CopyButton";
import { AuthenticatorSetup } from "@/components/oink/AuthenticatorSetup";
import { CodeField, PasswordField } from "@/components/oink/fields";
import { enrollComplete, enrollStart, enrollVerifyTotp } from "@/lib/oink-server-fns";
import { keypairFromEntropy } from "@/lib/crypto/derive";
import { generateMnemonic, toEntropy } from "@/lib/crypto/mnemonic";
import { deriveKeys, randomSalt, sealKeystore, zero, KDF_V1 } from "@/lib/wallet/credentials";
import { unlockWith } from "@/lib/wallet/key-session";
import { clearImportedWallet, takeImportedWallet } from "@/lib/wallet/import-handoff";
import type { EnrollStartResponse } from "@/types/api";

export const Route = createFileRoute("/create")({
  component: CreateWalletPage,
});

// No tag step: a tag is claimed afterwards by linking X (docs/12 §3). The account ID the
// server issues in step 2 is what identifies the wallet until then.
const STEPS = ["Password", "Authenticator", "Creating", "Secret phrase"] as const;
type Step = 1 | 2 | 3 | 4;

function CreateWalletPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);

  // An imported Phantom/Solflare wallet arrives in memory from /unlock/import.
  // Taken once on mount, so a refresh cannot resurrect it.
  const [imported] = useState(() => (typeof window === "undefined" ? null : takeImportedWallet()));
  const isImport = imported !== null;
  useEffect(
    () => () => {
      imported?.entropy.fill(0);
      clearImportedWallet();
    },
    [imported],
  );

  // Step 1
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  // Step 2
  const [enrollment, setEnrollment] = useState<EnrollStartResponse | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  // Step 3
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Generating your wallet");
  const [createError, setCreateError] = useState<string | null>(null);

  // Step 4
  const [phrase, setPhrase] = useState<string[] | null>(null);

  const startEnrollment = useCallback(async () => {
    setEnrollError(null);
    const result = await enrollStart();
    if (result.ok) {
      setEnrollment(result.data);
    } else {
      setEnrollError(
        result.code === "RATE_LIMITED"
          ? result.message
          : "Oink could not start enrollment. Try again in a moment.",
      );
    }
  }, []);

  useEffect(() => {
    if (step === 2 && !enrollment) void startEnrollment();
  }, [step, enrollment, startEnrollment]);

  const passwordProblem = useMemo(() => {
    if (password.length === 0) return null;
    if (password.length < 10) return "At least 10 characters.";
    if (confirm.length > 0 && confirm !== password) return "Those two don't match.";
    return null;
  }, [password, confirm]);

  const canLeaveStep1 = password.length >= 10 && password === confirm && acknowledged;

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!enrollment || totpCode.length !== 6 || verifying) return;

    setVerifying(true);
    setTotpError(null);
    const result = await enrollVerifyTotp({
      data: { enrollmentId: enrollment.enrollmentId, totpCode },
    });
    setVerifying(false);

    if (result.ok && result.data.valid) {
      setStep(3);
      return;
    }
    setTotpError(
      result.ok
        ? "That code didn't work. Codes change every 30 seconds — try the current one."
        : result.message,
    );
  }

  async function createWallet() {
    setCreateError(null);
    setProgress(0);

    let entropy: Uint8Array | null = null;
    let encKey: Uint8Array | null = null;
    let authKey: Uint8Array | null = null;
    let at = "starting";
    const mark = (label: string) => {
      at = label;
      setStage(label);
    };

    try {
      if (!enrollment) throw new Error("missing enrollment");

      let mnemonic: string | null = null;
      if (imported) {
        mark("Reading your imported wallet");
        entropy = Uint8Array.from(imported.entropy);
      } else {
        mark("Generating your wallet");
        mnemonic = generateMnemonic();
        entropy = toEntropy(mnemonic);
      }
      const publicKey = keypairFromEntropy(entropy).publicKey.toBase58();

      mark("Hardening your password");
      const salt = randomSalt();
      const derived = await deriveKeys(password, salt, KDF_V1, setProgress);
      encKey = derived.encKey;
      authKey = derived.authKey;

      mark("Encrypting your keys");
      const keystore = await sealKeystore({
        encKey,
        entropy,
        accountId: enrollment.accountId,
        publicKey,
        salt,
      });

      mark("Creating " + enrollment.accountId);
      const result = await enrollComplete({
        data: {
          enrollmentId: enrollment.enrollmentId,
          publicKey,
          keystore,
          authKey: derived.authKeyBase64,
          totpCode,
        },
      });

      if (!result.ok) {
        setCreateError(
          result.code === "WALLET_EXISTS"
            ? "This wallet already has an Oink account. Use “Restore with my phrase” to get back into it."
            : result.message,
        );
        return;
      }

      // The key goes straight into memory — the user is signed in already.
      unlockWith(entropy);
      // An imported wallet's owner already holds the phrase; showing it again
      // would be a second copy of the one thing that must exist in one place.
      setPhrase(mnemonic ? mnemonic.split(" ") : []);
      setStep(4);
    } catch (err) {
      // Name and message only: the error object itself can hold references to the
      // buffers above, and nothing near key material goes to the console (docs/02 §9).
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : typeof err;
      console.error(`[oink:create] failed at "${at}" — ${reason}`);
      setCreateError("Something went wrong creating your wallet. Nothing was saved — try again.");
    } finally {
      zero(encKey, authKey, entropy);
    }
  }

  useEffect(() => {
    if (step === 3) void createWallet();
    // createWallet closes over the state it needs and runs exactly once per entry
    // into step 3; re-running it would spend the enrollment twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function finish() {
    if (phrase) {
      // The words are React state, so this is best-effort: drop the reference and
      // let nothing else in the app ever hold it.
      setPhrase(null);
    }
    void navigate({ to: "/app" });
  }

  return (
    <main className="stage">
      <div className="row-between" style={{ marginBottom: "var(--s5)" }}>
        <Link to="/" className="btn btn-quiet btn-sm" style={{ marginLeft: -13 }}>
          <ArrowLeft size={15} aria-hidden="true" /> Oink
        </Link>
        <span className="step-count">
          {String(step).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")} ·{" "}
          {STEPS[step - 1]}
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

      {isImport && step < 4 && (
        <div className="notice" style={{ marginBottom: "var(--s4)" }}>
          <span>
            Importing an existing wallet. Your 12 words stay in this browser — Oink only wraps the
            same keys in a password and an authenticator.
          </span>
        </div>
      )}

      {step === 1 && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (canLeaveStep1) setStep(2);
          }}
        >
          <header className="page-head">
            <h1 className="page-title">
              Pick a password. <span className="serif">Only yours.</span>
            </h1>
            <p className="page-sub">
              It encrypts your keys inside this browser. Oink stores the result and cannot read it.
            </p>
          </header>

          <div className="stack-tight">
            <PasswordField
              id="new-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              showStrength
              autoFocus
            />
            <PasswordField
              id="confirm-password"
              label="Confirm password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={Boolean(confirm) && confirm !== password}
            />
            {passwordProblem && <p className="form-error">{passwordProblem}</p>}
          </div>

          <div className="callout" data-tone="warn">
            <ShieldAlert size={16} aria-hidden="true" style={{ float: "left", marginRight: 10 }} />
            <strong>Oink cannot reset this.</strong> If you forget your password and lose your
            recovery phrase, the money is gone. There is no support channel that can bring it back.
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I understand that losing both my password and my recovery phrase means losing my
              money.
            </span>
          </label>

          <button type="submit" className="btn btn-primary btn-block" disabled={!canLeaveStep1}>
            Continue
          </button>
        </form>
      )}

      {step === 2 && (
        <form className="stack" onSubmit={verifyCode}>
          <header className="page-head">
            <h1 className="page-title">Add your authenticator</h1>
            <p className="page-sub">
              Add Oink to Google Authenticator, Authy or 1Password. It is your second key when you
              sign in on a new device.
            </p>
          </header>

          {enrollError && (
            <div className="callout" data-tone="danger">
              {enrollError}{" "}
              <button type="button" className="link" onClick={() => void startEnrollment()}>
                Try again
              </button>
            </div>
          )}

          {enrollment ? (
            <>
              <AuthenticatorSetup
                uri={enrollment.otpauthUri}
                secret={enrollment.totpSecret}
                qrAlt="Authenticator setup QR code"
              />

              <CodeField
                id="enroll-totp"
                label="Code from your authenticator"
                value={totpCode}
                onChange={setTotpCode}
                invalid={Boolean(totpError)}
                hint="Six digits, refreshed every 30 seconds."
              />

              {totpError && <p className="form-error">{totpError}</p>}

              <div className="btn-row">
                <button type="button" className="btn btn-outline" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={totpCode.length !== 6 || verifying}
                >
                  {verifying ? "Checking…" : "Verify code"}
                </button>
              </div>
            </>
          ) : (
            !enrollError && <div className="skeleton" style={{ height: 280, borderRadius: 22 }} />
          )}
        </form>
      )}

      {step === 3 && (
        <div className="stack">
          <header className="page-head">
            <h1 className="page-title">Building your wallet</h1>
            <p className="page-sub">
              This runs in your browser. Your keys are being encrypted before anything is sent.
            </p>
          </header>

          <div className="stack-tight">
            <div className="progress">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
              />
            </div>
            <p className="meta" role="status">
              {stage}…
            </p>
          </div>

          {createError && (
            <>
              <p className="form-error">{createError}</p>
              <div className="btn-row">
                <button type="button" className="btn btn-outline" onClick={() => setStep(2)}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => void createWallet()}
                >
                  Try again
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && enrollment && phrase && phrase.length > 0 && (
        <PhraseStep words={phrase} accountId={enrollment.accountId} onFinish={finish} />
      )}

      {step === 4 && enrollment && phrase && phrase.length === 0 && (
        <div className="stack">
          <header className="page-head">
            <h1 className="page-title">
              It's yours, <span className="serif">same wallet</span>
            </h1>
            <p className="page-sub">
              Your imported keys are now encrypted under this password and authenticator. The
              address, the balance and the recovery phrase you already hold are unchanged.
            </p>
          </header>
          <AccountIdCard accountId={enrollment.accountId} />
          <button type="button" className="btn btn-primary btn-block" onClick={finish}>
            Open my wallet
          </button>
        </div>
      )}
    </main>
  );
}

// ── Secret phrase ──────────────────────────────────────────────────────────

/**
 * The account ID is how the user signs in until they link X, so it sits next to the phrase
 * and goes into the downloaded backup. It is not a secret.
 */
function AccountIdCard({ accountId }: { accountId: string }) {
  return (
    <div className="panel">
      <div className="row-between">
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Your account ID</p>
          <p className="mono" style={{ marginTop: 4, fontSize: "1.1rem" }}>
            {accountId}
          </p>
        </div>
        <CopyButton value={accountId} label="Copy" className="btn btn-outline btn-sm" />
      </div>
      <p className="meta" style={{ marginTop: "var(--s2)" }}>
        You sign in with this, your password and a code. Link X later and your @tag works too.
      </p>
    </div>
  );
}

function PhraseStep({
  words,
  accountId,
  onFinish,
}: {
  words: string[];
  accountId: string;
  onFinish: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [checks] = useState(() => pickThree(words.length));
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checkError, setCheckError] = useState<string | null>(null);

  const allCorrect = checks.every(
    (index) => (answers[index] ?? "").trim().toLowerCase() === words[index],
  );

  function download() {
    const body = [
      "Oink secret phrase",
      `Account ID: ${accountId}`,
      "",
      words.map((word, index) => `${index + 1}. ${word}`).join("\n"),
      "",
      "Anyone who has these words can take this wallet's money. Keep them offline.",
    ].join("\n");

    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${accountId}-secret-phrase.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1 className="page-title">Your secret phrase</h1>
        <p className="page-sub">
          These 12 words are your wallet. Anyone who has them can take your money, and Oink cannot
          reset them. You need them if you ever lose your authenticator app.
        </p>
      </header>

      <AccountIdCard accountId={accountId} />

      <div className="reveal-wrap">
        <div className="words" data-hidden={!revealed}>
          {words.map((word, index) => (
            <span className="word" key={word + index}>
              <span className="word-index tnum">{index + 1}</span>
              <span className="word-text">{word}</span>
            </span>
          ))}
        </div>
        {!revealed && (
          <div className="reveal-cover">
            <button type="button" className="btn btn-primary" onClick={() => setRevealed(true)}>
              Reveal the words
            </button>
          </div>
        )}
      </div>

      {revealed && (
        <>
          <div className="btn-row">
            <CopyButton
              value={words.join(" ")}
              label="Copy phrase"
              copiedLabel="Copied"
              className="btn btn-outline btn-sm"
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={download}>
              <Download size={14} aria-hidden="true" /> Download
            </button>
          </div>

          <form
            className="stack-tight"
            onSubmit={(event) => {
              event.preventDefault();
              if (allCorrect) onFinish();
              else setCheckError("Those don't match your phrase. Check the numbers again.");
            }}
          >
            <p className="eyebrow">Confirm you have it</p>
            {checks.map((index) => (
              <div className="field" key={index}>
                <label className="field-label" htmlFor={`word-${index}`}>
                  Word {index + 1}
                </label>
                <input
                  id={`word-${index}`}
                  className="input"
                  value={answers[index] ?? ""}
                  onChange={(event) => {
                    setCheckError(null);
                    setAnswers((prev) => ({ ...prev, [index]: event.target.value }));
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            ))}

            {checkError && <p className="form-error">{checkError}</p>}

            <button type="submit" className="btn btn-primary btn-block" disabled={!allCorrect}>
              {allCorrect ? (
                <>
                  <Check size={16} aria-hidden="true" /> Open my wallet
                </>
              ) : (
                "Open my wallet"
              )}
            </button>
            <p className="footnote">
              There is no “remind me later”. This phrase is the only backup Oink will ever give you.
            </p>
          </form>
        </>
      )}
    </div>
  );
}

function pickThree(length: number): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) {
    picked.add(Math.floor(Math.random() * length));
  }
  return [...picked].sort((a, b) => a - b);
}
