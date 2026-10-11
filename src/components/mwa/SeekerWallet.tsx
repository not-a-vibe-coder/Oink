import { useState } from "react";
import { Smartphone } from "lucide-react";
import {
  connectMobileWallet,
  signAndSendWithMobileWallet,
  transactionRequestLink,
  type MobileSession,
} from "@/lib/mwa/mwa";
import { useMobileWalletAvailable } from "@/hooks/useMobileWallet";
import {
  buildIncomePayerTransaction,
  buildTopUpTransaction,
  confirmIncomeInvoice,
  type ExternalTransaction,
} from "@/lib/flow/server-fns";
import { displayUsdc, parseSol, parseUsdc } from "@/lib/flow/amounts";

function explorer(signature: string, chain: string) {
  const cluster = chain === "solana:mainnet" ? "" : `?cluster=${chain.split(":")[1]}`;
  return `https://solscan.io/tx/${signature}${cluster}`;
}

function message(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * Pay a Flow income request from a Seeker/Android wallet. Two taps, both user gestures: connect
 * (which also prepares the referenced transfer), then approve in the wallet. Receipt is still
 * decided by the existing finalized, referenced, exact-amount verification.
 */
export function SeekerPayIncome({
  invoiceId,
  amountBase,
  onPaid,
}: {
  invoiceId: string;
  amountBase: string;
  onPaid: () => void;
}) {
  const available = useMobileWalletAvailable();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [prepared, setPrepared] = useState<ExternalTransaction | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "verifying" | "done">("idle");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  if (!available) return null;

  async function connect() {
    setError("");
    setState("busy");
    try {
      const connected = await connectMobileWallet();
      setSession(connected);
      setPrepared(
        await buildIncomePayerTransaction({
          data: { id: invoiceId, account: connected.account.address },
        }),
      );
    } catch (caught) {
      setError(message(caught, "Could not connect your wallet."));
    } finally {
      setState("idle");
    }
  }

  async function pay() {
    if (!session || !prepared) return;
    setError("");
    setState("busy");
    let sent = "";
    try {
      sent = await signAndSendWithMobileWallet(session, prepared.transaction, prepared.chain);
      setSignature(sent);
    } catch (caught) {
      // A stale blockhash is the usual cause; prepare a fresh transfer for the next tap.
      setPrepared(null);
      setSession(null);
      setState("idle");
      setError(message(caught, "The wallet did not send the payment."));
      return;
    }
    setState("verifying");
    // Finalization takes a few seconds; keep asking the verifier until it accepts or we stop.
    for (let attempt = 0; attempt < 24; attempt++) {
      try {
        await confirmIncomeInvoice({ data: { id: invoiceId, signature: sent } });
        setState("done");
        onPaid();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    setState("idle");
    setError("Sent, but not yet verified. Use “Verify payment” below in a minute.");
  }

  return (
    <div className="panel stack-tight">
      <p className="eyebrow">
        <Smartphone size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Seeker or
        Android wallet
      </p>
      {!session || !prepared ? (
        <button
          className="btn btn-primary btn-block"
          disabled={state !== "idle"}
          onClick={() => void connect()}
        >
          {state === "busy" ? "Opening wallet…" : "Connect wallet to pay"}
        </button>
      ) : (
        <button
          className="btn btn-primary btn-block"
          disabled={state !== "idle"}
          onClick={() => void pay()}
        >
          {state === "verifying"
            ? "Verifying payment…"
            : state === "busy"
              ? "Approve in your wallet…"
              : `Pay ${displayUsdc(amountBase)} USDC`}
        </button>
      )}
      {signature && prepared && (
        <a
          className="link footnote"
          href={explorer(signature, prepared.chain)}
          target="_blank"
          rel="noreferrer"
        >
          View transaction on Solscan
        </a>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/**
 * Fund the user's own Oink wallet — USDC to invest, SOL for Bell's network fees — from their
 * Seeker wallet. The external wallet signs and pays; the Oink key is not involved.
 */
export function SeekerTopUp() {
  const available = useMobileWalletAvailable();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [usdc, setUsdc] = useState("");
  const [sol, setSol] = useState("0.02");
  const [prepared, setPrepared] = useState<ExternalTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState("");
  const [chain, setChain] = useState("solana:mainnet");
  const [error, setError] = useState("");
  if (!available) return null;

  async function run(work: () => Promise<void>, fallback: string) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      setError(message(caught, fallback));
    } finally {
      setBusy(false);
    }
  }

  const step = !session ? "connect" : !prepared ? "prepare" : "approve";
  return (
    <section className="panel stack">
      <div>
        <p className="eyebrow">Top up from Seeker wallet</p>
        <p className="meta" style={{ marginTop: 6 }}>
          Move USDC to invest and a little SOL for Bell network fees into this Oink wallet. Your
          Seeker wallet signs; Oink never touches its keys.
        </p>
      </div>
      {step !== "connect" && (
        <>
          <label className="stack-tight">
            USDC
            <input
              className="input"
              inputMode="decimal"
              value={usdc}
              placeholder="0"
              onChange={(e) => {
                setUsdc(e.target.value);
                setPrepared(null);
              }}
            />
          </label>
          <label className="stack-tight">
            SOL for fees
            <input
              className="input"
              inputMode="decimal"
              value={sol}
              onChange={(e) => {
                setSol(e.target.value);
                setPrepared(null);
              }}
            />
          </label>
        </>
      )}
      {step === "connect" && (
        <button
          className="btn btn-outline btn-block"
          disabled={busy}
          onClick={() =>
            void run(async () => setSession(await connectMobileWallet()), "Could not connect.")
          }
        >
          {busy ? "Opening wallet…" : "Connect Seeker wallet"}
        </button>
      )}
      {step === "prepare" && (
        <button
          className="btn btn-outline btn-block"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setSignature("");
              setPrepared(
                await buildTopUpTransaction({
                  data: {
                    payer: session!.account.address,
                    usdcBase: usdc ? parseUsdc(usdc) : "0",
                    lamports: sol ? parseSol(sol) : "0",
                  },
                }),
              );
            }, "Could not prepare the top-up.")
          }
        >
          {busy ? "Preparing…" : "Review top-up"}
        </button>
      )}
      {step === "approve" && (
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              try {
                setSignature(
                  await signAndSendWithMobileWallet(
                    session!,
                    prepared!.transaction,
                    prepared!.chain,
                  ),
                );
              } finally {
                setPrepared(null);
              }
            }, "The wallet did not send the top-up.")
          }
        >
          {busy
            ? "Approve in your wallet…"
            : `Send ${usdc || "0"} USDC + ${sol || "0"} SOL to Oink`}
        </button>
      )}
      {signature && (
        <p role="status" className="meta">
          Sent.{" "}
          <a className="link" href={explorer(signature, chain)} target="_blank" rel="noreferrer">
            View on Solscan
          </a>{" "}
          — balances update once it confirms.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/**
 * Pay a mix-settling Solana Pay transaction request (`solana:https://…/api/v1/pay/…`) from a
 * Seeker/Android wallet: the same request Phantom would make, signed by the payer's wallet.
 * Plain transfer links are left to "Open in a wallet".
 */
export function SeekerPayRequest({ solanaPayUri }: { solanaPayUri: string }) {
  const available = useMobileWalletAvailable();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [prepared, setPrepared] = useState<ExternalTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const link = transactionRequestLink(solanaPayUri);
  if (!available || !link) return null;

  async function connect() {
    setError("");
    setBusy(true);
    try {
      const connected = await connectMobileWallet();
      const response = await fetch(link!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: connected.account.address }),
      });
      const body = (await response.json()) as Partial<ExternalTransaction> & { message?: string };
      if (!response.ok || typeof body.transaction !== "string" || typeof body.chain !== "string")
        throw new Error(body.message || "Could not prepare this payment.");
      setSession(connected);
      setPrepared({ transaction: body.transaction, chain: body.chain });
    } catch (caught) {
      setError(message(caught, "Could not connect your wallet."));
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setError("");
    setBusy(true);
    try {
      setSignature(
        await signAndSendWithMobileWallet(session!, prepared!.transaction, prepared!.chain),
      );
    } catch (caught) {
      setSession(null);
      setPrepared(null);
      setError(message(caught, "The wallet did not send the payment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-tight">
      {signature ? (
        <p role="status" className="meta">
          Sent from your wallet.{" "}
          <a
            className="link"
            href={explorer(signature, prepared!.chain)}
            target="_blank"
            rel="noreferrer"
          >
            View on Solscan
          </a>
        </p>
      ) : (
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() => void (session && prepared ? pay() : connect())}
        >
          <Smartphone size={16} aria-hidden="true" />{" "}
          {busy
            ? "Waiting for wallet…"
            : session && prepared
              ? "Approve payment in wallet"
              : "Pay with Seeker wallet"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
