import { nanoid } from "nanoid";
import { getConfig } from "../config";
import { resolveSolanaToken, USDC, type SolanaTokenInfo } from "../lib/tokens";
import { fetchJupiterQuote, type JupiterQuoteResponse } from "./jupiterService";

export interface MixLeg {
  symbol: string;
  mint: string;
  basisPoints: number; // 1 to 10000
}

export interface MixLegQuote {
  symbol: string;
  mint: string;
  basisPoints: number;
  inAmount: string; // base units
  outAmount: string; // base units
  outAmountFormatted: string;
  priceImpactPct: number;
  route: "direct" | "jupiter";
  safeSettled: boolean;
  rawJupiterQuote?: JupiterQuoteResponse;
}

// An Oink recipient is keyed by account ID; the tag, when they have one, is only for display.
export interface QuoteRecipient {
  kind: "account" | "address" | "held";
  accountId?: string;
  tag?: string | null;
  /** For a held payment, empty until /build creates the recipient's holding wallet. */
  wallet: string;
  displayName?: string;
  held?: { kind: "email"; email: string } | { kind: "x"; username: string };
}

export interface StoredQuote {
  quoteId: string;
  senderAccountId?: string;
  senderWallet: string;
  recipient: QuoteRecipient;
  inputToken: SolanaTokenInfo;
  totalIn: string;
  totalInBase: string;
  legs: MixLegQuote[];
  networkFeeLamports: number;
  applyMix: boolean;
  sponsorFee: boolean;
  expiresAt: string;
  createdAt: number;
}

// In-memory quote cache with 30s TTL
const quoteCache = new Map<string, StoredQuote>();

setInterval(() => {
  const now = Date.now();
  for (const [id, quote] of quoteCache.entries()) {
    if (now - quote.createdAt > 60_000) {
      quoteCache.delete(id);
    }
  }
}, 10_000);

export function getStoredQuote(quoteId: string): StoredQuote | undefined {
  const quote = quoteCache.get(quoteId);
  if (!quote) return undefined;
  if (Date.now() > new Date(quote.expiresAt).getTime()) {
    quoteCache.delete(quoteId);
    return undefined;
  }
  return quote;
}

export function saveStoredQuote(quote: StoredQuote): void {
  quoteCache.set(quote.quoteId, quote);
}

export function formatTokenUnits(amountBase: string | bigint, decimals: number): string {
  const big = typeof amountBase === "bigint" ? amountBase : BigInt(amountBase);
  const factor = BigInt(10) ** BigInt(decimals);
  const integerPart = big / factor;
  const fractionPart = big % factor;
  const paddedFraction = fractionPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return paddedFraction ? `${integerPart}.${paddedFraction}` : `${integerPart}`;
}

export function parseTokenUnits(amountFormatted: string | number, decimals: number): string {
  const [intPart, fracPart = ""] = String(amountFormatted).split(".");
  const cleanFrac = fracPart.slice(0, decimals).padEnd(decimals, "0");
  const combined = `${intPart || "0"}${cleanFrac}`;
  return BigInt(combined).toString();
}

export async function calculateMixQuotes(params: {
  senderAccountId?: string;
  senderWallet: string;
  recipient: QuoteRecipient;
  fromSymbolOrMint: string;
  amountInFormatted: string; // e.g. "25.00"
  mix: MixLeg[];
  applyMix: boolean;
  slippageBps?: number;
}): Promise<StoredQuote> {
  const config = getConfig();
  const inputToken = resolveSolanaToken(params.fromSymbolOrMint);
  if (!inputToken) {
    throw new Error(`Unrecognized input token: ${params.fromSymbolOrMint}`);
  }

  const totalInBaseBig = BigInt(parseTokenUnits(params.amountInFormatted, inputToken.decimals));
  const slippageBps = params.slippageBps ?? config.defaultSlippageBps;
  const safeSettleCap = config.safeSettlePriceImpactPct;

  // If sending to raw address or applyMix is false, 1 single leg
  const legsToCompute: MixLeg[] =
    params.applyMix && params.mix.length > 0
      ? params.mix
      : [{ symbol: inputToken.symbol, mint: inputToken.mint, basisPoints: 10000 }];

  // 1. Distribute amounts via BigInt integer math
  const legAmounts: bigint[] = [];
  let allocatedSum = 0n;
  let largestLegIdx = 0;
  let largestBps = 0;

  for (let i = 0; i < legsToCompute.length; i++) {
    const leg = legsToCompute[i];
    if (leg.basisPoints > largestBps) {
      largestBps = leg.basisPoints;
      largestLegIdx = i;
    }
    const legIn = (totalInBaseBig * BigInt(leg.basisPoints)) / 10000n;
    legAmounts.push(legIn);
    allocatedSum += legIn;
  }

  // Remainder to largest leg
  const remainder = totalInBaseBig - allocatedSum;
  if (remainder > 0n) {
    legAmounts[largestLegIdx] += remainder;
  }

  // 2. Fetch quote for each leg
  const computedLegs = await Promise.all(
    legsToCompute.map(async (leg, idx) => {
      const legInAmount = legAmounts[idx];
      const legInStr = legInAmount.toString();

      // Direct transfer leg (no swap needed)
      if (leg.mint === inputToken.mint || (inputToken.isNative && leg.mint === "11111111111111111111111111111111")) {
        return {
          symbol: leg.symbol,
          mint: leg.mint,
          basisPoints: leg.basisPoints,
          inAmount: legInStr,
          outAmount: legInStr,
          outAmountFormatted: formatTokenUnits(legInAmount, inputToken.decimals),
          priceImpactPct: 0,
          route: "direct" as const,
          safeSettled: false,
        };
      }

      // Need Jupiter swap quote
      const targetToken = resolveSolanaToken(leg.mint);
      const targetDecimals = targetToken?.decimals ?? 8;

      try {
        const jupQuote = await fetchJupiterQuote({
          inputMint: inputToken.mint,
          outputMint: leg.mint,
          amount: legInStr,
          slippageBps,
        });

        const priceImpact = parseFloat(jupQuote.priceImpactPct || "0");

        // Safe-settle check: if price impact exceeds cap, safe-settle to USDC
        if (priceImpact > safeSettleCap && leg.mint !== USDC.mint) {
          console.warn(
            `Price impact ${priceImpact}% exceeds cap ${safeSettleCap}%. Safe-settling leg ${leg.symbol} to USDC.`,
          );

          if (inputToken.mint === USDC.mint) {
            // Already USDC -> direct USDC leg
            return {
              symbol: "USDC",
              mint: USDC.mint,
              basisPoints: leg.basisPoints,
              inAmount: legInStr,
              outAmount: legInStr,
              outAmountFormatted: formatTokenUnits(legInAmount, USDC.decimals),
              priceImpactPct: 0,
              route: "direct" as const,
              safeSettled: true,
            };
          }

          // Swap from input to USDC instead
          const safeQuote = await fetchJupiterQuote({
            inputMint: inputToken.mint,
            outputMint: USDC.mint,
            amount: legInStr,
            slippageBps,
          });

          return {
            symbol: "USDC",
            mint: USDC.mint,
            basisPoints: leg.basisPoints,
            inAmount: legInStr,
            outAmount: safeQuote.outAmount,
            outAmountFormatted: formatTokenUnits(safeQuote.outAmount, USDC.decimals),
            priceImpactPct: parseFloat(safeQuote.priceImpactPct || "0"),
            route: "jupiter" as const,
            safeSettled: true,
            rawJupiterQuote: safeQuote,
          };
        }

        return {
          symbol: leg.symbol,
          mint: leg.mint,
          basisPoints: leg.basisPoints,
          inAmount: legInStr,
          outAmount: jupQuote.outAmount,
          outAmountFormatted: formatTokenUnits(jupQuote.outAmount, targetDecimals),
          priceImpactPct: priceImpact,
          route: "jupiter" as const,
          safeSettled: false,
          rawJupiterQuote: jupQuote,
        };
      } catch (err: any) {
        throw new Error(`Failed to quote leg ${leg.symbol}: ${err?.message || String(err)}`);
      }
    }),
  );

  const quoteId = `qte_${nanoid(24)}`;
  const expiresAt = new Date(Date.now() + 30 * 1000).toISOString(); // 30s TTL

  const result: StoredQuote = {
    quoteId,
    senderAccountId: params.senderAccountId,
    senderWallet: params.senderWallet,
    recipient: params.recipient,
    inputToken,
    totalIn: params.amountInFormatted,
    totalInBase: totalInBaseBig.toString(),
    legs: computedLegs,
    networkFeeLamports: 15000,
    applyMix: params.applyMix,
    sponsorFee: true,
    expiresAt,
    createdAt: Date.now(),
  };

  saveStoredQuote(result);
  return result;
}
