import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getConfig } from "../config";
import { query } from "../db";

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

export async function checkSponsorshipBudget(
  accountId: string,
  estimatedLamports: bigint = 15000n,
): Promise<{ eligible: boolean; reason?: string; remainingToday: number }> {
  const config = getConfig();
  if (!config.sponsorship.enabled) {
    return { eligible: false, reason: "Fee sponsorship is disabled.", remainingToday: 0 };
  }

  const kp = getFeePayerKeypair();
  if (!kp) {
    return { eligible: false, reason: "Fee payer not configured.", remainingToday: 0 };
  }

  try {
    // 1. Per-account daily count & lamport usage
    const accountUsageRes = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(lamports), 0) as total_lamports
       FROM fee_sponsorships
       WHERE account_id = $1 AND day = CURRENT_DATE`,
      [accountId],
    );

    const count = parseInt(accountUsageRes.rows[0]?.count || "0", 10);
    const totalLamports = BigInt(accountUsageRes.rows[0]?.total_lamports || "0");

    const maxTx = config.sponsorship.maxTxPerDay;
    const remainingToday = Math.max(0, maxTx - count);

    if (count >= maxTx) {
      return {
        eligible: false,
        reason: `Daily sponsorship count limit (${maxTx}) reached.`,
        remainingToday: 0,
      };
    }

    if (totalLamports + estimatedLamports > config.sponsorship.maxLamportsPerDay) {
      return {
        eligible: false,
        reason: "Daily lamport budget exhausted for this account.",
        remainingToday: 0,
      };
    }

    // 2. Global daily budget
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
      };
    }

    return { eligible: true, remainingToday };
  } catch (err) {
    console.error("Check sponsorship budget error:", err);
    // If table doesn't exist yet or query fails, allow gracefully if configured
    return { eligible: true, remainingToday: 20 };
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
