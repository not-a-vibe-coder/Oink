import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { broadcastAndConfirmTransaction, getConnection } from "../src/services/rpc";

const tx = new Uint8Array([1, 2, 3]);
let restores: (() => void)[] = [];
afterEach(() => {
  restores.forEach((restore) => restore());
  restores = [];
});

function mockChain(opts: {
  sendErrors?: string[];
  statuses?: ({ err?: unknown; confirmationStatus?: string } | null)[];
  height?: number;
}) {
  const connection = getConnection();
  const sendErrors = [...(opts.sendErrors ?? [])];
  const statuses = [...(opts.statuses ?? [])];
  const sends: { skipPreflight?: boolean }[] = [];
  const send = spyOn(connection, "sendRawTransaction").mockImplementation(async (_raw, o) => {
    sends.push({ skipPreflight: o?.skipPreflight });
    const error = sendErrors.shift();
    if (error) throw new Error(error);
    return "sig-1";
  });
  const status = spyOn(connection, "getSignatureStatuses").mockImplementation(async () => ({
    context: { slot: 1 },
    value: [(statuses.length > 1 ? statuses.shift() : statuses[0]) ?? null] as never,
  }));
  const height = spyOn(connection, "getBlockHeight").mockImplementation(
    async () => opts.height ?? 100,
  );
  restores.push(
    () => send.mockRestore(),
    () => status.mockRestore(),
    () => height.mockRestore(),
  );
  return sends;
}

describe("broadcastAndConfirmTransaction", () => {
  test("re-sends identical bytes after a transient 'Blockhash not found'", async () => {
    const sends = mockChain({
      sendErrors: ["Transaction simulation failed: Blockhash not found"],
      statuses: [{ confirmationStatus: "confirmed" }],
    });
    const result = await broadcastAndConfirmTransaction(tx, 200, { pollMs: 1 });
    expect(result).toEqual({ signature: "sig-1", status: "confirmed" });
    expect(sends.length).toBe(2);
  });
  test("other send errors are not retried", async () => {
    mockChain({ sendErrors: ["insufficient funds for fee"] });
    await expect(broadcastAndConfirmTransaction(tx, 200, { pollMs: 1 })).rejects.toThrow(
      "insufficient funds",
    );
  });
  test("waits through 'not seen yet' and reports confirmed", async () => {
    mockChain({
      statuses: [
        null,
        null,
        { confirmationStatus: "processed" },
        { confirmationStatus: "finalized" },
      ],
    });
    expect((await broadcastAndConfirmTransaction(tx, 200, { pollMs: 1 })).status).toBe("confirmed");
  });
  test("an on-chain error is a failure", async () => {
    mockChain({ statuses: [{ err: { InstructionError: [0, "Custom"] } }] });
    const result = await broadcastAndConfirmTransaction(tx, 200, { pollMs: 1 });
    expect(result.status).toBe("failed");
  });
  test("fails only once the blockhash window has provably closed", async () => {
    mockChain({ statuses: [null], height: 201 });
    const result = await broadcastAndConfirmTransaction(tx, 200, { pollMs: 1 });
    expect(result).toMatchObject({
      status: "failed",
      error: "Transaction expired before it landed.",
    });
  });
  test("a slow but still-valid transaction is pending, never failed", async () => {
    mockChain({ statuses: [null], height: 150 });
    const result = await broadcastAndConfirmTransaction(tx, 200, { pollMs: 1, maxWaitMs: 30 });
    expect(result).toEqual({ signature: "sig-1", status: "pending" });
  });
});
