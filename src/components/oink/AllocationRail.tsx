import { railColor, rankedByWeight } from "@/lib/rail-palette";
import { formatBps } from "@/lib/format";
import type { MixItem } from "@/types/token";

/**
 * The signature element. One bar of apportionment, printed the same way on the
 * wallet home, the send preview, the mix editor and the public pay page,
 * so a person learns to read their split in one place and recognises it in all
 * the others.
 */
export function AllocationRail({
  mix,
  size = "sm",
  showKey = true,
  label,
}: {
  mix: MixItem[];
  size?: "sm" | "lg";
  showKey?: boolean;
  label?: string;
}) {
  const ranked = rankedByWeight(mix);
  const total = ranked.reduce((sum, item) => sum + item.basisPoints, 0) || 10000;

  if (ranked.length === 0) {
    return <div className={size === "lg" ? "rail rail-lg" : "rail"} aria-hidden="true" />;
  }

  const description = ranked
    .map((item) => `${formatBps(item.basisPoints)} ${item.symbol}`)
    .join(", ");

  return (
    <div>
      <div
        className={size === "lg" ? "rail rail-lg" : "rail"}
        role="img"
        aria-label={label ? `${label}: ${description}` : `Allocation: ${description}`}
      >
        {ranked.map((item, index) => (
          <span
            key={item.mint}
            className="rail-seg"
            style={{
              flex: `${(item.basisPoints / total) * 100} 1 0%`,
              background: railColor(index),
            }}
          />
        ))}
      </div>

      {showKey && (
        <div className="rail-key">
          {ranked.map((item, index) => (
            <span key={item.mint} className="rail-key-item">
              <span className="rail-key-swatch" style={{ background: railColor(index) }} />
              {item.symbol}
              <span className="rail-key-pct tnum">{formatBps(item.basisPoints)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
