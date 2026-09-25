import { Link, createFileRoute } from "@tanstack/react-router";
import { AllocationRail } from "@/components/oink/AllocationRail";
import { CopyButton } from "@/components/oink/CopyButton";
import { PigAvatar } from "@/components/oink/PigAvatar";
import { QrCode } from "@/components/oink/QrCode";
import { useInvoice } from "@/hooks/useOink";
import { formatDateTime, formatTokenAmount, shortAddress } from "@/lib/format";

export const Route = createFileRoute("/pay/$invoiceId")({
  component: PayPage,
});

/**
 * Public. No session, no account, no wallet extension required to read it —
 * someone's friend opens this on a phone and has to understand it in one look.
 */
function PayPage() {
  const { invoiceId } = Route.useParams();
  const invoice = useInvoice(invoiceId);

  if (invoice.isPending) {
    return (
      <main className="stage">
        <div className="skeleton" style={{ height: 320 }} />
      </main>
    );
  }

  if (invoice.isError || !invoice.data) {
    return (
      <main className="stage">
        <div className="empty">
          <p className="empty-title">This request doesn't exist</p>
          <p className="empty-note">
            The link may be mistyped, or the request was cancelled by the person who made it.
          </p>
          <Link to="/" className="btn btn-outline btn-sm" style={{ marginTop: "var(--s4)" }}>
            What is Oink?
          </Link>
        </div>
      </main>
    );
  }

  const data = invoice.data;
  const open = data.status === "pending";
  const handle = data.creatorTag ? `@${data.creatorTag}` : data.creatorAccountId;
  const solanaPayUri =
    data.solanaPayUri ??
    `solana:${data.recipientWallet}?amount=${data.amount}&spl-token=${data.tokenMint}&memo=${encodeURIComponent(data.memo || data.id)}`;

  return (
    <main className="stage">
      <Link to="/" className="brand" style={{ display: "inline-block", marginBottom: "var(--s6)" }}>
        Oink
      </Link>

      <header className="page-head">
        <div className="identity" style={{ marginBottom: "var(--s4)" }}>
          <PigAvatar seed={data.creatorTag ?? data.creatorAccountId} size={44} />
          <div>
            <p className="eyebrow">Payment request</p>
            <p className="identity-tag">{handle}</p>
          </div>
        </div>

        <p className="figure figure-lg">
          {formatTokenAmount(data.amount)}
          <span className="figure-cents" style={{ marginLeft: 8 }}>
            {data.tokenSymbol}
          </span>
        </p>

        {data.memo && <p className="page-sub">{data.memo}</p>}
      </header>

      {!open && (
        <div
          className="callout"
          data-tone={data.status === "paid" ? "seal" : "warn"}
          style={{ marginBottom: "var(--s4)" }}
        >
          {data.status === "paid" ? (
            <>
              <strong>Already paid.</strong> Settled{" "}
              {data.paidAt ? formatDateTime(data.paidAt) : "earlier"}.
            </>
          ) : data.status === "expired" ? (
            <>
              <strong>Expired.</strong> Ask {handle} for a fresh link.
            </>
          ) : (
            <>
              <strong>Cancelled.</strong> {handle} withdrew this request.
            </>
          )}
        </div>
      )}

      {open && (
        <div className="stack">
          <QrCode
            value={solanaPayUri}
            alt={`Solana Pay QR for ${data.amount} ${data.tokenSymbol}`}
          />

          <div>
            <p className="eyebrow">Or pay this address</p>
            <p className="mono" style={{ marginTop: 8, color: "var(--ink-2)" }}>
              {data.recipientWallet}
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <CopyButton
                value={data.recipientWallet}
                label="Copy address"
                className="btn btn-outline btn-sm"
              />
              <CopyButton
                value={data.amount}
                label="Copy amount"
                className="btn btn-quiet btn-sm"
              />
            </div>
          </div>

          {data.applyMix && data.mix.length > 0 && (
            <section className="panel">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                {handle} receives this as
              </p>
              <AllocationRail mix={data.mix} />
              <p className="footnote" style={{ marginTop: "var(--s3)" }}>
                Their mix splits the payment the moment it lands — one transaction, no cash
                sitting in between.
              </p>
            </section>
          )}

          <div className="btn-row">
            <Link
              to="/app/send"
              search={{ to: data.creatorTag ?? data.creatorAccountId, token: data.tokenSymbol, amount: data.amount }}
              className="btn btn-primary"
              style={{ flex: 1 }}
            >
              Pay with Oink
            </Link>
            <a className="btn btn-outline" href={solanaPayUri}>
              Open in a wallet
            </a>
          </div>

          <p className="footnote">
            Expires {formatDateTime(data.expiresAt)} · Request {shortAddress(data.id, 6)} · No
            account needed to pay from any Solana wallet.
          </p>
        </div>
      )}
    </main>
  );
}
