import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CopyButton } from "@/components/oink/CopyButton";
import { QrCode } from "@/components/oink/QrCode";
import { displayUsdc } from "@/lib/flow/amounts";
import { confirmIncomeInvoice, getIncomeInvoice } from "@/lib/flow/server-fns";
export const Route = createFileRoute("/income/$invoiceId")({ component: IncomeRequest });
function IncomeRequest() {
  const { invoiceId } = Route.useParams();
  const [signature, setSignature] = useState("");
  const invoice = useQuery({ queryKey: ["flowInvoice", invoiceId], queryFn: () => getIncomeInvoice({ data: { id: invoiceId } }), retry: false, refetchInterval: 15_000 });
  const confirm = useMutation({ mutationFn: () => confirmIncomeInvoice({ data: { id: invoiceId, signature: signature.trim() } }), onSuccess: () => invoice.refetch() });
  return <main className="stage"><Link to="/" className="brand">Oink</Link>
    {invoice.isPending ? <p>Loading payment request…</p> : invoice.isError ? <p role="alert">Could not load this payment request. Check the link or try again later.</p> : <div className="stack"><p className="eyebrow">Income payment request</p><h1 className="figure figure-lg">{displayUsdc(invoice.data.amountBase)} USDC</h1>
      <p className="meta">Pay in USDC. The recipient manages their allocation separately after receipt.</p>
      {invoice.data.status === "pending" && <><QrCode value={invoice.data.solanaPayUri} size={220} /><a className="btn btn-primary" href={invoice.data.solanaPayUri}>Open in wallet</a><CopyButton value={invoice.data.solanaPayUri} label="Copy payment request" /><p className="footnote">Use the payment request so your wallet includes its unique reference. Sending to the address alone cannot confirm this invoice.</p></>}
      <p role="status">{invoice.data.status === "paid" ? "Payment received. Investment allocation is separate." : invoice.data.status === "expired" ? "This request expired. Ask the recipient for a new link." : "Awaiting payment."}</p>
      {invoice.data.status !== "paid" && <><label>Already paid? Paste the transaction signature.<input className="input" value={signature} onChange={(e) => setSignature(e.target.value)} autoComplete="off" /></label><button className="btn btn-outline" disabled={confirm.isPending || !signature.trim()} onClick={() => confirm.mutate()}>{confirm.isPending ? "Verifying…" : "Verify payment"}</button><p className="footnote">Confirmation waits for finalized chain evidence. If your payment just landed, try again shortly.</p></>}
      {confirm.isError && <p role="alert">{confirm.error.message}</p>}
    </div>}
  </main>;
}
