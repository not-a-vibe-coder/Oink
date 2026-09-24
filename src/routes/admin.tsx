/**
 * The admin dashboard (docs/12 §8).
 *
 * Signing in is a Privy email proof checked against ADMIN_EMAILS on the API, which then
 * sets its own HttpOnly admin cookie. Privy is only mounted on the sign-in screen; the
 * dashboard itself is plain server-function reads. Everything here is read-only apart
 * from review verdicts, and the API audits every table read and verdict.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ExternalLink, Flag, Check, RotateCcw } from "lucide-react";
import { PrivyGate } from "@/lib/privy/PrivyGate";
import { privyAvailable } from "@/lib/privy/config";
import { useIdentityProof } from "@/lib/privy/useIdentityProof";
import {
  adminActivity,
  adminHeld,
  adminHeldRetry,
  adminLogin,
  adminLogout,
  adminMe,
  adminOverview,
  adminReview,
  adminTable,
  adminTables,
  adminTransfers,
} from "@/lib/oink-server-fns";
import { formatDateTime, formatTokenAmount, fromBaseUnits, shortAddress, timeAgo } from "@/lib/format";
import type { AdminActivityItem, AdminHeldPayment, AdminTransfer, Json } from "@/types/api";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Oink admin" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AdminPage,
});

const PAGE_SIZE = 25;

function AdminPage() {
  const me = useQuery({ queryKey: ["admin", "me"], queryFn: () => adminMe(), retry: false });

  if (me.isPending) {
    return (
      <main className="stage">
        <div className="skeleton" style={{ height: 200 }} />
      </main>
    );
  }
  if (!me.data?.ok) return <SignIn onSignedIn={() => void me.refetch()} />;
  return <Dashboard email={me.data.data.email} />;
}

// ── Sign in ────────────────────────────────────────────────────────────────

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <main className="stage">
      <header className="page-head">
        <p className="eyebrow">Oink</p>
        <h1 className="page-title">Admin</h1>
        <p className="page-sub">Sign in with an admin email. You'll get a code to prove it's yours.</p>
      </header>
      <PrivyGate
        fallback={
          <p className="meta">
            {privyAvailable ? "Loading sign-in…" : "Admin sign-in needs Privy, which isn't configured on this deployment yet."}
          </p>
        }
      >
        <SignInButton onSignedIn={onSignedIn} />
      </PrivyGate>
    </main>
  );
}

function SignInButton({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const proof = useIdentityProof({
    purposes: ["admin"],
    onProof: async (_purpose, identityToken) => {
      const result = await adminLogin({ data: { identityToken } });
      if (result.ok) onSignedIn();
      else {
        console.error(`[oink:privy] API refused admin sign-in — ${result.code}: ${result.message}`);
        setError(result.message);
      }
    },
    onError: setError,
  });
  return (
    <div className="stack-tight">
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!proof.ready || proof.busy}
        onClick={() => {
          setError(null);
          void proof.start("admin");
        }}
      >
        {proof.busy ? "Waiting for the code…" : "Sign in with email"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

type Tab = "overview" | "transfers" | "held" | "activity" | "database";

function Dashboard({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  async function signOut() {
    await adminLogout();
    queryClient.removeQueries({ queryKey: ["admin"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
  }

  return (
    <main className="shell">
      <header className="row-between" style={{ marginBottom: "var(--s5)", flexWrap: "wrap", gap: "var(--s3)" }}>
        <div>
          <p className="eyebrow">Oink admin</p>
          <p className="meta" style={{ marginTop: 4 }}>
            {email}
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div className="tabs" role="tablist" aria-label="Admin sections" style={{ marginBottom: "var(--s5)", flexWrap: "wrap" }}>
        {(["overview", "transfers", "held", "activity", "database"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="tab"
            data-active={tab === name}
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name === "transfers" ? "Transactions" : name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview />}
      {tab === "transfers" && <Transfers />}
      {tab === "held" && <Held />}
      {tab === "activity" && <Activity />}
      {tab === "database" && <Database />}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "bad" | "warn" }) {
  return (
    <div className="panel">
      <p className="eyebrow">{label}</p>
      <p className="figure figure-md tnum" style={{ marginTop: 8, color: tone === "bad" ? "var(--alarm)" : undefined }}>
        {value}
      </p>
    </div>
  );
}

function Overview() {
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminOverview(), refetchInterval: 30_000 });
  const data = overview.data;
  if (overview.isPending) return <div className="skeleton" style={{ height: 240 }} />;
  if (!data) return <p className="form-error">Couldn't load the overview.</p>;

  const sol = data.feePayerSol === null ? null : Number(data.feePayerSol);
  return (
    <div className="stack">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "var(--s3)" }}>
        <Stat label="Wallets" value={data.wallets} />
        <Stat label="New today" value={data.wallets_24h} />
        <Stat label="With a tag" value={data.tagged} />
        <Stat label="Email linked" value={data.emails_linked} />
        <Stat label="X linked" value={data.x_linked} />
        <Stat label="Transfers" value={data.transfers} />
        <Stat label="Transfers today" value={data.transfers_24h} />
        <Stat label="Failed transfers" value={data.transfers_failed} tone={data.transfers_failed > 0 ? "bad" : undefined} />
        <Stat label="Failed logins today" value={data.failed_logins_24h} tone={data.failed_logins_24h > 20 ? "bad" : undefined} />
        <Stat label="Flagged" value={data.flagged} tone={data.flagged > 0 ? "warn" : undefined} />
        <Stat label="Held, pending" value={data.held_pending} />
        <Stat label="Held, stuck" value={data.held_failed} tone={data.held_failed > 0 ? "bad" : undefined} />
      </div>

      <section className="panel">
        <div className="row-between" style={{ flexWrap: "wrap", gap: "var(--s3)" }}>
          <div>
            <p className="eyebrow">Fee payer</p>
            <p className="mono meta" style={{ marginTop: 6 }}>
              {data.feePayer ?? "not configured"}
            </p>
          </div>
          <p className="figure figure-md tnum" style={{ color: sol !== null && sol < 0.05 ? "var(--alarm)" : undefined }}>
            {sol === null ? "—" : `${data.feePayerSol} SOL`}
          </p>
        </div>
        <p className="meta" style={{ marginTop: "var(--s2)" }}>
          {sol !== null && sol < 0.05
            ? "Low: sponsored sends will start failing. Top it up."
            : `Sponsored today: ${(Number(data.sponsored_lamports_today) / 1e9).toFixed(5)} SOL.`}
        </p>
      </section>
    </div>
  );
}

// ── Review controls ────────────────────────────────────────────────────────

function ReviewBadge({ status }: { status: "reviewed" | "flagged" | null }) {
  if (status === "flagged") return <span className="badge" data-tone="bad">Flagged</span>;
  if (status === "reviewed") return <span className="badge" data-tone="ok">Reviewed</span>;
  return null;
}

function ReviewActions({
  source,
  id,
  status,
  invalidate,
}: {
  source: "event" | "login" | "transfer";
  id: number;
  status: "reviewed" | "flagged" | null;
  invalidate: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function set(next: "reviewed" | "flagged" | "clear") {
    let note: string | undefined;
    if (next === "flagged") note = window.prompt("Why flag this? (optional)") ?? undefined;
    setBusy(true);
    await adminReview({ data: { source, sourceId: id, status: next, note } });
    setBusy(false);
    invalidate();
  }
  return (
    <div className="row" style={{ gap: 6 }}>
      {status !== "reviewed" && (
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void set("reviewed")} title="Mark reviewed">
          <Check size={14} aria-hidden="true" /> OK
        </button>
      )}
      {status !== "flagged" && (
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void set("flagged")} title="Flag">
          <Flag size={14} aria-hidden="true" /> Flag
        </button>
      )}
      {status && (
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void set("clear")} title="Clear verdict">
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (page: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  return (
    <div className="row-between" style={{ marginTop: "var(--s4)" }}>
      <button type="button" className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
        Newer
      </button>
      <span className="meta tnum">
        {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
      </span>
      <button type="button" className="btn btn-outline btn-sm" disabled={page >= last} onClick={() => setPage(page + 1)}>
        Older
      </button>
    </div>
  );
}

const who = (tag: string | null, accountId: string | null, wallet: string) =>
  tag ? `@${tag}` : accountId ?? shortAddress(wallet);

// ── Transactions ───────────────────────────────────────────────────────────

function Transfers() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const key = ["admin", "transfers", page, status, q];
  const transfers = useQuery({
    queryKey: key,
    queryFn: () =>
      adminTransfers({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, status: status || undefined, q: q || undefined } }),
  });

  return (
    <div className="stack">
      <form
        className="row"
        style={{ gap: "var(--s2)", flexWrap: "wrap" }}
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setQ(search.trim());
        }}
      >
        <input
          className="input"
          style={{ flex: "1 1 240px" }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Signature, address, tag or account ID"
        />
        <select
          className="input"
          style={{ flex: "0 0 150px" }}
          value={status}
          onChange={(event) => {
            setPage(0);
            setStatus(event.target.value);
          }}
        >
          <option value="">Any status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <button type="submit" className="btn btn-outline btn-sm">
          Search
        </button>
      </form>

      {transfers.isPending ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (transfers.data?.transfers.length ?? 0) === 0 ? (
        <div className="empty">
          <p className="empty-title">No transfers</p>
        </div>
      ) : (
        <div className="ledger">
          {transfers.data!.transfers.map((t: AdminTransfer) => (
            <div className="ledger-row" key={t.id} style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <span className="ledger-main" style={{ minWidth: 220 }}>
                <span className="ledger-title">
                  {who(t.sender_tag, t.sender_account_id, t.sender_wallet)} →{" "}
                  {who(t.recipient_tag, t.recipient_account_id, t.recipient_wallet)}
                </span>
                <span className="ledger-sub">
                  {formatDateTime(t.created_at)} · {t.source}
                  {t.mix_applied ? " · mixed" : ""}
                  {t.fee_sponsored ? " · sponsored" : ""}
                  {t.review_note ? ` · “${t.review_note}”` : ""}
                </span>
              </span>
              <span className="ledger-amount" style={{ gap: 6 }}>
                <span className="ledger-value tnum">
                  {formatTokenAmount(t.input_amount)} {t.input_symbol}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {t.status !== "confirmed" && (
                    <span className="badge" data-tone={t.status === "failed" ? "bad" : "warn"}>
                      {t.status}
                    </span>
                  )}
                  <ReviewBadge status={t.review_status} />
                  <a className="btn btn-quiet btn-sm" href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </span>
                <ReviewActions
                  source="transfer"
                  id={t.id}
                  status={t.review_status}
                  invalidate={() => void queryClient.invalidateQueries({ queryKey: ["admin", "transfers"] })}
                />
              </span>
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={transfers.data?.total ?? 0} setPage={setPage} />
    </div>
  );
}

// ── Held payments ──────────────────────────────────────────────────────────

const HELD_TONES: Record<string, "ok" | "warn" | "bad" | undefined> = {
  held: "warn",
  claiming: "warn",
  refunding: "warn",
  claimed: "ok",
  failed: "bad",
};

function Held() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const held = useQuery({
    queryKey: ["admin", "held", page, status],
    queryFn: () => adminHeld({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, status: status || undefined } }),
    refetchInterval: 30_000,
  });

  async function retry(id: number) {
    setBusy(id);
    await adminHeldRetry({ data: { id } });
    setBusy(null);
    void queryClient.invalidateQueries({ queryKey: ["admin", "held"] });
  }

  return (
    <div className="stack">
      {(held.data?.pending.length ?? 0) > 0 && (
        <p className="meta">
          Waiting in holding wallets:{" "}
          {held.data!.pending
            .map((p) => `${formatTokenAmount(fromBaseUnits(p.amount_base, p.decimals))} ${p.symbol} across ${p.payments}`)
            .join(" · ")}
        </p>
      )}
      <div className="chip-row">
        {["", "held", "claimed", "refunded", "failed"].map((name) => (
          <button
            key={name || "all"}
            type="button"
            className="chip"
            style={status === name ? { borderColor: "var(--ink)", color: "var(--ink)" } : undefined}
            onClick={() => {
              setPage(0);
              setStatus(name);
            }}
          >
            {name ? name[0].toUpperCase() + name.slice(1) : "All"}
          </button>
        ))}
      </div>

      {held.isPending ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : (held.data?.held.length ?? 0) === 0 ? (
        <div className="empty">
          <p className="empty-title">No held payments</p>
        </div>
      ) : (
        <div className="ledger">
          {held.data!.held.map((h: AdminHeldPayment) => (
            <div className="ledger-row" key={h.id} style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <span className="ledger-main" style={{ minWidth: 240 }}>
                <span className="ledger-title">
                  {h.sender_tag ? `@${h.sender_tag}` : h.sender_account_id ?? "unknown"} → {h.recipient_display}
                  {h.claimant_account_id && ` (claimed by ${h.claimant_tag ? `@${h.claimant_tag}` : h.claimant_account_id})`}
                </span>
                <span className="ledger-sub">
                  {formatDateTime(h.created_at)} · expires {formatDateTime(h.expires_at)}
                  {h.notified_at ? " · emailed" : ""}
                  {h.attempts > 0 ? ` · ${h.attempts} attempt${h.attempts === 1 ? "" : "s"}` : ""}
                  {h.last_error ? ` · ${h.last_error}` : ""}
                </span>
                <span className="ledger-sub mono">holding {shortAddress(h.holding_wallet, 6)}</span>
              </span>
              <span className="ledger-amount" style={{ gap: 6 }}>
                <span className="ledger-value tnum">
                  {formatTokenAmount(fromBaseUnits(h.amount_base, h.decimals))} {h.symbol}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="badge" data-tone={HELD_TONES[h.status]}>
                    {h.status}
                  </span>
                  <a className="btn btn-quiet btn-sm" href={`https://solscan.io/tx/${h.release_signature ?? h.deposit_signature}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </span>
                {h.status === "failed" && (
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy === h.id} onClick={() => void retry(h.id)}>
                    <RotateCcw size={14} aria-hidden="true" /> Retry
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={held.data?.total ?? 0} setPage={setPage} />
    </div>
  );
}

// ── Activity ───────────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  wallet_created: "Wallet created",
  recovered: "Recovered with phrase",
  password_changed: "Password changed",
  email_linked: "Email linked",
  email_unlinked: "Email unlinked",
  x_linked: "X linked",
  x_unlinked: "X unlinked",
  tag_assigned: "Tag claimed",
  tag_lost: "Tag lost to X owner",
  held_sent: "Sent to someone not on Oink",
  held_claimed: "Claimed a held payment",
  held_refunded: "Held payment refunded",
  unlock: "Sign-in",
  totp: "Sign-in (code)",
  recover: "Recovery attempt",
  admin_login: "Admin sign-in",
};

function describeDetail(detail: { [key: string]: Json }): string {
  const parts = Object.entries(detail).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return parts.join(" · ");
}

function Activity() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<"all" | "unreviewed" | "flagged" | "failures">("all");
  const activity = useQuery({
    queryKey: ["admin", "activity", page, filter],
    queryFn: () => adminActivity({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, filter } }),
  });

  return (
    <div className="stack">
      <div className="chip-row">
        {(["all", "unreviewed", "flagged", "failures"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className="chip"
            data-active={filter === name}
            style={filter === name ? { borderColor: "var(--ink)", color: "var(--ink)" } : undefined}
            onClick={() => {
              setPage(0);
              setFilter(name);
            }}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>

      {activity.isPending ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (activity.data?.items.length ?? 0) === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing here</p>
        </div>
      ) : (
        <div className="ledger">
          {activity.data!.items.map((item: AdminActivityItem) => (
            <div className="ledger-row" key={`${item.source}-${item.id}`} style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <span className="ledger-main" style={{ minWidth: 220 }}>
                <span className="ledger-title">
                  {KIND_LABELS[item.kind] ?? item.kind}
                  {item.succeeded === false && <span style={{ color: "var(--alarm)" }}> · failed</span>}
                </span>
                <span className="ledger-sub">
                  {item.tag ? `@${item.tag}` : item.account_id ?? "unknown account"} · {timeAgo(item.created_at)}
                  {item.ip ? ` · ip ${item.ip}` : ""}
                  {Object.keys(item.detail ?? {}).length > 0 ? ` · ${describeDetail(item.detail)}` : ""}
                  {item.review_note ? ` · “${item.review_note}”` : ""}
                </span>
              </span>
              <span className="ledger-amount" style={{ gap: 6 }}>
                <ReviewBadge status={item.review_status} />
                <ReviewActions
                  source={item.source}
                  id={item.id}
                  status={item.review_status}
                  invalidate={() => void queryClient.invalidateQueries({ queryKey: ["admin", "activity"] })}
                />
              </span>
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={activity.data?.total ?? 0} setPage={setPage} />
    </div>
  );
}

// ── Database ───────────────────────────────────────────────────────────────

function cell(value: Json): string {
  if (value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Database() {
  const [table, setTable] = useState("wallets");
  const [page, setPage] = useState(0);
  const tables = useQuery({ queryKey: ["admin", "tables"], queryFn: () => adminTables() });
  const rows = useQuery({
    queryKey: ["admin", "table", table, page],
    queryFn: () => adminTable({ data: { name: table, limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
  });

  return (
    <div className="stack">
      <div className="chip-row">
        {(tables.data?.tables ?? []).map((t) => (
          <button
            key={t.name}
            type="button"
            className="chip"
            style={table === t.name ? { borderColor: "var(--ink)", color: "var(--ink)" } : undefined}
            onClick={() => {
              setPage(0);
              setTable(t.name);
            }}
          >
            {t.name} <span className="meta tnum">{t.approx_rows}</span>
          </button>
        ))}
      </div>

      {rows.data && rows.data.hiddenColumns.length > 0 && (
        <p className="footnote">Never shown: {rows.data.hiddenColumns.join(", ")}.</p>
      )}

      {rows.isPending ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : !rows.data ? (
        <p className="form-error">Couldn't read {table}.</p>
      ) : rows.data.rows.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{table} is empty</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hairline)", borderRadius: "var(--r2)" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                {rows.data.columns.map((column) => (
                  <th
                    key={column}
                    style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--hairline)", position: "sticky", top: 0, background: "var(--paper)" }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.rows.map((row, index) => (
                <tr key={index}>
                  {rows.data!.columns.map((column) => (
                    <td
                      key={column}
                      className="mono"
                      style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={cell(row[column] ?? null)}
                    >
                      {cell(row[column] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={rows.data?.total ?? 0} setPage={setPage} />
    </div>
  );
}
