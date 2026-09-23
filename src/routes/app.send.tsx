import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, TriangleAlert } from "lucide-react";
import { AllocationRail } from "@/components/oink/AllocationRail";
import { Monogram } from "@/components/oink/Monogram";
import { PigAvatar } from "@/components/oink/PigAvatar";
import { UnlockInline } from "@/components/oink/UnlockInline";
import { useKeySession } from "@/hooks/useKeySession";
import { queryKeys, useResolveTags, useWallet } from "@/hooks/useOink";
import { useWalletSession } from "@/lib/app-session";
import { buildTransfer, quoteTransfer, submitTransfer } from "@/lib/oink-server-fns";
import {
  formatTokenAmount,
  formatUsd,
  isLikelyAddress,
  normalizeTagInput,
  shortAddress,
} from "@/lib/format";
import { signTransaction } from "@/lib/wallet/key-session";
import type { TransferQuote } from "@/types/api";

export const Route = createFileRoute("/app/send")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { token?: string; to?: string; amount?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    amount: typeof search.amount === "string" ? search.amount : undefined,
  }),
  component: SendPage,
});

type Phase = "compose" | "signing" | "submitting" | "sent";

function SendPage() {
  const { token: tokenParam, to: toParam, amount: amountParam } = Route.useSearch();
  const { accountId, tag, publicKey } = useWalletSession();
  const { unlocked } = useKeySession();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const holdings = useMemo(() => wallet.data?.holdings ?? [], [wallet.data]);
  const [recipient, setRecipient] = useState(toParam ?? "");
  const [symbol, setSymbol] = useState(tokenParam ?? "");
  const [amount, setAmount] = useState(amountParam ?? "");

  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("compose");
  const [sendError, setSendError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ signature: string; explorerUrl: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Default to the largest holding rather than making the user pick first.
  useEffect(() => {
    if (!symbol && holdings.length > 0) setSymbol(holdings[0].symbol);
  }, [symbol, holdings]);

  const selected = holdings.find((holding) => holding.symbol === symbol);
  const recipientIsAddress = isLikelyAddress(recipient);
  const recipientTag = recipientIsAddress ? "" : normalizeTagInput(recipient);
  const typeahead = useResolveTags(
    recipientTag.length >= 2 && !recipientIsAddress ? recipientTag : "",
  );

  const amountValid = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value > 0;
  }, [amount]);

  const canQuote =
    (recipientIsAddress || recipientTag.length >= 3) && amountValid && Boolean(symbol);

  const requestQuote = useCallback(async () => {
    if (!canQuote) return;
    setQuoting(true);
    setQuoteError(null);

    const result = await quoteTransfer({
      data: {
        recipient: recipientIsAddress ? recipient.trim() : `@${recipientTag}`,
        fromSymbolOrMint: symbol,
        amountIn: amount,
      },
    });

    setQuoting(false);
    if (result.ok) {
      setQuote(result.data);
    } else {
      setQuote(null);
      setQuoteError(result.message);
    }
  }, [canQuote, recipient, recipientIsAddress, recipientTag, symbol, amount]);

  // Debounced re-quote as the form changes.
  const quoteRef = useRef(requestQuote);
  quoteRef.current = requestQuote;
  useEffect(() => {
    if (!canQuote) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => void quoteRef.current(), 450);
    return () => clearTimeout(timer);
  }, [canQuote, recipient, symbol, amount]);

  // Quotes live 30 seconds. Show the clock, then refresh it silently.
  useEffect(() => {
    if (!quote || phase !== "compose") return;

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.round((new Date(quote.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0) void quoteRef.current();
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote, phase]);

  async function send() {
    if (!quote) return;
    setSendError(null);
    setPhase("signing");

    try {
      const built = await buildTransfer({
        data: { quoteId: quote.quoteId, sponsorFee: quote.sponsorship.available },
      });
      if (!built.ok) {
        setSendError(built.message);
        setPhase("compose");
        return;
      }

      // The only place a signature happens. The server re-validates this against
      // the message it built before it broadcasts anything.
      const signed = signTransaction(built.data.transaction);

      setPhase("submitting");
      const submitted = await submitTransfer({
        data: { quoteId: quote.quoteId, signedTransaction: signed },
      });

      if (!submitted.ok) {
        setSendError(submitted.message);
        setPhase("compose");
        return;
      }

      setReceipt({
        signature: submitted.data.signature,
        explorerUrl: submitted.data.explorerUrl,
      });
      setPhase("sent");
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallet });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    } catch (err) {
      setSendError(
        err instanceof Error && err.message === "Wallet is locked."
          ? "Your wallet locked while you were away. Unlock and try again."
          : "That transaction did not go through. Nothing was sent.",
      );
      setPhase("compose");
    }
  }

  if (phase === "sent" && receipt) {
    return (
      <main className="stage stage-wide">
        <header className="page-head">
          <p className="eyebrow">Confirmed</p>
          <h1 className="page-title" style={{ marginTop: 10 }}>
            Sent {formatTokenAmount(amount)} {symbol} to{" "}
            <span className="serif">
              {quote?.recipient.tag
                ? `@${quote.recipient.tag}`
                : shortAddress(quote?.recipient.wallet, 6)}
            </span>
          </h1>
        </header>

        {quote && quote.legs.length > 0 && (
          <div className="panel" style={{ marginBottom: "var(--s4)" }}>
            <p className="eyebrow" style={{ marginBottom: 10 }}>
              They received
            </p>
            {quote.legs.map((leg) => (
              <div className="row-between" key={leg.mint} style={{ padding: "6px 0" }}>
                <span className="ledger-title">{leg.symbol}</span>
                <span className="ledger-value tnum">{leg.outAmountFormatted}</span>
              </div>
            ))}
          </div>
        )}

        <div className="stack-tight">
          <p className="meta">
            Signature <span className="mono">{shortAddress(receipt.signature, 10)}</span>
          </p>
          <div className="btn-row">
            <a
              className="btn btn-outline"
              href={receipt.explorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight size={15} aria-hidden="true" /> View on Solscan
            </a>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => void navigate({ to: "/app" })}
            >
              Done
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="stage stage-wide">
      <header className="page-head">
        <h1 className="page-title">Send</h1>
        <p className="page-sub">
          Pay a tag and it settles into their mix. Pay a raw address and it arrives exactly as
          sent.
        </p>
      </header>

      <div className="stack">
        {/* 1 — who */}
        <section className="field">
          <label className="field-label" htmlFor="recipient">
            To
          </label>
          <div className="input-group">
            <span className="input-lead" aria-hidden="true">
              @
            </span>
            <input
              id="recipient"
              className="input"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="tag or Solana address"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {recipientIsAddress ? (
            <p className="hint">
              A raw address. This one has no mix, so it receives {symbol || "your token"} as
              sent.
            </p>
          ) : (
            (typeahead.data?.results?.length ?? 0) > 0 &&
            recipientTag !== quote?.recipient.tag && (
              <div className="chip-row" style={{ marginTop: 4 }}>
                {typeahead.data!.results.slice(0, 5).map((result) => (
                  <button
                    key={result.tag}
                    type="button"
                    className="chip"
                    onClick={() => setRecipient(result.tag)}
                  >
                    <PigAvatar seed={result.avatarSeed} size={18} />@{result.tag}
                  </button>
                ))}
              </div>
            )
          )}
        </section>

        {/* 2 — how much */}
        <section className="field">
          <div className="row-between">
            <label className="field-label" htmlFor="amount">
              Amount
            </label>
            {selected && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setAmount(maxSpendable(selected.symbol, selected.amount))}
              >
                Max {formatTokenAmount(selected.amount, selected.decimals)}
              </button>
            )}
          </div>
          <input
            id="amount"
            className="input input-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
          />

          <div className="chip-row" style={{ marginTop: 10 }}>
            {holdings.map((holding) => (
              <button
                key={holding.mint}
                type="button"
                className="chip"
                data-selected={holding.symbol === symbol}
                onClick={() => setSymbol(holding.symbol)}
              >
                <Monogram symbol={holding.symbol} iconUrl={holding.iconUrl} size={18} />
                {holding.symbol}
              </button>
            ))}
            {holdings.length === 0 && !wallet.isPending && (
              <p className="meta">
                Nothing to send yet.{" "}
                <Link to="/app/receive" className="link">
                  Receive something first
                </Link>
                .
              </p>
            )}
          </div>
        </section>

        {/* 3 — what lands */}
        {canQuote && (
          <section>
            <div className="section-head">
              <h2 className="eyebrow">
                {quote?.recipient.tag ? `@${quote.recipient.tag} receives` : "They receive"}
              </h2>
              {quote && <span className="meta tnum">refreshes in {secondsLeft}s</span>}
            </div>

            {quote && (
              <div className="countdown" style={{ marginBottom: "var(--s3)" }}>
                <div
                  className="countdown-fill"
                  style={{ width: `${Math.min(100, (secondsLeft / 30) * 100)}%` }}
                />
              </div>
            )}

            {quoting && !quote && <div className="skeleton" style={{ height: 120 }} />}

            {quoteError && (
              <div className="callout" data-tone="danger">
                {quoteError}
              </div>
            )}

            {quote && (
              <div className="panel">
                <AllocationRail
                  mix={quote.legs.map((leg) => ({
                    symbol: leg.symbol,
                    mint: leg.mint,
                    basisPoints: leg.basisPoints,
                  }))}
                  showKey={false}
                  label="How this payment splits"
                />

                <div className="ledger" style={{ marginTop: "var(--s3)" }}>
                  {quote.legs.map((leg) => (
                    <div className="ledger-row" key={leg.mint} style={{ minHeight: 56 }}>
                      <span className="ledger-main">
                        <span className="ledger-title">{leg.symbol}</span>
                        <span className="ledger-sub tnum">
                          {(leg.basisPoints / 100).toFixed(0)}% ·{" "}
                          {leg.route === "direct"
                            ? "no swap"
                            : `impact ${leg.priceImpactPct.toFixed(2)}%`}
                        </span>
                      </span>
                      <span className="ledger-amount">
                        <span className="ledger-value tnum">{leg.outAmountFormatted}</span>
                      </span>
                    </div>
                  ))}
                </div>

                {quote.legs.some((leg) => leg.safeSettled) && (
                  <div className="callout" data-tone="warn" style={{ marginTop: "var(--s3)" }}>
                    <TriangleAlert
                      size={15}
                      aria-hidden="true"
                      style={{ float: "left", marginRight: 8 }}
                    />
                    Some of this was routed to USDC instead — price impact on the elected asset was
                    above the safe limit. The money still arrives, just not in that stock.
                  </div>
                )}

                <p className="footnote" style={{ marginTop: "var(--s3)" }}>
                  Network fee {(quote.networkFeeLamports / 1e9).toFixed(6)} SOL
                  {quote.sponsorship.available
                    ? ` · Oink is covering it (${quote.sponsorship.remainingToday} left today)`
                    : ""}
                </p>
              </div>
            )}
          </section>
        )}

        {/* 4 — confirm */}
        {!unlocked ? (
          <UnlockInline
            accountId={accountId}
            tag={tag}
            publicKey={publicKey}
            onUnlocked={() => setSendError(null)}
            reason="Your key is not in memory. Unlock to sign this payment — no code needed, the key is the authority."
          />
        ) : (
          <>
            {sendError && (
              <p className="form-error" role="alert">
                {sendError}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!quote || phase !== "compose" || quoting}
              onClick={() => void send()}
            >
              {phase === "signing"
                ? "Signing…"
                : phase === "submitting"
                  ? "Submitting…"
                  : quote
                    ? `Send ${formatTokenAmount(amount)} ${symbol}`
                    : "Send"}
            </button>
            {quote?.recipient.kind === "address" && (
              <p className="footnote">
                <Check size={12} aria-hidden="true" /> Going to{" "}
                {shortAddress(quote.recipient.wallet, 6)} — check it once more. A payment to the
                wrong address cannot be undone.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * SOL doubles as the fee token, so a "max" that spends all of it would leave a
 * wallet unable to transact. Everything else can go to the last unit.
 */
function maxSpendable(symbol: string, amount: string): string {
  if (symbol !== "SOL") return amount;
  const reserve = 0.002;
  const spendable = Math.max(0, Number(amount) - reserve);
  return spendable.toFixed(6);
}
