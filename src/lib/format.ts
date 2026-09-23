/**
 * Display formatting.
 *
 * Every amount in Oink travels as a decimal string (or BigInt base units) and is
 * only turned into something human at the edge — here. Nothing in this file is
 * allowed to feed a number back into a calculation.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return usdFormatter.format(n);
}

export function formatUsdCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) >= 100_000 ? compactUsdFormatter.format(n) : usdFormatter.format(n);
}

/** Splits a USD string into the part set large and the cents set small. */
export function splitUsd(value: string | number | null | undefined): {
  whole: string;
  fraction: string;
} {
  const formatted = formatUsd(value);
  if (formatted === "—") return { whole: "—", fraction: "" };
  const [whole, fraction = "00"] = formatted.split(".");
  return { whole, fraction };
}

/** Token amounts: enough precision to be honest, not enough to be noise. */
export function formatTokenAmount(
  amount: string | number | null | undefined,
  decimals = 6,
): string {
  if (amount === null || amount === undefined || amount === "") return "0";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  const dp = n >= 1000 ? 2 : n >= 1 ? 4 : Math.min(decimals, 6);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export function formatBps(basisPoints: number): string {
  const pct = basisPoints / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return "—";
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function normalizeTagInput(raw: string): string {
  return raw.trim().replace(/^[@$]/, "").toLowerCase();
}

export function isLikelyAddress(raw: string): boolean {
  const value = raw.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && !value.startsWith("@");
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = then - Date.now();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return relativeFormatter.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Chrome on macOS" out of a user-agent string, best effort, never throws. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : "Browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
}

/** Who a transfer was with: their @tag, else their Oink account ID, else the raw address. */
export function counterparty(tag: string | null, accountId: string | null, wallet: string): string {
  if (tag) return `@${tag}`;
  if (accountId) return accountId;
  return shortAddress(wallet);
}

/** Base units (a string of digits) to a decimal string, exactly. */
export function fromBaseUnits(amountBase: string, decimals: number): string {
  const digits = BigInt(amountBase).toString();
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`.replace(/\.?0+$/, "");
}
