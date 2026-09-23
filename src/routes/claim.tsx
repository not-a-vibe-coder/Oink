import { createFileRoute, Link } from "@tanstack/react-router";

/**
 * Where a held-payment email sends people (docs/12 §5). It asks for nothing: the claim
 * itself happens when the recipient links the email or X account the money was sent to.
 */
export const Route = createFileRoute("/claim")({
  head: () => ({ meta: [{ title: "Claim your payment · Oink" }] }),
  component: ClaimPage,
});

function ClaimPage() {
  return (
    <main className="stage">
      <Link to="/" className="brand" style={{ display: "inline-block", marginBottom: "var(--s6)" }}>
        Oink
      </Link>

      <header className="page-head">
        <h1 className="page-title">
          Someone sent you <span className="serif">money</span>
        </h1>
        <p className="page-sub">
          It's being held for you on Oink. Three steps and it's in a wallet only you control.
        </p>
      </header>

      <ol className="stack" style={{ paddingLeft: 20, marginBottom: "var(--s5)" }}>
        <li>
          <strong>Create a wallet.</strong> A password and an authenticator app — no seed phrase to
          type, about two minutes.
        </li>
        <li>
          <strong>Link the email it was sent to</strong> (or the X account) in Settings →
          Connections. You'll get a code to prove it's yours.
        </li>
        <li>
          <strong>That's it.</strong> The payment moves into your wallet automatically.
        </li>
      </ol>

      <div className="callout" data-tone="warn" style={{ marginBottom: "var(--s5)" }}>
        Claim it before the deadline in your email, or it goes back to the sender. Oink will never
        ask for your password, your authenticator code or your secret phrase by email.
      </div>

      <div className="stack-tight">
        <Link to="/create" className="btn btn-primary btn-block">
          Create my wallet
        </Link>
        <Link to="/unlock" className="btn btn-outline btn-block">
          I already have one — log in
        </Link>
      </div>
    </main>
  );
}
