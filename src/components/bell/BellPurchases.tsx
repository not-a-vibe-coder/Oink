import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { displayUsdc, parseUsdc } from "@/lib/flow/amounts";
import { getBellPurchases, quoteBellPurchase } from "@/lib/flow/server-fns";
import { DEFAULT_BELL_POLICY, displayImpactPercent, displayTokenAmount } from "@/lib/bell/policy";
import type { BellPurchase, BellQuote } from "@/lib/bell/types";
import { BellExecution, BellReceiptHistory } from "./BellExecution";
export function BellQuoteBrief({ quote }: { quote: BellQuote }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000));
  return (
    <div className="stack-tight">
      <p role="status">{quote.decision.message}</p>
      <p className="meta">
        {displayUsdc(quote.inAmount)} USDC →{" "}
        {quote.outAmount === "0"
          ? "Unavailable"
          : `${displayTokenAmount(quote.outAmount, quote.outputDecimals)} ${quote.symbol}`}
      </p>
      {quote.outAmount !== "0" && (
        <>
          <p className="meta">
            Minimum received: {displayTokenAmount(quote.minimumOutput, quote.outputDecimals)}{" "}
            {quote.symbol} · Slippage limit: {quote.policy.slippageBps / 100}%
          </p>
          <p className="meta">
            Price impact:{" "}
            {quote.priceImpact === null ? "Unavailable" : displayImpactPercent(quote.priceImpact)} ·{" "}
            {seconds ? `${seconds}s until expiry` : "Quote expired"}
          </p>
        </>
      )}
      <p className="footnote">
        {quote.issuer} ·{" "}
        <a href={quote.instrumentUrl} target="_blank" rel="noreferrer" className="link">
          Instrument documentation
        </a>
      </p>
      <p className="footnote">
        Equity reference price and market-session data unavailable. No equity premium has been
        verified.
      </p>
      {quote.route.length > 0 && <p className="footnote">Route: {quote.route.join(" → ")}</p>}
    </div>
  );
}
function PurchaseQuote({ purchase }: { purchase: BellPurchase }) {
  const client = useQueryClient();
  const [slippage, setSlippage] = useState(
    String(purchase.quote?.policy.slippageBps ?? DEFAULT_BELL_POLICY.slippageBps),
  );
  const [impact, setImpact] = useState(
    String(purchase.quote?.policy.maxPriceImpactBps ?? DEFAULT_BELL_POLICY.maxPriceImpactBps),
  );
  const [maxPrice, setMaxPrice] = useState(
    purchase.quote?.policy.maxTokenPriceBase
      ? displayUsdc(purchase.quote.policy.maxTokenPriceBase)
      : "",
  );
  const [error, setError] = useState("");
  const quote = useMutation({
    mutationFn: () => {
      if (!/^\d{1,4}$/.test(slippage) || (impact && !/^\d{1,5}$/.test(impact)))
        throw new Error("Use integer basis points for execution limits.");
      return quoteBellPurchase({
        data: {
          id: purchase.id,
          policy: {
            slippageBps: Number(slippage),
            maxTokenPriceBase: maxPrice ? parseUsdc(maxPrice) : null,
            maxPriceImpactBps: impact ? Number(impact) : null,
            maxPremiumBps: null,
          },
        },
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["flow", "purchases"] }),
  });
  const quotable = ["pending", "deferred", "failed"].includes(purchase.state);
  return (
    <article className="panel stack">
      <div className="row">
        <h3>{purchase.symbol}</h3>
        <span className="meta">
          {purchase.state} · {displayUsdc(purchase.amountBase)} USDC
        </span>
      </div>
      {quotable && (
        <>
          <label>
            Slippage limit (basis points; 50 = 0.5%)
            <input
              className="input"
              inputMode="numeric"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
            />
          </label>
          <label>
            Price-impact limit (basis points; blank disables)
            <input
              className="input"
              inputMode="numeric"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
          </label>
          <label>
            Maximum token price (USDC; optional)
            <input
              className="input"
              inputMode="decimal"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </label>
          <button
            className="btn btn-outline"
            disabled={quote.isPending}
            onClick={() => {
              setError("");
              void quote
                .mutateAsync()
                .catch((caught: unknown) =>
                  setError(
                    caught instanceof Error ? caught.message : "Could not quote this purchase.",
                  ),
                );
            }}
          >
            {quote.isPending ? "Checking route…" : "Check execution quote"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {purchase.quote && <BellQuoteBrief quote={purchase.quote} />}
      <BellExecution purchase={purchase} />
    </article>
  );
}
export function BellPurchases() {
  const purchases = useQuery({
    queryKey: ["flow", "purchases"],
    queryFn: () => getBellPurchases(),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.purchases.some((p) => p.state === "submitted") ? 10000 : false,
  });
  return (
    <section className="stack">
      <h2 className="eyebrow">Bell investment orders</h2>
      <p className="meta">
        Check the exact purchase against your execution limits. Income stays in USDC until you
        approve and sign a trade.
      </p>
      {purchases.isPending ? (
        <p>Loading investment orders…</p>
      ) : purchases.isError ? (
        <p role="alert">{purchases.error.message}</p>
      ) : !purchases.data.purchases.length ? (
        <p className="meta">Allocate received income to create investment orders.</p>
      ) : (
        purchases.data.purchases.map((purchase) => (
          <PurchaseQuote key={purchase.id} purchase={purchase} />
        ))
      )}
      <BellReceiptHistory />
    </section>
  );
}
