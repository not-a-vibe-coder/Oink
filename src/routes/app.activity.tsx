import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Sheet } from "@/components/oink/Sheet";
import { useActivity } from "@/hooks/useOink";
import { formatDateTime, formatTokenAmount, shortAddress, timeAgo } from "@/lib/format";
import type { TransferRow } from "@/types/api";

export const Route = createFileRoute("/app/activity")({
  component: ActivityPage,
});

const PAGE_SIZE = 20;

function ActivityPage() {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<TransferRow | null>(null);
  const activity = useActivity({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });

  const transfers = activity.data?.transfers ?? [];
  const total = activity.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <main className="stage stage-wide">
      <header className="page-head">
        <h1 className="page-title">Activity</h1>
        <p className="page-sub">
          Every payment in and out, with what each one actually settled into.
        </p>
      </header>

      {activity.isPending ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : transfers.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing yet</p>
          <p className="empty-note">
            When someone pays your tag, the split lands here with the signature that proves it.
          </p>
        </div>
      ) : (
        <>
          <div className="ledger">
            {transfers.map((transfer) => (
              <button
                type="button"
                className="ledger-row"
                key={transfer.signature}
                onClick={() => setOpen(transfer)}
              >
                <span className="ledger-main">
                  <span className="ledger-title">
                    {transfer.isOutgoing
                      ? `To @${transfer.recipient_tag ?? shortAddress(transfer.recipient_wallet)}`
                      : `From @${transfer.sender_tag ?? shortAddress(transfer.sender_wallet)}`}
                  </span>
                  <span className="ledger-sub">
                    {timeAgo(transfer.confirmed_at ?? transfer.created_at)}
                    {transfer.election_applied ? " · settled into your election" : ""}
                    {transfer.fee_sponsored ? " · fee covered" : ""}
                  </span>
                </span>
                <span className="ledger-amount">
                  <span
                    className="ledger-value tnum"
                    data-dir={transfer.isOutgoing ? undefined : "in"}
                  >
                    {transfer.isOutgoing ? "−" : "+"}
                    {formatTokenAmount(transfer.input_amount)} {transfer.input_symbol}
                  </span>
                  {transfer.status !== "confirmed" && (
                    <span className="ledger-qty">{transfer.status}</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {total > PAGE_SIZE && (
            <div className="row-between" style={{ marginTop: "var(--s4)" }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Newer
              </button>
              <span className="meta tnum">
                {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Older
              </button>
            </div>
          )}
        </>
      )}

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.isOutgoing ? "Payment sent" : "Payment received"}
        description={open ? formatDateTime(open.confirmed_at ?? open.created_at) : undefined}
      >
        {open && (
          <div className="stack-tight">
            <div className="row-between">
              <span className="meta">{open.isOutgoing ? "To" : "From"}</span>
              <span className="ledger-value">
                {open.isOutgoing
                  ? open.recipient_tag
                    ? `@${open.recipient_tag}`
                    : shortAddress(open.recipient_wallet, 6)
                  : open.sender_tag
                    ? `@${open.sender_tag}`
                    : shortAddress(open.sender_wallet, 6)}
              </span>
            </div>
            <div className="row-between">
              <span className="meta">Sent</span>
              <span className="ledger-value tnum">
                {formatTokenAmount(open.input_amount)} {open.input_symbol}
              </span>
            </div>

            {open.output_breakdown && open.output_breakdown.length > 0 && (
              <>
                <hr className="rule" style={{ margin: "var(--s2) 0" }} />
                <p className="eyebrow">Settled as</p>
                {open.output_breakdown.map((leg, index) => (
                  <div className="row-between" key={`${leg.symbol}-${index}`}>
                    <span className="meta">
                      {leg.symbol}
                      {leg.safeSettled ? " · routed to USDC" : ""}
                    </span>
                    <span className="ledger-value tnum">
                      {formatTokenAmount(leg.outAmount ?? leg.amount)}
                    </span>
                  </div>
                ))}
              </>
            )}

            {open.memo && (
              <>
                <hr className="rule" style={{ margin: "var(--s2) 0" }} />
                <p className="meta">{open.memo}</p>
              </>
            )}

            <hr className="rule" style={{ margin: "var(--s2) 0" }} />
            <p className="mono" style={{ color: "var(--ink-3)" }}>
              {open.signature}
            </p>
            <a
              className="btn btn-outline btn-block btn-sm"
              href={`https://solscan.io/tx/${open.signature}`}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight size={14} aria-hidden="true" /> View on Solscan
            </a>
          </div>
        )}
      </Sheet>
    </main>
  );
}
