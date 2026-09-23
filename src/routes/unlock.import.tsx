import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { PhraseInput, emptyPhrase } from "@/components/oink/PhraseInput";
import { keypairFromEntropy } from "@/lib/crypto/derive";
import { toEntropy, validateMnemonic } from "@/lib/crypto/mnemonic";
import { shortAddress } from "@/lib/format";
import { stashImportedWallet } from "@/lib/wallet/import-handoff";

export const Route = createFileRoute("/unlock/import")({
  component: ImportPage,
});

/**
 * The Phantom / Solflare path. Oink wraps a wallet that already
 * exists; it does not create a new one, and the phrase the user already keeps
 * stays the only backup.
 */
function ImportPage() {
  const navigate = useNavigate();
  const [words, setWords] = useState<string[]>(emptyPhrase);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const complete = words.every((word) => word.length > 0);

  function inspect(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const phrase = words.join(" ").trim();
    if (!validateMnemonic(phrase)) {
      setError("Those 12 words aren't a valid recovery phrase. Check the spelling.");
      return;
    }

    const entropy = toEntropy(phrase);
    const publicKey = keypairFromEntropy(entropy).publicKey.toBase58();
    setPreview(publicKey);
    stashImportedWallet(entropy, publicKey);
  }

  return (
    <main className="stage">
      <Link to="/unlock" className="btn btn-quiet btn-sm" style={{ marginLeft: -13 }}>
        <ArrowLeft size={15} aria-hidden="true" /> Sign in
      </Link>

      <header className="page-head" style={{ marginTop: "var(--s5)" }}>
        <h1 className="page-title">
          Import a wallet you <span className="serif">already have</span>
        </h1>
        <p className="page-sub">
          Same keys, same address, same balance — plus an Oink account people can pay, and a
          password and authenticator so you can get back in without typing these words again.
        </p>
      </header>

      <form className="stack" onSubmit={inspect}>
        <div className="field">
          <span className="field-label">Your 12 words</span>
          <PhraseInput words={words} onChange={setWords} />
          <p className="hint">
            Derived with <span className="mono">m/44'/501'/0'/0'</span> — the same path Phantom and
            Solflare use.
          </p>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {preview ? (
          <>
            <div className="callout" data-tone="seal">
              <strong>{shortAddress(preview, 6)}</strong> — this is the wallet Oink will wrap. If
              that is not the address you expect, check the words again.
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void navigate({ to: "/create" })}
            >
              Continue
            </button>
          </>
        ) : (
          <button type="submit" className="btn btn-primary btn-block" disabled={!complete}>
            Check this phrase
          </button>
        )}

        <p className="footnote">
          Your words never leave this browser. Oink stores only the ciphertext they produce, which
          it cannot read.
        </p>
      </form>
    </main>
  );
}
