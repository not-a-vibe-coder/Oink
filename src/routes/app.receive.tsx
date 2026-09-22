import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Share2 } from "lucide-react";
import { AllocationRail } from "@/components/oink/AllocationRail";
import { CopyButton } from "@/components/oink/CopyButton";
import { QrCode } from "@/components/oink/QrCode";
import { useCreateInvoice, useElections, useWalletAddress } from "@/hooks/useOink";
import { useWalletSession } from "@/lib/app-session";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/app/receive")({
  component: ReceivePage,
});

type Tab = "address" | "request";

function ReceivePage() {
  const { tag, publicKey } = useWalletSession();
  const [tab, setTab] = useState<Tab>("address");
  const address = useWalletAddress();
  const elections = useElections(tag);
  const election = elections.data?.elections ?? [];

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
            alt={`QR code for @${tag}'s Solana address`}
          />

          <div>
            <p className="eyebrow">@{tag}</p>
            <p className="mono" style={{ marginTop: 8, color: "var(--ink-2)" }}>
              {address.data?.publicKey ?? publicKey}
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <CopyButton
                value={address.data?.publicKey ?? publicKey}
                label="Copy address"
                className="btn btn-outline btn-sm"
              />
              <CopyButton value={`@${tag}`} label="Copy tag" className="btn btn-quiet btn-sm" />
            </div>
          </div>

          {election.length > 0 && (
            <section className="panel">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Payments to @{tag} settle into
              </p>
              <AllocationRail election={election} />
              <p className="footnote" style={{ marginTop: "var(--s3)" }}>
                Anything sent straight to the address above arrives as it was sent. You can
                rebalance it afterwards from{" "}
                <Link to="/app/election" className="link">
                  your election
                </Link>
                .
              </p>
            </section>
          )}
        </div>
      ) : (
        <RequestForm tag={tag} />
      )}
    </main>
  );
}

function RequestForm({ tag }: { tag: string }) {
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [memo, setMemo] = useState("");
  const [applyElection, setApplyElection] = useState(true);
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
      applyElection,
    });

    if (result.ok) setCreated(result.data);
    else setError(result.message);
  }

  async function share() {
    if (!created) return;
    const data = {
      title: `Pay @${tag}`,
      text: memo || `${amount} ${token} to @${tag}`,
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
          checked={applyElection}
          onChange={(event) => setApplyElection(event.target.checked)}
        />
        <span>Settle into my election. Leave this off and the payment arrives as {token}.</span>
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
