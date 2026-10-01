import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UnlockInline } from "@/components/oink/UnlockInline";
import { useKeySession } from "@/hooks/useKeySession";
import { useWalletSession } from "@/lib/app-session";
import { signTransaction } from "@/lib/wallet/key-session";
import {
  changeBellOrder,
  getBellReceipts,
  prepareBellOrder,
  reconcileBellOrder,
  submitBellOrder,
} from "@/lib/flow/server-fns";
import { displayTokenAmount } from "@/lib/bell/policy";
import type { BellAttempt, BellPrepared, BellPurchase } from "@/lib/bell/types";
function signedAmount(value: string, decimals: number) {
  return value.startsWith("-")
    ? `-${displayTokenAmount(value.slice(1), decimals)}`
    : displayTokenAmount(value, decimals);
}
function AttemptReceipt({ attempt }: { attempt: BellAttempt }) {
  return (
    <div className="stack-tight">
      <p className="meta">
        Attempt: {attempt.state}
        {attempt.reason ? ` · ${attempt.reason}` : ""}
      </p>
      {attempt.signature && (
        <p className="footnote" style={{ overflowWrap: "anywhere" }}>
          Signature: {attempt.signature}
        </p>
      )}
      {attempt.receipt && (
        <>
          <p className="meta">
            Actual USDC spent: {signedAmount(attempt.receipt.inputBase, 6)} · Network fee:{" "}
            {displayTokenAmount(attempt.receipt.networkFeeLamports, 9)} SOL
          </p>
          <p className="meta">
            Received: {attempt.receipt.outputBase} token base units · Finalized slot:{" "}
            {attempt.receipt.slot}
          </p>
          {!attempt.receipt.withinLimits && (
            <p role="alert">
              The finalized balance changes differ from the approved limits. Review this receipt
              before creating another order.
            </p>
          )}
        </>
      )}
    </div>
  );
}
export function BellExecution({ purchase }: { purchase: BellPurchase }) {
  const session = useWalletSession();
  const key = useKeySession();
  const client = useQueryClient();
  const [plan, setPlan] = useState<BellPrepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Execution could not be completed.");
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: ["flow"] });
      await client.invalidateQueries({ queryKey: ["wallet"] });
    }
  }
  const actionable = ["pending", "deferred", "approved", "failed"].includes(purchase.state);
  const preparable =
    ["pending", "approved"].includes(purchase.state) && purchase.quote?.decision.status === "pass";
  const activePlan =
    plan && plan.quote.id === purchase.quote?.id && ["pending", "approved"].includes(purchase.state)
      ? plan
      : null;
  return (
    <div className="stack-tight">
      {purchase.attempt && <AttemptReceipt attempt={purchase.attempt} />}
      {preparable && !activePlan && (
        <button
          className="btn btn-outline"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              setPlan(
                await prepareBellOrder({ data: { id: purchase.id, quoteId: purchase.quote!.id } }),
              );
            })
          }
        >
          Review simulated trade
        </button>
      )}
      {activePlan && (
        <>
          <p className="meta">
            Simulation: {signedAmount(activePlan.attempt.simulation.inputBase, 6)} USDC spent;{" "}
            {displayTokenAmount(
              activePlan.attempt.simulation.outputBase,
              activePlan.quote.outputDecimals,
            )}{" "}
            {purchase.symbol} received.
          </p>
          <p className="meta">
            Estimated fee: {displayTokenAmount(activePlan.attempt.simulation.networkFeeLamports, 9)}{" "}
            SOL · Estimated total SOL debit including account creation:{" "}
            {displayTokenAmount(activePlan.attempt.simulation.solDebitLamports, 9)} SOL.
          </p>
          <p className="footnote">
            Your wallet pays network fees. Approval expires at{" "}
            {new Date(activePlan.attempt.expiresAt).toLocaleTimeString()}. Signing submits this
            exact trade.
          </p>
          {!key.unlocked && <UnlockInline {...session} onUnlocked={() => {}} />}
          <button
            className="btn btn-primary"
            disabled={busy || !key.unlocked}
            onClick={() =>
              void act(async () => {
                if (key.publicKey !== session.publicKey)
                  throw new Error("Unlock the wallet that owns this income.");
                if (Date.now() >= Date.parse(activePlan.attempt.expiresAt))
                  throw new Error("Quote expired. Reset the order and review a fresh quote.");
                const signedTransaction = signTransaction(activePlan.transaction);
                try {
                  await submitBellOrder({ data: { id: activePlan.attempt.id, signedTransaction } });
                } finally {
                  setPlan(null);
                }
              })
            }
          >
            Approve and sign trade
          </button>
        </>
      )}
      {purchase.state === "submitted" && purchase.attempt && (
        <>
          <p className="meta">
            Funds remain reserved while Bell checks finalized chain evidence. A lost response does
            not create a second trade.
          </p>
          <button
            className="btn btn-outline"
            disabled={busy}
            onClick={() =>
              void act(() => reconcileBellOrder({ data: { id: purchase.attempt!.id } }))
            }
          >
            Check finalized receipt
          </button>
        </>
      )}
      {actionable && (
        <div className="row">
          <button
            className="btn btn-outline"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await changeBellOrder({ data: { id: purchase.id, action: "retry" } });
                setPlan(null);
              })
            }
          >
            Reset for a fresh quote
          </button>
          <button
            className="btn btn-outline"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await changeBellOrder({ data: { id: purchase.id, action: "cancel" } });
                setPlan(null);
              })
            }
          >
            Cancel investment order
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function BellReceiptHistory() {
  const history = useQuery({
    queryKey: ["flow", "receipts"],
    queryFn: () => getBellReceipts(),
    retry: false,
  });
  return (
    <details>
      <summary>Execution history</summary>
      {history.isError && <p role="alert">{history.error.message}</p>}
      {history.data?.attempts.map((attempt) => (
        <article className="panel" key={attempt.id}>
          <p className="footnote">{attempt.purchaseId}</p>
          <AttemptReceipt attempt={attempt} />
        </article>
      ))}
    </details>
  );
}
