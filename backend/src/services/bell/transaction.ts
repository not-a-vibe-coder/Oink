import crypto from "node:crypto";
import bs58 from "bs58";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  AccountLayout,
} from "@solana/spl-token";
import type { BellQuote, BellSimulation } from "../../../../src/lib/bell/types";
import { FlowError } from "../flow/settings";
import { getSolanaConnection } from "../txBuilder";
import type { ApiInstruction, BellProviderBuild } from "./provider";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ROUTE_V2 = crypto.createHash("sha256").update("global:route_v2").digest().subarray(0, 8);
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const SOL_COST_CAP = 10_000_000n;
function unsafe(): never {
  throw new FlowError(
    "UNSAFE_TRANSACTION",
    "This route cannot be verified for local signing.",
    409,
  );
}
export function verifyBellInstructions(
  build: BellProviderBuild,
  quote: BellQuote,
  wallet: string,
): void {
  const swap = build.swapInstruction,
    data = Buffer.from(swap.data, "base64");
  const source = getAssociatedTokenAddressSync(
    new PublicKey(quote.inputMint),
    new PublicKey(wallet),
  ).toBase58();
  const destination = getAssociatedTokenAddressSync(
    new PublicKey(quote.outputMint),
    new PublicKey(wallet),
    false,
    TOKEN_2022_PROGRAM_ID,
  ).toBase58();
  if (
    swap.programId !== JUPITER_PROGRAM ||
    data.length < 34 ||
    !data.subarray(0, 8).equals(ROUTE_V2) ||
    data.readBigUInt64LE(8) !== BigInt(quote.inAmount) ||
    data.readBigUInt64LE(16) !== BigInt(quote.outAmount) ||
    data.readUInt16LE(24) !== quote.policy.slippageBps ||
    data.readUInt16LE(26) !== 0 ||
    data.readUInt16LE(28) !== 0
  )
    unsafe();
  if (
    swap.accounts[0]?.pubkey !== wallet ||
    !swap.accounts[0]?.isSigner ||
    swap.accounts[1]?.pubkey !== source ||
    swap.accounts[2]?.pubkey !== destination ||
    swap.accounts[3]?.pubkey !== quote.inputMint ||
    swap.accounts[4]?.pubkey !== quote.outputMint ||
    swap.accounts[5]?.pubkey !== TOKEN_PROGRAM_ID.toBase58() ||
    swap.accounts[6]?.pubkey !== TOKEN_2022_PROGRAM_ID.toBase58() ||
    ![JUPITER_PROGRAM, destination].includes(swap.accounts[7]?.pubkey)
  )
    unsafe();
  const all = [
    ...build.computeBudgetInstructions,
    ...build.setupInstructions,
    swap,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...build.otherInstructions,
    ...(build.tipInstruction ? [build.tipInstruction] : []),
  ];
  if (build.otherInstructions.length || build.tipInstruction) unsafe();
  for (const instruction of all)
    for (const account of instruction.accounts)
      if (account.isSigner && account.pubkey !== wallet) unsafe();
  for (const instruction of build.computeBudgetInstructions) {
    const raw = Buffer.from(instruction.data, "base64");
    if (
      instruction.programId !== ComputeBudgetProgram.programId.toBase58() ||
      raw.length !== 9 ||
      raw[0] !== 3 ||
      instruction.accounts.length
    )
      unsafe();
  }
  for (const instruction of build.setupInstructions) {
    const raw = Buffer.from(instruction.data, "base64"),
      accounts = instruction.accounts;
    if (
      instruction.programId !== ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() ||
      raw.length !== 1 ||
      raw[0] !== 1 ||
      accounts.length !== 6 ||
      accounts[0].pubkey !== wallet ||
      accounts[2].pubkey !== wallet ||
      accounts[4].pubkey !== PublicKey.default.toBase58() ||
      ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(accounts[5].pubkey)
    )
      unsafe();
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(accounts[3].pubkey),
      new PublicKey(wallet),
      false,
      new PublicKey(accounts[5].pubkey),
    );
    if (accounts[1].pubkey !== ata.toBase58()) unsafe();
  }
  if (build.cleanupInstruction) {
    const cleanup = build.cleanupInstruction,
      accounts = cleanup.accounts,
      raw = Buffer.from(cleanup.data, "base64");
    const wsol = getAssociatedTokenAddressSync(WSOL, new PublicKey(wallet)).toBase58();
    if (
      cleanup.programId !== TOKEN_PROGRAM_ID.toBase58() ||
      raw.length !== 1 ||
      raw[0] !== 9 ||
      accounts.length !== 3 ||
      accounts[0].pubkey !== wsol ||
      accounts[1].pubkey !== wallet ||
      accounts[2].pubkey !== wallet
    )
      unsafe();
  }
}
function instruction(value: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(value.programId),
    keys: value.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(value.data, "base64"),
  });
}
export function bellMessageHash(tx: VersionedTransaction): string {
  return crypto.createHash("sha256").update(tx.message.serialize()).digest("hex");
}
export function tokenAccountAmount(data: Uint8Array | null, mint: string, wallet: string): bigint {
  if (!data) return 0n;
  if (data.length < 165) unsafe();
  const decoded = AccountLayout.decode(Buffer.from(data));
  if (!decoded.mint.equals(new PublicKey(mint)) || !decoded.owner.equals(new PublicKey(wallet)))
    unsafe();
  return decoded.amount;
}
export async function assembleBellTransaction(
  build: BellProviderBuild,
  quote: BellQuote,
  wallet: string,
) {
  verifyBellInstructions(build, quote, wallet);
  const connection = getSolanaConnection(),
    owner = new PublicKey(wallet);
  const source = getAssociatedTokenAddressSync(new PublicKey(quote.inputMint), owner),
    destination = getAssociatedTokenAddressSync(
      new PublicKey(quote.outputMint),
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
  const tables: AddressLookupTableAccount[] = [];
  for (const [address, expected] of Object.entries(build.addressesByLookupTableAddress ?? {})) {
    const result = await connection.getAddressLookupTable(new PublicKey(address));
    if (
      !result.value ||
      expected.some((key, index) => result.value!.state.addresses[index]?.toBase58() !== key)
    )
      unsafe();
    tables.push(result.value);
  }
  const metadata = build.blockhashWithMetadata;
  if (
    !metadata ||
    metadata.blockhash.length !== 32 ||
    !Number.isSafeInteger(metadata.lastValidBlockHeight)
  )
    unsafe();
  const blockhash = bs58.encode(Uint8Array.from(metadata.blockhash));
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
        ...build.computeBudgetInstructions.map(instruction),
        ...build.setupInstructions.map(instruction),
        instruction(build.swapInstruction),
        ...(build.cleanupInstruction ? [instruction(build.cleanupInstruction)] : []),
      ],
    }).compileToV0Message(tables),
  );
  if (tx.message.header.numRequiredSignatures !== 1 || tx.serialize().length > 1232) unsafe();
  const before = await connection.getMultipleAccountsInfo(
    [owner, source, destination],
    "confirmed",
  );
  const simulation = await connection.simulateTransaction(tx, {
    sigVerify: false,
    commitment: "confirmed",
    accounts: {
      encoding: "base64",
      addresses: [wallet, source.toBase58(), destination.toBase58()],
    },
  });
  if (simulation.value.err || !simulation.value.accounts || simulation.value.accounts.length !== 3)
    throw new FlowError(
      "SIMULATION_FAILED",
      "This purchase could not be simulated. Check your SOL balance and request a new quote.",
      409,
    );
  const after = simulation.value.accounts;
  const bytes = (index: number): Uint8Array | null =>
    after[index]?.data ? Buffer.from(after[index]!.data[0], "base64") : null;
  if (
    !before[1] ||
    !before[1].owner.equals(TOKEN_PROGRAM_ID) ||
    (before[2] && !before[2].owner.equals(TOKEN_2022_PROGRAM_ID)) ||
    after[1]?.owner !== TOKEN_PROGRAM_ID.toBase58() ||
    after[2]?.owner !== TOKEN_2022_PROGRAM_ID.toBase58()
  )
    unsafe();
  const input =
    tokenAccountAmount(before[1].data, quote.inputMint, wallet) -
    tokenAccountAmount(bytes(1), quote.inputMint, wallet);
  const output =
    tokenAccountAmount(bytes(2), quote.outputMint, wallet) -
    tokenAccountAmount(before[2]?.data ?? null, quote.outputMint, wallet);
  if (input !== BigInt(quote.inAmount) || output < BigInt(quote.minimumOutput)) unsafe();
  const fee = await connection.getFeeForMessage(tx.message, "confirmed");
  if (
    fee.value === null ||
    !Number.isSafeInteger(fee.value) ||
    !before[0] ||
    !after[0] ||
    !Number.isSafeInteger(before[0].lamports) ||
    !Number.isSafeInteger(after[0].lamports)
  )
    unsafe();
  const debit = BigInt(before[0].lamports) - BigInt(after[0].lamports);
  if (BigInt(fee.value) > SOL_COST_CAP || debit > SOL_COST_CAP)
    throw new FlowError(
      "NETWORK_COST_LIMIT",
      "Network fees and account setup exceed the 0.01 SOL limit.",
      409,
    );
  const evidence: BellSimulation = {
    inputBase: input.toString(),
    outputBase: output.toString(),
    networkFeeLamports: String(fee.value),
    solDebitLamports: (debit > 0n ? debit : 0n).toString(),
  };
  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    messageHash: bellMessageHash(tx),
    blockhash,
    lastValidBlockHeight: metadata.lastValidBlockHeight,
    simulation: evidence,
  };
}
