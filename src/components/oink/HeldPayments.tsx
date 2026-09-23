/**
 * Money in the 48-hour holding pen (docs/12 §5): payments this wallet sent to people who
 * haven't joined yet, and payments waiting for an email or X account this wallet has linked.
 */
import { useQuery } from "@tanstack/react-query";
import { getHeldPayments } from "@/lib/oink-server-fns";
import { formatTokenAmount, fromBaseUnits, timeAgo } from "@/lib/format";
import type { HeldPaymentRow } from "@/types/api";

const STATUS: Record<HeldPaymentRow["status"], { label: string; tone?: "ok" | "warn" | "bad" }> = {
  held: { label: "Waiting", tone: "warn" },
  claiming: { label: "Being claimed", tone: "warn" },
  claimed: { label: "Claimed", tone: "ok" },
  refunding: { label: "Coming back", tone: "warn" },
  refunded: { label: "Refunded to you" },
  failed: { label: "Stuck — we're on it", tone: "bad" },
};

function until(expiresAt: string): string {
  const hours = Math.max(0, (new Date(expiresAt).getTime() - Date.now()) / 3_600_000);
  if (hours < 1) return "less than an hour left";
  return `${Math.floor(hours)}h left`;
}

function Row({ payment, incoming }: { payment: HeldPaymentRow; incoming: boolean }) {
  const status = STATUS[payment.status];
  const open = payment.status === "held";
  return (
    <div className="ledger-row">
      <span className="ledger-main">
        <span className="ledger-title">
          {incoming
            ? `From ${payment.sender_tag ? `@${payment.sender_tag}` : "an Oink user"} to ${payment.recipient_display}`
            : `To ${payment.recipient_display}`}
        </span>
        <span className="ledger-sub">
          {timeAgo(payment.created_at)}
          {open ? ` · ${until(payment.expires_at)}` : ""}
        </span>
      </span>
      <span className="ledger-amount">
        <span className="ledger-value tnum">
          {formatTokenAmount(fromBaseUnits(payment.amount_base, payment.decimals))} {payment.symbol}
        </span>
        <span className="badge" data-tone={status.tone}>
          {status.label}
        </span>
      </span>
    </div>
  );
}

export function HeldPayments() {
  const held = useQuery({ queryKey: ["held"], queryFn: () => getHeldPayments(), refetchInterval: 30_000 });
  const incoming = held.data?.incoming ?? [];
  const sent = held.data?.sent ?? [];
  if (incoming.length === 0 && sent.length === 0) return null;

  return (
    <div className="stack" style={{ marginBottom: "var(--s5)" }}>
      {incoming.length > 0 && (
        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
            Arriving for you
          </h2>
          <div className="ledger">
            {incoming.map((payment) => (
              <Row key={payment.id} payment={payment} incoming />
            ))}
          </div>
        </section>
      )}
      {sent.length > 0 && (
        <section>
          <h2 className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
            Sent to people not on Oink yet
          </h2>
          <p className="meta" style={{ marginBottom: "var(--s3)" }}>
            Held for 48 hours. If they don't claim it, it comes back to you automatically.
          </p>
          <div className="ledger">
            {sent.map((payment) => (
              <Row key={payment.id} payment={payment} incoming={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
