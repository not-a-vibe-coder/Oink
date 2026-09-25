import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Share2 } from "lucide-react";
import { AllocationRail } from "@/components/oink/AllocationRail";
import { CopyButton } from "@/components/oink/CopyButton";
import { QrCode } from "@/components/oink/QrCode";
import { useCreateInvoice, useMix, useWalletAddress } from "@/hooks/useOink";
import { useWalletSession } from "@/lib/app-session";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/app/receive")({
  component: ReceivePage,
});

type Tab = "address" | "request";

function ReceivePage() {
  const { accountId, tag, publicKey } = useWalletSession();
  // Oink users can pay either form; the tag only exists once X is linked.
  const handle = tag ? `@${tag}` : accountId;
  const [tab, setTab] = useState<Tab>("address");
  const address = useWalletAddress();
  const mixQuery = useMix(accountId);
  const mix = mixQuery.data?.mix ?? [];

  return (
    <main className="stage stage-wide">
      <header className="page-head">
        <h1 className="page-title">Receive</h1>
        <p className="page-sub">
          Two ways in: your address, which any wallet can pay, or a request with an amount attached.
        </p>
      </header>

      <div
        className="tabs"
        role="tablist"
        aria-label="Receive options"
        style={{ marginBottom: "var(--s5)" }}
      >
        <button
          type="button"
          role="tab"
          className="tab"
          data-active={tab === "address"}
          aria-selected={tab === "address"}
          onClick={() => setTab("address")}
        >
          Your address
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          data-active={tab === "request"}
          aria-selected={tab === "request"}
          onClick={() => setTab("request")}
        >
          Request
        </button>
      </div>

      {tab === "address" ? (
        <div className="stack">
          <QrCode
            value={address.data?.solanaPayUri ?? `solana:${publicKey}`}
            alt={`QR code for ${handle}'s Solana address`}
          />

          <div>
            <p className="eyebrow">{handle}</p>
            <p className="mono" style={{ marginTop: 8, color: "var(--ink-2)" }}>
              {address.data?.publicKey ?? publicKey}
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <CopyButton
                value={address.data?.publicKey ?? publicKey}
                label="Copy address"
                className="btn btn-outline btn-sm"
              />
              <CopyButton
                value={handle}
                label={tag ? "Copy tag" : "Copy account ID"}
                className="btn btn-quiet btn-sm"
              />
            </div>
          </div>

          {mix.length > 0 && (
            <section className="panel">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Payments to {handle} settle into
              </p>
              <AllocationRail mix={mix} />
              <p className="footnote" style={{ marginTop: "var(--s3)" }}>
                A plain address can only move tokens, so anything sent straight to it arrives as it
                was sent. To have a payment from any wallet settle into your mix, make a{" "}
                <button type="button" className="link" onClick={() => setTab("request")}>
                  request
                </button>{" "}
                and have them scan its QR in Phantom, Solflare or Backpack.
              </p>
            </section>
          )}
        </div>
      ) : (
        <RequestForm handle={handle} />
      )}
    </main>
  );
}

function RequestForm({ handle }: { handle: string }) {
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [memo, setMemo] = useState("");
  const [applyMix, setApplyMix] = useState(true);
  const [created, setCreated] = useState<{
    id: string;
    payUrl: string;
    solanaPayUri: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createRequest = useCreateInvoice();
  const valid = Number(amount) > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || createRequest.isPending) return;
    setError(null);

    const result = await createRequest.mutateAsync({
      amount,
      tokenSymbol: token,
      memo: memo || undefined,
      applyMix,
    });

    if (result.ok) setCreated(result.data);
    else setError(result.message);
  }

  async function share() {
    if (!created) return;
    const data = {
      title: `Pay ${handle}`,
      text: memo || `${amount} ${token} to ${handle}`,
      url: created.payUrl,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(data);
      } catch {
        /* the user dismissed the share sheet */
      }
    }
  }

  if (created) {
    return (
      <div className="stack">
        <QrCode value={created.solanaPayUri} alt="QR code for this payment request" />

        <div>
          <p className="eyebrow">Anyone with this link can pay you</p>
          <p className="mono" style={{ marginTop: 8, color: "var(--ink-2)" }}>
            {created.payUrl}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <CopyButton
              value={created.payUrl}
              label="Copy link"
              className="btn btn-outline btn-sm"
            />
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void share()}>
              <Share2 size={14} aria-hidden="true" /> Share
            </button>
          </div>
        </div>

        <p className="meta">Expires {formatDateTime(created.expiresAt)}.</p>

        <div className="btn-row">
          <button type="button" className="btn btn-outline" onClick={() => setCreated(null)}>
            New request
          </button>
          <Link to="/app/invoices" className="btn btn-quiet">
            All requests
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor="request-amount">
          Amount
        </label>
        <input
          id="request-amount"
          className="input input-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          autoFocus
        />
        <div className="chip-row" style={{ marginTop: 10 }}>
          {["USDC", "SOL"].map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              data-selected={token === option}
              onClick={() => setToken(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="request-memo">
          What is it for
        </label>
        <input
          id="request-memo"
          className="input"
          value={memo}
          onChange={(event) => setMemo(event.target.value.slice(0, 140))}
          placeholder="Dinner, rent, design work…"
          maxLength={140}
        />
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={applyMix}
          onChange={(event) => setApplyMix(event.target.checked)}
        />
        <span>Settle into my mix. Leave this off and the payment arrives as {token}.</span>
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={!valid || createRequest.isPending}
      >
        {createRequest.isPending ? "Creating…" : "Create request"}
      </button>
    </form>
  );
}
