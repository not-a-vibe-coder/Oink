import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Scale, X } from "lucide-react";
import { AllocationRail } from "@/components/oink/AllocationRail";
import { Monogram } from "@/components/oink/Monogram";
import { Sheet } from "@/components/oink/Sheet";
import { useAssets, useMix, useFeaturedAssets, useSaveMix } from "@/hooks/useOink";
import { useWalletSession } from "@/lib/app-session";
import { railColor, rankedByWeight } from "@/lib/rail-palette";
import type { MixItem, OinkToken } from "@/types/token";

export const Route = createFileRoute("/app/mix")({
  component: MixPage,
});

function MixPage() {
  const { accountId, tag } = useWalletSession();
  const handle = tag ? `@${tag}` : "your account";
  const stored = useMix(accountId);
  const save = useSaveMix(accountId);

  const [rows, setRows] = useState<MixItem[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stored.data && rows === null) {
      setRows(rankedByWeight(stored.data.mix));
    }
  }, [stored.data, rows]);

  const working = useMemo(() => rows ?? [], [rows]);
  const total = working.reduce((sum, row) => sum + row.basisPoints, 0);
  const balanced = total === 10000;
  const dirty = useMemo(() => {
    const original = stored.data?.mix ?? [];
    if (original.length !== working.length) return true;
    const map = new Map(original.map((item) => [item.mint, item.basisPoints]));
    return working.some((row) => map.get(row.mint) !== row.basisPoints);
  }, [stored.data, working]);

  function update(mint: string, basisPoints: number) {
    setSaved(false);
    setRows((prev) =>
      (prev ?? []).map((row) =>
        row.mint === mint
          ? { ...row, basisPoints: Math.max(0, Math.min(10000, Math.round(basisPoints))) }
          : row,
      ),
    );
  }

  function remove(mint: string) {
    setSaved(false);
    setRows((prev) => (prev ?? []).filter((row) => row.mint !== mint));
  }

  function add(token: OinkToken) {
    setSaved(false);
    setPickerOpen(false);
    setRows((prev) => {
      const current = prev ?? [];
      if (current.some((row) => row.mint === token.mint)) return current;
      // A new row starts at whatever is unallocated, or borrows a tenth of the
      // total so the bar changes visibly rather than appearing as a hairline.
      const remaining = 10000 - current.reduce((sum, row) => sum + row.basisPoints, 0);
      return [
        ...current,
        {
          symbol: token.symbol,
          mint: token.mint,
          decimals: token.decimals,
          basisPoints: remaining > 0 ? remaining : 1000,
        },
      ];
    });
  }

  /** Spreads the difference proportionally, then puts the rounding remainder on the largest row. */
  function normalise() {
    setSaved(false);
    setRows((prev) => {
      const current = prev ?? [];
      if (current.length === 0) return current;
      const sum = current.reduce((acc, row) => acc + row.basisPoints, 0);
      if (sum === 0) {
        const even = Math.floor(10000 / current.length);
        return current.map((row, index) => ({
          ...row,
          basisPoints: index === 0 ? 10000 - even * (current.length - 1) : even,
        }));
      }
      const scaled = current.map((row) => ({
        ...row,
        basisPoints: Math.max(1, Math.round((row.basisPoints / sum) * 10000)),
      }));
      const drift = 10000 - scaled.reduce((acc, row) => acc + row.basisPoints, 0);
      const largest = scaled.reduce((a, b) => (a.basisPoints >= b.basisPoints ? a : b));
      largest.basisPoints += drift;
      return scaled;
    });
  }

  async function commit() {
    if (!balanced || working.length === 0) return;
    setError(null);
    const result = await save.mutateAsync(working);
    if (result.ok) {
      setRows(rankedByWeight(result.data.mix));
      setSaved(true);
    } else {
      setError(result.message);
    }
  }

  const ranked = rankedByWeight(working);

  return (
    <main className="stage stage-wide">
      <header className="page-head">
        <h1 className="page-title">
          Your <span className="serif">mix</span>
        </h1>
        <p className="page-sub">
          Every payment that arrives at {handle} is split this way, in one transaction, before it ever
          sits still as cash.
        </p>
      </header>

      <div className="stack">
        <section>
          <AllocationRail mix={working} size="lg" showKey={false} label="Your mix" />
          <div className="row-between" style={{ marginTop: "var(--s3)" }}>
            <span className="meta tnum">
              {(total / 100).toFixed(total % 100 === 0 ? 0 : 1)}% allocated
            </span>
            {!balanced && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={normalise}>
                <Scale size={14} aria-hidden="true" /> Normalise to 100%
              </button>
            )}
          </div>
          {!balanced && working.length > 0 && (
            <p className="hint" data-tone="bad" style={{ marginTop: 6 }}>
              {total > 10000
                ? `${((total - 10000) / 100).toFixed(1)}% over. Allocations must total exactly 100%.`
                : `${((10000 - total) / 100).toFixed(1)}% still unallocated.`}
            </p>
          )}
        </section>

        <section>
          {stored.isPending && rows === null ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : working.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No assets elected</p>
              <p className="empty-note">
                Pick at least one. Most people start with a stock they believe in and keep some USDC
                for spending.
              </p>
            </div>
          ) : (
            <div className="ledger">
              {ranked.map((row, index) => (
                <div className="ledger-row" key={row.mint}>
                  <span
                    className="rail-key-swatch"
                    style={{ background: railColor(index), width: 10, height: 10 }}
                    aria-hidden="true"
                  />
                  <Monogram symbol={row.symbol} />
                  <span className="ledger-main">
                    <span className="ledger-title">{row.symbol}</span>
                    <span className="ledger-sub">
                      <input
                        className="slider"
                        type="range"
                        min={0}
                        max={10000}
                        step={100}
                        value={row.basisPoints}
                        onChange={(event) => update(row.mint, Number(event.target.value))}
                        aria-label={`${row.symbol} allocation`}
                      />
                    </span>
                  </span>
                  <span className="pct-field">
                    <input
                      className="pct-input tnum"
                      value={(row.basisPoints / 100).toString()}
                      onChange={(event) =>
                        update(
                          row.mint,
                          Number(event.target.value.replace(/[^\d.]/g, "") || 0) * 100,
                        )
                      }
                      inputMode="decimal"
                      aria-label={`${row.symbol} percentage`}
                    />
                    <span className="pct-sign">%</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => remove(row.mint)}
                    aria-label={`Remove ${row.symbol}`}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginTop: "var(--s3)" }}
            onClick={() => setPickerOpen(true)}
            disabled={working.length >= 10}
          >
            <Plus size={14} aria-hidden="true" /> Add an asset
          </button>
          {working.length >= 10 && (
            <p className="hint">Ten assets is the limit for one mix.</p>
          )}
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {saved ? (
          <div className="callout" data-tone="seal">
            <strong>Saved.</strong> From now on, payments to {handle} land as{" "}
            {ranked.map((row, index) => (
              <span key={row.mint}>
                {index > 0 ? (index === ranked.length - 1 ? " and " : ", ") : ""}
                {(row.basisPoints / 100).toFixed(0)}% {row.symbol}
              </span>
            ))}
            . What you already hold stays where it is — send it to yourself to rebalance, or just
            let the next payment do the work.
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!balanced || !dirty || working.length === 0 || save.isPending}
            onClick={() => void commit()}
          >
            {save.isPending ? "Saving…" : "Save mix"}
          </button>
        )}

        <p className="footnote">
          This changes where future payments land. It never moves money on its own — see{" "}
          <Link to="/app/activity" className="link">
            activity
          </Link>{" "}
          for anything that actually settled.
        </p>
      </div>

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={add}
        chosen={working.map((row) => row.mint)}
      />
    </main>
  );
}

function AssetPicker({
  open,
  onClose,
  onPick,
  chosen,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (token: OinkToken) => void;
  chosen: string[];
}) {
  const [search, setSearch] = useState("");
  const featured = useFeaturedAssets();
  const results = useAssets({ search: search.trim() || undefined, limit: 40 });

  const showing = search.trim()
    ? (results.data?.assets ?? [])
    : [...(featured.data?.baseCurrencies ?? []), ...(featured.data?.featured ?? [])];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add an asset"
      description="Tokenized stocks and ETFs, plus the currencies you can spend."
    >
      <div className="stack-tight">
        <input
          className="input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search NVDA, gold, S&P…"
          aria-label="Search assets"
        />

        <div className="ledger" style={{ maxHeight: 420, overflowY: "auto" }}>
          {showing.map((token) => {
            const already = chosen.includes(token.mint);
            return (
              <button
                type="button"
                className="ledger-row"
                key={token.mint}
                disabled={already}
                onClick={() => onPick(token)}
                style={already ? { opacity: 0.4 } : undefined}
              >
                <Monogram symbol={token.symbol} iconUrl={token.iconUrl} />
                <span className="ledger-main">
                  <span className="ledger-title">{token.symbol}</span>
                  <span className="ledger-sub">{token.name}</span>
                </span>
                {already && <span className="badge">Added</span>}
              </button>
            );
          })}

          {showing.length === 0 && (
            <p className="meta" style={{ padding: "var(--s4) 0" }}>
              Nothing matches “{search}”.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
