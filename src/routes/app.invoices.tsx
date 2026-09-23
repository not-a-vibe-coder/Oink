import { Link, createFileRoute } from "@tanstack/react-router";
import { CopyButton } from "@/components/oink/CopyButton";
import { useCancelInvoice, useInvoices } from "@/hooks/useOink";
import { formatDateTime, formatTokenAmount, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/app/invoices")({
  component: RequestsPage,
});

const TONE: Record<string, "ok" | "warn" | "bad" | undefined> = {
  paid: "ok",
  pending: undefined,
  expired: "warn",
  cancelled: "bad",
};

function RequestsPage() {
  const invoices = useInvoices();
  const cancel = useCancelInvoice();
  const rows = invoices.data?.invoices ?? [];

  return (
    <main className="stage stage-wide">
      <header className="page-head">
        <h1 className="page-title">Requests</h1>
        <p className="page-sub">
          Pay links you have handed out. Anyone can open one; only you can cancel it.
        </p>
      </header>

      {invoices.isPending ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : rows.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No requests yet</p>
          <p className="empty-note">
            A request is an amount with a link attached — useful when someone asks “how much do I
            owe you?”
          </p>
          <Link
            to="/app/receive"
            className="btn btn-outline btn-sm"
            style={{ marginTop: "var(--s4)" }}
          >
            Create a request
          </Link>
        </div>
      ) : (
        <div className="ledger">
          {rows.map((invoice) => {
            const payUrl =
              typeof window === "undefined"
                ? `/pay/${invoice.id}`
                : `${window.location.origin}/pay/${invoice.id}`;

            return (
              <div className="ledger-row" key={invoice.id}>
                <span className="ledger-main">
                  <span className="ledger-title">
                    {formatTokenAmount(invoice.amount)} {invoice.token_symbol}
                    {invoice.memo ? ` · ${invoice.memo}` : ""}
                  </span>
                  <span className="ledger-sub">
                    {invoice.status === "paid"
                      ? `Paid ${timeAgo(invoice.paid_at)}`
                      : invoice.status === "pending"
                        ? `Expires ${formatDateTime(invoice.expires_at)}`
                        : `Created ${timeAgo(invoice.created_at)}`}
                    {invoice.apply_mix ? " · settles into your mix" : ""}
                  </span>
                </span>

                <span className="row" style={{ flex: "none", gap: 6 }}>
                  <span className="badge" data-tone={TONE[invoice.status]}>
                    {invoice.status}
                  </span>
                  {invoice.status === "pending" && (
                    <>
                      <CopyButton value={payUrl} label="Link" className="btn btn-quiet btn-sm" />
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        disabled={cancel.isPending}
                        onClick={() => void cancel.mutateAsync(invoice.id)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
