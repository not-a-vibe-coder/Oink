import { PublicKey } from "@solana/web3.js";
import { getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import {
  effectiveMultiplier,
  marketSession,
  type BellReference,
  type MarketSession,
} from "../../../../src/lib/bell/reference";
import { getSolanaConnection } from "../txBuilder";

/**
 * Gathers equity reference evidence for one Bell asset. Feed IDs are pinned and their symbol is
 * re-checked against Pyth's metadata, so a renamed or recycled ID cannot silently price the
 * wrong instrument. Pyth's public metadata (trading schedule) needs no key; prices require
 * PYTH_API_KEY since the August 2026 Hermes change. Any failure returns an unavailable
 * reference with the reason. The policy then keeps a premium cap fail-closed.
 */
export const BELL_REFERENCE_FEEDS: Record<string, { id: string; symbol: string }> = {
  SPYx: {
    id: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    symbol: "Equity.US.SPY/USD",
  },
  AAPLx: {
    id: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    symbol: "Equity.US.AAPL/USD",
  },
  NVDAx: {
    id: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    symbol: "Equity.US.NVDA/USD",
  },
};

const SOURCE = "Pyth Hermes (regular-session US equity)";
const SCHEDULE_TTL_MS = 60 * 60 * 1000;
const schedules = new Map<string, { schedule: string; fetchedAt: number }>();

function hermesUrl(path: string): URL {
  return new URL(path, process.env.PYTH_HERMES_URL || "https://hermes.pyth.network");
}

async function fetchJson(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Hermes ${response.status}`);
  return response.json();
}

export async function feedSchedule(symbol: string, now = Date.now()): Promise<string> {
  const feed = BELL_REFERENCE_FEEDS[symbol];
  if (!feed) throw new Error("No reference feed.");
  const cached = schedules.get(symbol);
  if (cached && now - cached.fetchedAt < SCHEDULE_TTL_MS) return cached.schedule;
  const url = hermesUrl("/v2/price_feeds");
  url.search = new URLSearchParams({
    query: feed.symbol.split(".").pop()!.split("/")[0],
    asset_type: "equity",
  }).toString();
  const body = await fetchJson(url);
  const match = Array.isArray(body)
    ? (body as { id?: unknown; attributes?: Record<string, unknown> }[]).find(
        (entry) => entry?.id === feed.id,
      )
    : undefined;
  const schedule = match?.attributes?.schedule;
  if (match?.attributes?.symbol !== feed.symbol || typeof schedule !== "string")
    throw new Error("Reference feed metadata mismatch.");
  schedules.set(symbol, { schedule, fetchedAt: now });
  return schedule;
}

export function parseHermesPrice(body: unknown, feedId: string): BellReference["price"] {
  const parsed = (body as { parsed?: unknown })?.parsed;
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error("Invalid Hermes response.");
  const entry = parsed[0] as { id?: unknown; price?: Record<string, unknown> };
  const price = entry?.price;
  if (
    entry?.id !== feedId ||
    !price ||
    typeof price.price !== "string" ||
    !/^-?\d{1,30}$/.test(price.price) ||
    typeof price.conf !== "string" ||
    !/^\d{1,30}$/.test(price.conf) ||
    typeof price.expo !== "number" ||
    !Number.isInteger(price.expo) ||
    typeof price.publish_time !== "number" ||
    !Number.isSafeInteger(price.publish_time)
  )
    throw new Error("Invalid Hermes price.");
  return {
    price: price.price,
    conf: price.conf,
    expo: price.expo,
    publishTime: price.publish_time,
  };
}

export async function mintMultiplier(mint: string, now = Date.now()) {
  const address = new PublicKey(mint);
  const info = await getSolanaConnection().getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Not a Token-2022 mint.");
  const config = getScaledUiAmountConfig(unpackMint(address, info, TOKEN_2022_PROGRAM_ID));
  if (!config) throw new Error("No scaled UI amount extension.");
  return effectiveMultiplier(config, now / 1000);
}

export async function gatherBellReference(
  symbol: string,
  mint: string,
  now = Date.now(),
): Promise<BellReference> {
  const feed = BELL_REFERENCE_FEEDS[symbol];
  const base = { source: SOURCE, feedSymbol: feed?.symbol };
  let session: MarketSession = "unknown";
  try {
    session = marketSession(await feedSchedule(symbol, now), new Date(now));
  } catch {
    return {
      ...base,
      status: "unavailable",
      marketSession: "unknown",
      reason: "PROVIDER_UNAVAILABLE",
    };
  }
  const unavailable = (reason: NonNullable<BellReference["reason"]>): BellReference => ({
    ...base,
    status: "unavailable",
    marketSession: session,
    reason,
  });
  const key = process.env.PYTH_API_KEY;
  if (!key) return unavailable("NOT_CONFIGURED");
  if (session !== "regular") return unavailable("MARKET_NOT_REGULAR");
  let multiplier: BellReference["multiplier"];
  try {
    multiplier = await mintMultiplier(mint, now);
  } catch {
    return unavailable("MULTIPLIER_UNAVAILABLE");
  }
  try {
    const url = hermesUrl("/v2/updates/price/latest");
    url.search = `ids[]=${feed.id}&parsed=true`;
    const price = parseHermesPrice(
      await fetchJson(url, { Authorization: `Bearer ${key}` }),
      feed.id,
    );
    return { ...base, status: "available", marketSession: session, price, multiplier };
  } catch {
    return unavailable("PROVIDER_UNAVAILABLE");
  }
}
