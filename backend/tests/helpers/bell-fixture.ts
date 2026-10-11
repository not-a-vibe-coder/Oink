import { MINT_SIZE, MintLayout } from "@solana/spl-token";
import crypto from "node:crypto";
import { Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { BellProviderBuild } from "../../src/services/bell/provider";
export const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export function fixtureBuild(
  wallet: string,
  inputMint: string,
  outputMint: string,
  amount = "180000000",
  slippageBps = 50,
): BellProviderBuild {
  const owner = new PublicKey(wallet),
    input = new PublicKey(inputMint),
    output = new PublicKey(outputMint);
  const source = getAssociatedTokenAddressSync(input, owner),
    destination = getAssociatedTokenAddressSync(output, owner, false, TOKEN_2022_PROGRAM_ID);
  const outAmount = (BigInt(amount) / 10n).toString();
  const data = Buffer.alloc(34);
  crypto.createHash("sha256").update("global:route_v2").digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(BigInt(amount), 8);
  data.writeBigUInt64LE(BigInt(outAmount), 16);
  data.writeUInt16LE(slippageBps, 24);
  return {
    inputMint,
    outputMint,
    inAmount: amount,
    outAmount,
    otherAmountThreshold: ((BigInt(outAmount) * BigInt(10000 - slippageBps)) / 10000n).toString(),
    swapMode: "ExactIn",
    slippageBps,
    priceImpactPct: "0.001",
    routePlan: [{ swapInfo: { label: "Fixture route" } }],
    computeBudgetInstructions: [
      {
        programId: ComputeBudgetProgram.programId.toBase58(),
        accounts: [],
        data: ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000n }).data.toString(
          "base64",
        ),
      },
    ],
    setupInstructions: [],
    swapInstruction: {
      programId: JUPITER,
      accounts: [
        { pubkey: wallet, isSigner: true, isWritable: false },
        { pubkey: source.toBase58(), isSigner: false, isWritable: true },
        { pubkey: destination.toBase58(), isSigner: false, isWritable: true },
        { pubkey: inputMint, isSigner: false, isWritable: false },
        { pubkey: outputMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
        { pubkey: JUPITER, isSigner: false, isWritable: false },
        { pubkey: Keypair.generate().publicKey.toBase58(), isSigner: false, isWritable: false },
        { pubkey: JUPITER, isSigner: false, isWritable: false },
      ],
      data: data.toString("base64"),
    },
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    addressesByLookupTableAddress: null,
    blockhashWithMetadata: {
      blockhash: Array.from(Keypair.generate().publicKey.toBytes()),
      lastValidBlockHeight: 1000,
    },
  };
}

/** A Token-2022 mint with a ScaledUiAmountConfig extension (type 25). */
export function scaledMint(multiplier: number, newMultiplier: number, effective: bigint): Buffer {
  const base = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 0n,
      decimals: 8,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    base,
  );
  const ext = Buffer.alloc(56);
  PublicKey.default.toBuffer().copy(ext, 0);
  ext.writeDoubleLE(multiplier, 32);
  ext.writeBigInt64LE(effective, 40);
  ext.writeDoubleLE(newMultiplier, 48);
  const tlv = Buffer.alloc(4);
  tlv.writeUInt16LE(25, 0);
  tlv.writeUInt16LE(56, 2);
  // Mint (82) padded to the account size (165), then the account-type byte (1 = mint).
  return Buffer.concat([base, Buffer.alloc(165 - MINT_SIZE), Buffer.from([1]), tlv, ext]);
}
