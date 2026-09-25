import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConfig } from "../config";
import { resolveSolanaToken, type SolanaTokenInfo } from "../lib/tokens";
import { formatTokenUnits } from "./mixEngine";

let connectionInstance: Connection | null = null;

export function getConnection(): Connection {
  if (!connectionInstance) {
    const config = getConfig();
    connectionInstance = new Connection(config.rpcUrl, "confirmed");
  }
  return connectionInstance;
}

// In-memory price cache: mint -> { priceUsd: string, timestamp: number }
const priceCache = new Map<string, { priceUsd: string; timestamp: number }>();
const PRICE_CACHE_TTL_MS = 60_000; // 60s

// In-memory balance cache: wallet -> { balances: any, timestamp: number }
const balanceCache = new Map<string, { data: WalletBalances; timestamp: number }>();
const BALANCE_CACHE_TTL_MS = 10_000; // 10s

export interface TokenHolding {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  amount: string; // formatted e.g. "1.2400000"
  amountBase: string; // raw base units
  valueUsd: string | null;
  priceUsd: string | null;
  iconUrl?: string;
  underlyingTicker?: string;
}

export interface WalletBalances {
  accountId: string;
  publicKey: string;
  solBalance: string;
  solLamports: bigint;
  totalValueUsd: string | null;
  /** SOL is not a token account, so it rides beside the holdings with its own value. */
  solValueUsd: string | null;
  holdings: TokenHolding[];
  needsSol: boolean;
}

export async function fetchTokenPrices(mints: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const mintsToFetch: string[] = [];
  const now = Date.now();

  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now - cached.timestamp < PRICE_CACHE_TTL_MS) {
      result[mint] = cached.priceUsd;
    } else {
      mintsToFetch.push(mint);
    }
  }

  if (mintsToFetch.length === 0) return result;

  try {
    const config = getConfig();
    const url = new URL(config.jupiterPriceApiUrl);
    url.searchParams.set("ids", mintsToFetch.join(","));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        ...(config.jupiterApiKey ? { "x-api-key": config.jupiterApiKey } : {}),
      },
    });

    if (res.ok) {
      // Price API v3 keys the response by mint at the top level and returns usdPrice as a
      // number. v2 (`{ data: { [mint]: { price } } }`) was retired and now 404s.
      const data = (await res.json()) as Record<string, { usdPrice?: number } | null>;
      for (const [mint, info] of Object.entries(data ?? {})) {
        if (info && typeof info.usdPrice === "number" && Number.isFinite(info.usdPrice)) {
          const priceUsd = String(info.usdPrice);
          priceCache.set(mint, { priceUsd, timestamp: now });
          result[mint] = priceUsd;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to fetch Jupiter prices:", err);
  }

  return result;
}

export async function getWalletBalances(accountId: string, walletAddress: string): Promise<WalletBalances> {
  const now = Date.now();
  const cached = balanceCache.get(walletAddress);
  if (cached && now - cached.timestamp < BALANCE_CACHE_TTL_MS) {
    return cached.data;
  }

  const connection = getConnection();
  const pubkey = new PublicKey(walletAddress);

  // 1. SOL balance
  const lamports = BigInt(await connection.getBalance(pubkey));
  const solFormatted = formatTokenUnits(lamports, 9);

  // 2. Token accounts
  const holdings: TokenHolding[] = [];
  const mintsForPrice: string[] = ["So11111111111111111111111111111111111111112"];

  // Both token programs: USDC is classic SPL, but every xStock (the Xs… mints, SPYx
  // included) is Token-2022. Reading only Tokenkeg made received stocks invisible.
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const accountLists = await Promise.all(
    programs.map((programId) =>
      connection
        .getParsedTokenAccountsByOwner(pubkey, { programId })
        .then((result) => result.value)
        .catch((err) => {
          console.warn(`Could not fetch token accounts for program ${programId.toBase58()}:`, err);
          return [];
        }),
    ),
  );

  for (const { account } of accountLists.flat()) {
    const parsedInfo = account.data.parsed?.info;
    if (!parsedInfo) continue;
    const mint: string = parsedInfo.mint;
    const amountBase: string = parsedInfo.tokenAmount?.amount || "0";
    if (amountBase === "0") continue;
    const decimals: number = parsedInfo.tokenAmount?.decimals ?? 0;

    const tokenMeta = resolveSolanaToken(mint);
    if (tokenMeta) {
      mintsForPrice.push(mint);
      holdings.push({
        symbol: tokenMeta.symbol,
        name: tokenMeta.name,
        mint,
        decimals: parsedInfo.tokenAmount?.decimals ?? tokenMeta.decimals,
        amount: parsedInfo.tokenAmount?.uiAmountString || formatTokenUnits(amountBase, tokenMeta.decimals),
        amountBase,
        valueUsd: null,
        priceUsd: null,
        iconUrl: tokenMeta.iconUrl,
        underlyingTicker: tokenMeta.underlyingTicker,
      });
    } else {
      // Not in Oink's list. Shown, so a transfer never silently vanishes, but never priced:
      // airdropped spam often carries a quoted price, and it must not inflate the total.
      holdings.push({
        symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
        name: "Unlisted token",
        mint,
        decimals,
        amount: parsedInfo.tokenAmount?.uiAmountString || formatTokenUnits(amountBase, decimals),
        amountBase,
        valueUsd: null,
        priceUsd: null,
      });
    }
  }

  // 3. Fetch prices
  const prices = await fetchTokenPrices(mintsForPrice);
  const solPrice = parseFloat(prices["So11111111111111111111111111111111111111112"] || "0");

  let totalUsd = solPrice > 0 ? (Number(solFormatted) * solPrice) : 0;

  for (const holding of holdings) {
    if (!resolveSolanaToken(holding.mint)) continue; // unlisted: shown, never valued
    // Jupiter only prices mainnet mints, so devnet USDC comes back unpriced. A dollar
    // stablecoin is worth a dollar; without this the balance reads as a dash on devnet.
    const priceStr = prices[holding.mint] ?? (holding.symbol === "USDC" ? "1" : undefined);
    if (priceStr) {
      holding.priceUsd = priceStr;
      const holdingVal = Number(holding.amount) * parseFloat(priceStr);
      holding.valueUsd = holdingVal.toFixed(2);
      totalUsd += holdingVal;
    }
  }

  const needsSol = lamports < 5_000_000n; // < 0.005 SOL

  const data: WalletBalances = {
    accountId,
    publicKey: walletAddress,
    solBalance: solFormatted,
    solLamports: lamports,
    // An empty wallet is worth $0.00, not "unknown": null is reserved for nothing at all.
    totalValueUsd: totalUsd.toFixed(2),
    solValueUsd: solPrice > 0 ? (Number(solFormatted) * solPrice).toFixed(2) : null,
    holdings,
    needsSol,
  };

  balanceCache.set(walletAddress, { data, timestamp: now });
  return data;
}

export async function broadcastAndConfirmTransaction(
  rawSignedTx: Uint8Array,
): Promise<{ signature: string; status: "confirmed" | "failed"; error?: string }> {
  const connection = getConnection();

  const signature = await connection.sendRawTransaction(rawSignedTx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed",
  );

  if (confirmation.value.err) {
    return {
      signature,
      status: "failed",
      error: JSON.stringify(confirmation.value.err),
    };
  }

  return {
    signature,
    status: "confirmed",
  };
}
