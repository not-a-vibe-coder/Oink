import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Fuel } from "lucide-react";
import { AllocationRail } from "@/components/oink/AllocationRail";
import { CopyButton } from "@/components/oink/CopyButton";
import { ClaimTagAction } from "@/components/oink/LinkedAccounts";
import { Monogram } from "@/components/oink/Monogram";
import { Sheet } from "@/components/oink/Sheet";
import { useActivity, useMix, useWallet, useWalletAddress } from "@/hooks/useOink";
import { useWalletSession } from "@/lib/app-session";
import { formatTokenAmount, formatUsd, shortAddress, splitUsd, timeAgo, counterparty } from "@/lib/format";
import type { WalletHolding } from "@/types/token";

export const Route = createFileRoute("/app/")({
  component: WalletHome,
});

function WalletHome() {
  const { accountId, tag, publicKey } = useWalletSession();
  const wallet = useWallet();
  const address = useWalletAddress();
  const mixQuery = useMix(accountId);
  const activity = useActivity({ limit: 5 });
  const [openHolding, setOpenHolding] = useState<WalletHolding | null>(null);

  const holdings = wallet.data?.holdings ?? [];
  const mix = mixQuery.data?.mix ?? [];
  const balance = splitUsd(wallet.data?.totalValueUsd ?? null);
  const recent = activity.data?.transfers ?? [];

  return (
    <main className="shell">
      <div className="split">
        <div className="stack">
          <section>
            <p className="eyebrow">Total value</p>
            <p className="figure figure-lg" style={{ marginTop: 10 }}>
              {wallet.isPending ? (
                <span className="skeleton" style={{ width: 220, height: 52, display: "block" }} />
              ) : (
                <>
                  {balance.whole}
                  {balance.fraction && <span className="figure-cents">.{balance.fraction}</span>}
                </>
              )}
            </p>
            <p className="meta" style={{ marginTop: 10 }}>
              {holdings.length > 0
                ? `${holdings.length} asset${holdings.length === 1 ? "" : "s"} · ${formatTokenAmount(wallet.data?.solBalance, 4)} SOL for fees`
                : "Nothing here yet."}
            </p>
          </section>

          {mix.length > 0 && (
            <section>
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Money arriving settles into
              </p>
              <AllocationRail mix={mix} size="lg" label="Your mix" />
            </section>
          )}

          <section className="actions">
            <Link to="/app/send" className="action">
              <span className="action-label">Send</span>
              <span className="action-note">To a tag or an address</span>
            </Link>
            <Link to="/app/receive" className="action">
              <span className="action-label">Receive</span>
              <span className="action-note">Address, QR or a request</span>
            </Link>
            <Link to="/app/mix" className="action">
              <span className="action-label">Mix</span>
              <span className="action-note">Change your split</span>
            </Link>
          </section>

          {wallet.data?.needsSol && (
            <div className="notice">
              <Fuel size={16} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
              <span>
                Your wallet has no SOL, so Oink is covering network fees for now. Nothing to do —
                receiving a payment will top you up.
              </span>
            </div>
          )}

          <section>
            <div className="section-head">
              <h2 className="eyebrow">Holdings</h2>
              <Link to="/app/mix" className="link meta">
                Rebalance
              </Link>
            </div>

            {wallet.isPending ? (
              <LedgerSkeleton rows={3} />
            ) : holdings.length === 0 ? (
              <div className="empty">
                <p className="empty-title">No assets yet</p>
                <p className="empty-note">
                  Share your account ID, tag or address and the first payment will land in your mix.
                </p>
                <Link
                  to="/app/receive"
                  className="btn btn-outline btn-sm"
                  style={{ marginTop: "var(--s4)" }}
                >
                  Show my address
                </Link>
              </div>
            ) : (
              <div className="ledger">
                {holdings.map((holding) => (
                  <button
                    type="button"
                    className="ledger-row"
                    key={holding.mint}
                    onClick={() => setOpenHolding(holding)}
                  >
                    <Monogram symbol={holding.symbol} iconUrl={holding.iconUrl} />
                    <span className="ledger-main">
                      <span className="ledger-title">{holding.symbol}</span>
                      <span className="ledger-sub">
                        {holding.underlyingTicker
                          ? `${holding.name} · ${holding.underlyingTicker}`
                          : holding.name}
                      </span>
                    </span>
                    <span className="ledger-amount">
                      <span className="ledger-value tnum">{formatUsd(holding.valueUsd)}</span>
                      <span className="ledger-qty tnum">
                        {formatTokenAmount(holding.amount, holding.decimals)} {holding.symbol}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <p className="eyebrow">Your address</p>
            <p className="mono" style={{ marginTop: 10, color: "var(--ink-2)" }}>
              {shortAddress(address.data?.publicKey ?? publicKey, 8)}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <CopyButton value={address.data?.publicKey ?? publicKey} label="Copy address" />
              {address.data?.explorerUrl && (
                <a
                  className="copy-btn"
                  href={address.data.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowUpRight size={14} aria-hidden="true" /> Explorer
                </a>
              )}
            </div>
            <p className="footnote" style={{ marginTop: 10 }}>
              Anything sent here arrives as sent. Payments to <strong>@{tag}</strong> settle into
              your mix.
            </p>
          </section>

          <section>
            <div className="section-head">
              <h2 className="eyebrow">Recent</h2>
              <Link to="/app/activity" className="link meta">
                All activity
              </Link>
            </div>

            {activity.isPending ? (
              <LedgerSkeleton rows={3} />
            ) : recent.length === 0 ? (
              <p className="meta">No payments yet.</p>
            ) : (
              <div className="ledger">
                {recent.map((transfer) => (
                  <div className="ledger-row" key={transfer.signature}>
                    <span className="ledger-main">
                      <span className="ledger-title">
                        {transfer.isOutgoing
                          ? `To ${counterparty(transfer.recipient_tag, transfer.recipient_account_id, transfer.recipient_wallet)}`
                          : `From ${counterparty(transfer.sender_tag, transfer.sender_account_id, transfer.sender_wallet)}`}
                      </span>
                      <span className="ledger-sub">
                        {timeAgo(transfer.confirmed_at ?? transfer.created_at)}
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
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      <Sheet
        open={openHolding !== null}
        onClose={() => setOpenHolding(null)}
        title={openHolding ? `${openHolding.symbol}` : ""}
        description={openHolding?.name}
      >
        {openHolding && (
          <div className="stack-tight">
            <div className="row-between">
              <span className="meta">You hold</span>
              <span className="ledger-value tnum">
                {formatTokenAmount(openHolding.amount, openHolding.decimals)} {openHolding.symbol}
              </span>
            </div>
            <div className="row-between">
              <span className="meta">Value</span>
              <span className="ledger-value tnum">{formatUsd(openHolding.valueUsd)}</span>
            </div>
            <div className="row-between">
              <span className="meta">Price</span>
              <span className="ledger-value tnum">{formatUsd(openHolding.priceUsd)}</span>
            </div>

            <hr className="rule" style={{ margin: "var(--s3) 0" }} />

            <Link
              to="/app/send"
              search={{ token: openHolding.symbol, to: undefined, amount: undefined }}
              className="btn btn-primary btn-block"
              onClick={() => setOpenHolding(null)}
            >
              Send {openHolding.symbol}
            </Link>
            <Link
              to="/app/mix"
              className="btn btn-outline btn-block"
              onClick={() => setOpenHolding(null)}
            >
              Change what payments settle into
            </Link>
            <a
              className="btn btn-quiet btn-block"
              href={`https://solscan.io/token/${openHolding.mint}`}
              target="_blank"
              rel="noreferrer"
            >
              View {openHolding.symbol} on Solscan
            </a>
          </div>
        )}
      </Sheet>

      {!tag && <ClaimTagPrompt accountId={accountId} />}
    </main>
  );
}

/**
 * Wallets start without a tag; linking X is how one gets claimed (docs/12 §3). Offered once
 * per account on this device, and always reachable later from Settings. It also has to
 * be mounted when X's OAuth screen sends the user back here, to finish the link.
 */
function ClaimTagPrompt({ accountId }: { accountId: string }) {
  const dismissKey = `oink:claim-tag-dismissed:${accountId}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(dismissKey) !== "1");
    } catch {
      setOpen(true);
    }
  }, [dismissKey]);

  function dismiss() {
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      /* the prompt just comes back next visit */
    }
    setOpen(false);
  }

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title="Claim your @tag"
      description="Link your X account and your X username becomes your Oink tag."
    >
      <div className="stack">
        <p className="meta">
          People can then pay you at @yourname instead of your account ID. Linking is optional —
          you can do it later from Settings.
        </p>
        <ClaimTagAction onDone={dismiss} />
        <button type="button" className="btn btn-quiet btn-block" onClick={dismiss}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

function LedgerSkeleton({ rows }: { rows: number }) {
  return (
    <div className="ledger">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="ledger-row" key={index}>
          <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 8 }} />
          <div className="ledger-main">
            <div className="skeleton" style={{ height: 13, width: "40%" }} />
            <div className="skeleton" style={{ height: 11, width: "60%", marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
