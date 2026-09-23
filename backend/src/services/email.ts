import { getConfig } from "../config";

/**
 * Payment notifications through Resend. "Someone sent you money, click to claim" is exactly
 * what phishing looks like, so the email names the sender by @tag (never their email),
 * links only to the app's own domain, asks for nothing, and says so.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function heldPaymentEmail(input: {
  senderLabel: string;
  amount: string;
  symbol: string;
  expiresAt: Date;
  note?: string | null;
  appUrl: string;
}) {
  const deadline = input.expiresAt.toUTCString().replace(" GMT", " UTC");
  const claimUrl = `${input.appUrl.replace(/\/+$/, "")}/claim`;
  const subject = `${input.senderLabel} sent you ${input.amount} ${input.symbol} on Oink`;
  const text = [
    `${input.senderLabel} sent you ${input.amount} ${input.symbol}.`,
    input.note ? `Their note: "${input.note}"` : null,
    "",
    `To receive it, create an Oink wallet and link this email address before ${deadline}.`,
    `If it isn't claimed by then, it goes back to the sender.`,
    "",
    `Start here: ${claimUrl}`,
    "",
    "Oink will never ask for your password, your authenticator code or your secret phrase by email.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#0a0a0a;max-width:520px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#666;margin:0 0 20px">Oink</p>
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(input.senderLabel)} sent you ${escapeHtml(input.amount)} ${escapeHtml(input.symbol)}</h1>
${input.note ? `<p style="margin:0 0 16px;padding:12px;background:#f6f6f6;border-radius:8px">“${escapeHtml(input.note)}”</p>` : ""}
<p style="margin:0 0 16px">To receive it, create an Oink wallet and link this email address before <strong>${escapeHtml(deadline)}</strong>. If it isn't claimed by then, it goes back to the sender.</p>
<p style="margin:24px 0"><a href="${escapeHtml(claimUrl)}" style="background:#0a0a0a;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">Claim it on Oink</a></p>
<p style="font-size:12px;color:#666;margin:24px 0 0">Oink will never ask for your password, your authenticator code or your secret phrase by email. If you weren't expecting this, you can ignore it.</p>
</body></html>`;

  return { subject, text, html };
}

/** Best effort: a failed email never fails the payment, which the recipient can still claim. */
export async function sendEmail(to: string, message: { subject: string; text: string; html: string }): Promise<boolean> {
  const config = getConfig();
  if (!config.resendApiKey) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!res.ok) console.error("Email send failed:", res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (err) {
    console.error("Email send error:", err instanceof Error ? err.message : err);
    return false;
  }
}
