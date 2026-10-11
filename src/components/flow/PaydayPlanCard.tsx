import { Link } from "@tanstack/react-router";
import { Illustration } from "@/components/oink/Illustration";
import { useFlowSummary } from "@/hooks/useFlow";
import { displayUsdc } from "@/lib/flow/amounts";
import type { PaydayAction, PaydaySummary } from "@/lib/flow/journey";

/**
 * Home's single "what happens on payday" card: Mix decides where tag payments settle, Income
 * (Flow) fills the cash reserve first, and Bell checks each stock order before the user signs.
 * The card only reports what the API returned; an unreadable balance shows as unavailable.
 */
const NEXT: Record<PaydayAction, { title: string; note: string; cta: string; hash?: string }> = {
  set_plan: {
    title: "Set your payday plan",
    note: "Choose a cash reserve and the stocks your surplus buys.",
    cta: "Set plan",
    hash: "plan",
  },
  request_income: {
    title: "Get paid",
    note: "Share a payment link. The reserve fills first, then your stock orders.",
    cta: "Request income",
    hash: "request",
  },
  waiting: {
    title: "Waiting for a payment",
    note: "Your payment link is open. Nothing to do until it lands.",
    cta: "View requests",
    hash: "requests",
  },
  allocate: {
    title: "Payment received",
    note: "Apply your plan: top up the reserve and create stock orders.",
    cta: "Apply plan",
    hash: "requests",
  },
  review_orders: {
    title: "Bell orders need review",
    note: "Check each order against your limits, then sign the ones you approve.",
    cta: "Review orders",
    hash: "bell",
  },
  reconcile: {
    title: "Confirming a purchase",
    note: "A signed order was sent. Check its on-chain result before new allocations.",
    cta: "Check status",
    hash: "bell",
  },
};

export function PaydayPlanCard() {
  const summary = useFlowSummary();
  if (summary.isPending)
    return <div className="panel skeleton" style={{ height: 156 }} aria-hidden="true" />;
  // Income services are optional for the wallet: hide the card rather than show a broken one.
  if (summary.isError) return null;
  return <PaydayPlan summary={summary.data} />;
}

/** `links={false}` renders the same card for the simulated walkthrough, which has no account. */
export function PaydayPlan({ summary, links = true }: { summary: PaydaySummary; links?: boolean }) {
  const next = NEXT[summary.nextAction];
  const { reserve, orders } = summary;
  const open = orders.pending + orders.deferred + orders.approved + orders.failed;
  const bellLabel = `Bell · ${open} open${orders.confirmed ? ` · ${orders.confirmed} done` : ""}`;
  const illustration =
    summary.nextAction === "allocate"
      ? "received"
      : summary.nextAction === "review_orders" || summary.nextAction === "reconcile"
        ? "bell"
        : "pig";
  return (
    <section className="panel stack-tight payday" aria-labelledby="payday-title">
      <div className="payday-head">
        <div className="stack-tight" style={{ minWidth: 0 }}>
          <p className="eyebrow">Payday plan</p>
          <h2 id="payday-title" className="payday-title">
            {next.title}
          </h2>
          <p className="meta">{next.note}</p>
        </div>
        <span className="payday-art">
          <Illustration kind={illustration} />
        </span>
      </div>

      <div className="stack-tight">
        <div className="row-between">
          <span className="meta">Cash reserve</span>
          <span className="tnum meta">
            {reserve.status === "available"
              ? `${displayUsdc(reserve.filledBase!)} / ${displayUsdc(reserve.targetBase)} USDC`
              : "Balance unavailable"}
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Cash reserve funded"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            reserve.progressBps === null ? undefined : Math.floor(reserve.progressBps / 100)
          }
        >
          <div
            className="progress-fill"
            style={{ width: `${(reserve.progressBps ?? 0) / 100}%` }}
          />
        </div>
      </div>

      {links ? (
        <>
          <div className="chip-row payday-steps">
            <Link to="/app/mix" className="chip">
              Mix
            </Link>
            <Link to="/app/income" hash="plan" className="chip">
              Reserve first
            </Link>
            <Link to="/app/income" hash="bell" className="chip">
              {bellLabel}
            </Link>
          </div>
          <Link to="/app/income" hash={next.hash} className="btn btn-primary btn-block">
            {next.cta}
          </Link>
        </>
      ) : (
        <div className="chip-row">
          <span className="chip">Reserve first</span>
          <span className="chip">{bellLabel}</span>
        </div>
      )}
    </section>
  );
}
