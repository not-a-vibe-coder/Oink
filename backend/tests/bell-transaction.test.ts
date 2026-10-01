import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { fixtureBuild } from "./helpers/bell-fixture";
import { verifyBellInstructions } from "../src/services/bell/transaction";
import { DEFAULT_BELL_POLICY } from "../../src/lib/bell/policy";
import type { BellQuote } from "../../src/lib/bell/types";
import { USDC, resolveSolanaToken } from "../src/lib/tokens";
const wallet = Keypair.generate().publicKey.toBase58(),
  mint = resolveSolanaToken("SPYx")!.mint;
const quote = {
  inputMint: USDC.mint,
  outputMint: mint,
  inAmount: "180000000",
  outAmount: "18000000",
  policy: DEFAULT_BELL_POLICY,
} as BellQuote;
test("route instruction enforces approved input output slippage and wallet accounts", () => {
  expect(() =>
    verifyBellInstructions(fixtureBuild(wallet, USDC.mint, mint), quote, wallet),
  ).not.toThrow();
});
test("rejects altered amount destination additional signer and extra instructions", () => {
  for (const change of ["amount", "destination", "signer", "instruction"]) {
    const build = fixtureBuild(wallet, USDC.mint, mint);
    if (change === "amount") {
      const data = Buffer.from(build.swapInstruction.data, "base64");
      data.writeBigUInt64LE(1n, 8);
      build.swapInstruction.data = data.toString("base64");
    }
    if (change === "destination")
      build.swapInstruction.accounts[2].pubkey = Keypair.generate().publicKey.toBase58();
    if (change === "signer")
      build.swapInstruction.accounts.push({
        pubkey: Keypair.generate().publicKey.toBase58(),
        isSigner: true,
        isWritable: false,
      });
    if (change === "instruction") build.otherInstructions.push(build.swapInstruction);
    expect(() => verifyBellInstructions(build, quote, wallet)).toThrow();
  }
});
