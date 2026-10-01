import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BellPurchases } from "@/components/bell/BellPurchases";
import { CopyButton } from "@/components/oink/CopyButton";
import {
  useAllocateFlowInvoice,
  useCreateFlowInvoice,
  useFlowInvoices,
  useFlowPayments,
  useFlowSettings,
  useSaveFlowSettings,
} from "@/hooks/useFlow";
import { displayUsdc, parseUsdc } from "@/lib/flow/amounts";
import { previewIncome } from "@/lib/flow/server-fns";
import { FLOW_SYMBOLS } from "@/lib/flow/settings";
import type { FlowSettings } from "@/lib/flow/types";
export const Route = createFileRoute("/app/income")({ component: IncomePage });
function IncomePage() {
  const settings = useFlowSettings();
  return (
    <main className="shell">
      <header className="page-head">
        <p className="eyebrow">Oink Flow</p>
        <h1 className="page-title">Income, with a plan.</h1>
        <p className="page-sub">
          Keep your cash reserve funded. Allocate the rest to your chosen investments.
        </p>
      </header>
      {settings.isPending ? (
        <p className="meta">Loading income settings…</p>
      ) : settings.isError ? (
        <p role="alert">{settings.error.message}</p>
      ) : (
        <IncomeWorkspace key={settings.data.revision} settings={settings.data} />
      )}
    </main>
  );
}
function IncomeWorkspace({ settings }: { settings: FlowSettings }) {
  const [target, setTarget] = useState(displayUsdc(settings.cashTargetBase));
  const [percentages, setPercentages] = useState<Record<string, string>>(
    Object.fromEntries(
      FLOW_SYMBOLS.map((symbol) => [
        symbol,
        String((settings.weights.find((w) => w.symbol === symbol)?.basisPoints ?? 0) / 100),
      ]),
    ),
  );
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const save = useSaveFlowSettings();
  const create = useCreateFlowInvoice();
  const allocate = useAllocateFlowInvoice();
  const invoices = useFlowInvoices();
  const payments = useFlowPayments();
  const preview = useMutation({
    mutationFn: (amountBase: string) => previewIncome({ data: { amountBase } }),
  });
  async function savePlan() {
    setError("");
    try {
      const weights = FLOW_SYMBOLS.map((symbol) => {
        const raw = percentages[symbol];
        if (!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(raw))
          throw new Error("Use percentages with at most two decimals.");
        const [whole, fraction = ""] = raw.split(".");
        return { symbol, basisPoints: Number(whole) * 100 + Number(fraction.padEnd(2, "0")) };
      }).filter((w) => w.basisPoints > 0);
      await save.mutateAsync({
        cashTargetBase: parseUsdc(target),
        weights,
        revision: settings.revision,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your plan.");
    }
  }
  async function handleAmount(action: "preview" | "create") {
    setError("");
    try {
      const base = parseUsdc(amount);
      if (base === "0") throw new Error("Enter a positive payment amount.");
      if (action === "preview") await preview.mutateAsync(base);
      else await create.mutateAsync(base);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare this payment.");
    }
  }
  const completed = new Set(payments.data?.payments.map((p) => p.invoiceId) ?? []);
  return (
    <div className="stack">
      <section className="panel stack">
        <h2 className="eyebrow">Your income plan</h2>
        <label className="stack" style={{ gap: 8 }}>
          Cash target (USDC)
          <input
            className="input"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <p className="meta">
          After your cash target is filled, divide surplus income below. Use 100% in total, or zero
          everywhere to keep all income in cash.
        </p>
        {FLOW_SYMBOLS.map((symbol) => (
          <label className="row" key={symbol}>
            <span>{symbol} (%)</span>
            <input
              className="input"
              aria-label={`${symbol} allocation percentage`}
              style={{ maxWidth: 140 }}
              inputMode="decimal"
              value={percentages[symbol]}
              onChange={(e) => setPercentages({ ...percentages, [symbol]: e.target.value })}
            />
          </label>
        ))}
        <button
          className="btn btn-primary"
          disabled={save.isPending}
          onClick={() => void savePlan()}
        >
          {save.isPending ? "Saving…" : "Save income plan"}
        </button>
      </section>
      <section className="panel stack">
        <h2 className="eyebrow">Request income</h2>
        <label>
          Payment amount (USDC)
          <input
            className="input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <p className="meta">
          The preview uses your saved plan and current available USDC. Final allocation is
          calculated after payment receipt.
        </p>
        <div className="row">
          <button
            className="btn btn-outline"
            disabled={preview.isPending}
            onClick={() => void handleAmount("preview")}
          >
            Preview allocation
          </button>
          <button
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={() => void handleAmount("create")}
          >
            Create payment link
          </button>
        </div>
        {preview.data && (
          <p role="status">
            {displayUsdc(preview.data.cashBase)} USDC stays in cash ·{" "}
            {displayUsdc(preview.data.investmentBase)} USDC assigned to investments.
          </p>
        )}
        {create.data && (
          <div className="row">
            <CopyButton value={create.data.payUrl} label="Copy payment link" />
            <Link to="/income/$invoiceId" params={{ invoiceId: create.data.id }} className="link">
              Open payment request
            </Link>
          </div>
        )}
      </section>
      {error && (
        <p className="callout" role="alert">
          {error}
        </p>
      )}
      <p className="notice">
        Investments remain pending in USDC until Bell execution is available. Reserved amounts stay
        in your wallet and can still be spent elsewhere.
      </p>
      <section className="stack">
        <h2 className="eyebrow">Payment requests</h2>
        {invoices.isError && <p role="alert">{invoices.error.message}</p>}
        {invoices.isPending ? (
          <p className="meta">Loading requests…</p>
        ) : invoices.data?.invoices.length === 0 ? (
          <p className="meta">Create your first income request above.</p>
        ) : (
          invoices.data?.invoices.map((invoice) => (
            <div className="panel row" key={invoice.id}>
              <Link to="/income/$invoiceId" params={{ invoiceId: invoice.id }} className="link">
                {displayUsdc(invoice.amountBase)} USDC · {invoice.status}
              </Link>
              {invoice.status === "paid" && !completed.has(invoice.id) && (
                <button
                  className="btn btn-outline btn-sm"
                  disabled={allocate.isPending || payments.isPending || payments.isError}
                  onClick={() => {
                    void allocate
                      .mutateAsync(invoice.id)
                      .catch((caught: unknown) =>
                        setError(
                          caught instanceof Error ? caught.message : "Could not allocate income.",
                        ),
                      );
                  }}
                >
                  Allocate received income
                </button>
              )}
            </div>
          ))
        )}
      </section>
      <BellPurchases />
      <section className="stack">
        <h2 className="eyebrow">Received income</h2>
        {payments.isError && <p role="alert">{payments.error.message}</p>}
        {payments.isPending ? (
          <p className="meta">Loading income…</p>
        ) : payments.data?.payments.length === 0 ? (
          <p className="meta">Confirmed allocations will appear here.</p>
        ) : (
          payments.data?.payments.map((payment) => (
            <article className="panel stack" key={payment.id}>
              <p className="figure">{displayUsdc(payment.paymentBase)} USDC</p>
              <p>
                {displayUsdc(payment.cashBase)} cash · {displayUsdc(payment.investmentBase)} pending
                investments
              </p>
              {payment.purchases.map((purchase) => (
                <p className="meta" key={purchase.symbol}>
                  {purchase.symbol}: {displayUsdc(purchase.amountBase)} USDC reserved
                </p>
              ))}
              <CopyButton value={payment.signature} label="Copy payment signature" />
            </article>
          ))
        )}
      </section>
    </div>
  );
}
