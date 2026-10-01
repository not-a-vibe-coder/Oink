import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { validateBellBuild } from "../src/services/bell/provider";
import { fixtureBuild } from "./helpers/bell-fixture";
const params = {
  wallet: Keypair.generate().publicKey.toBase58(),
  inputMint: Keypair.generate().publicKey.toBase58(),
  outputMint: Keypair.generate().publicKey.toBase58(),
  amount: "180000000",
  slippageBps: 50,
};
test("provider rejects malformed amounts impact instruction fields and blockhash bytes", () => {
  const valid = fixtureBuild(params.wallet, params.inputMint, params.outputMint);
  expect(validateBellBuild(valid, params)).toBe(valid);
  const cases: unknown[] = [
    { ...valid, outAmount: "-1" },
    { ...valid, outAmount: "18446744073709551616" },
    { ...valid, priceImpactPct: "NaN" },
    { ...valid, routePlan: [{}] },
    {
      ...valid,
      swapInstruction: {
        ...valid.swapInstruction,
        accounts: [{ pubkey: params.wallet, isSigner: "false", isWritable: true }],
      },
    },
    {
      ...valid,
      blockhashWithMetadata: { blockhash: Array(32).fill(256), lastValidBlockHeight: 1000 },
    },
    { ...valid, addressesByLookupTableAddress: { bad: 42 } },
  ];
  for (const value of cases) expect(() => validateBellBuild(value, params)).toThrow();
});
