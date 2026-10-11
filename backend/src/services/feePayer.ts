import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getConfig } from "../config";
import { query } from "../db";
import { SKR } from "../lib/tokens";
import { getSolanaConnection } from "./txBuilder";

let feePayerKeypair: Keypair | null = null;

export function getFeePayerKeypair(): Keypair | null {
  if (feePayerKeypair) return feePayerKeypair;
  const secretKeyStr = getConfig().feePayerSecretKey;
  if (!secretKeyStr) return null;

  try {
    if (secretKeyStr.startsWith("[")) {
      const arr = JSON.parse(secretKeyStr);
      feePayerKeypair = Keypair.fromSecretKey(new Uint8Array(arr));
    } else {
      feePayerKeypair = Keypair.fromSecretKey(bs58.decode(secretKeyStr));
    }
    return feePayerKeypair;
  } catch (err) {
    console.error("Failed to initialize fee payer keypair:", err);
    return null;
  }
}

export function getFeePayerPublicKey(): PublicKey | null {
  const kp = getFeePayerKeypair();
  return kp?.publicKey ?? null;
}

const SKR_CACHE_MS = 5 * 60 * 1000;
const skrCache = new Map<string, { balance: bigint; at: number }>();

/**
 * The wallet's SKR balance in base units, read on-chain for the official mint only. Any RPC or
 * parsing problem counts as zero, so the perk fails closed to the standard quota.
 */
export async function skrBalance(wallet: string, now = Date.now()): Promise<bigint> {
  const cached = skrCache.get(wallet);
  if (cached && now - cached.at < SKR_CACHE_MS) return cached.balance;
  let balance = 0n;
  try {
    const owner = new PublicKey(wallet);
    const response = await getSolanaConnection().getParsedTokenAccountsByOwner(
      owner,
      { mint: new PublicKey(SKR.mint) },
      "confirmed",
    );
    for (const { account } of response.value) {
      const info = account.data.parsed?.info;
      if (
        info?.mint !== SKR.mint ||
        info.owner !== wallet ||
        info.tokenAmount?.decimals !== SKR.decimals ||
        !/^\d+$/.test(info.tokenAmount?.amount ?? "")
      )
        throw new Error("Unexpected SKR account.");
      balance += BigInt(info.tokenAmount.amount);
    }
  } catch {
    balance = 0n;
  }
  skrCache.set(wallet, { balance, at: now });
  return balance;
}

export function clearSkrCache(): void {
  skrCache.clear();
}

export async function checkSponsorshipBudget(
  accountId: string,
  estimatedLamports: bigint = 15000n,
): Promise<{
  eligible: boolean;
  reason?: string;
  remainingToday: number;
  tier: "standard" | "skr";
}> {
  const config = getConfig();
  if (!config.sponsorship.enabled) {
    return {
      eligible: false,
      reason: "Fee sponsorship is disabled.",
      remainingToday: 0,
      tier: "standard",
    };
  }

  const kp = getFeePayerKeypair();
  if (!kp) {
    return {
      eligible: false,
      reason: "Fee payer not configured.",
      remainingToday: 0,
      tier: "standard",
    };
  }

  try {
    const wallet = await query("SELECT public_key FROM wallets WHERE account_id = $1", [accountId]);
    const holder =
      wallet.rows[0] !== undefined &&
      config.sponsorship.skrHolderMinBase > 0n &&
      (await skrBalance(wallet.rows[0].public_key)) >= config.sponsorship.skrHolderMinBase;
    const tier = holder ? "skr" : "standard";
    const maxTx = holder ? config.sponsorship.skrMaxTxPerDay : config.sponsorship.maxTxPerDay;
    const maxLamports = holder
      ? config.sponsorship.skrMaxLamportsPerDay
      : config.sponsorship.maxLamportsPerDay;

    // 1. Per-account daily count & lamport usage
    const accountUsageRes = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(lamports), 0) as total_lamports
       FROM fee_sponsorships
       WHERE account_id = $1 AND day = CURRENT_DATE`,
      [accountId],
    );

    const count = parseInt(accountUsageRes.rows[0]?.count || "0", 10);
    const totalLamports = BigInt(accountUsageRes.rows[0]?.total_lamports || "0");
    const remainingToday = Math.max(0, maxTx - count);

    if (count >= maxTx) {
      return {
        eligible: false,
        reason: `Daily sponsorship count limit (${maxTx}) reached.`,
        remainingToday: 0,
        tier,
      };
    }

    if (totalLamports + estimatedLamports > maxLamports) {
      return {
        eligible: false,
        reason: "Daily lamport budget exhausted for this account.",
        remainingToday: 0,
        tier,
      };
    }

    // 2. Global daily budget — identical for every tier.
    const globalRes = await query(
      `SELECT COALESCE(SUM(lamports), 0) as total_lamports
       FROM fee_sponsorships
       WHERE day = CURRENT_DATE`,
    );
    const globalLamports = BigInt(globalRes.rows[0]?.total_lamports || "0");
    if (globalLamports + estimatedLamports > config.sponsorship.globalLamportsPerDay) {
      return {
        eligible: false,
        reason: "Global daily sponsorship budget exhausted.",
        remainingToday: 0,
        tier,
      };
    }

    return { eligible: true, remainingToday, tier };
  } catch (err) {
    console.error("Check sponsorship budget error:", err);
    // Fail closed: if usage cannot be counted, the fee payer must not spend.
    return {
      eligible: false,
      reason: "Fee sponsorship is unavailable right now.",
      remainingToday: 0,
      tier: "standard",
    };
  }
}

export async function recordSponsorship(
  accountId: string,
  signature: string,
  lamports: bigint,
): Promise<void> {
  try {
    await query(
      `INSERT INTO fee_sponsorships (account_id, signature, lamports, day, created_at)
       VALUES ($1, $2, $3, CURRENT_DATE, NOW())`,
      [accountId, signature, lamports.toString()],
    );
  } catch (err) {
    console.error("Record fee sponsorship error:", err);
  }
}
