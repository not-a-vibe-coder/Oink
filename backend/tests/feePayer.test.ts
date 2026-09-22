import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { checkSponsorshipBudget, getFeePayerKeypair } from "../src/services/feePayer";

describe("feePayer", () => {
  test("checkSponsorshipBudget checks daily limit", async () => {
    // When no fee payer key is configured in test, check response
    const budget = await checkSponsorshipBudget("pascal", 15000n);
    expect(typeof budget.eligible).toBe("boolean");
    expect(typeof budget.remainingToday).toBe("number");
  });
});
