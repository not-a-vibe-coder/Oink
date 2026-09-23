import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="stage stage-wide">
      <Link to="/" className="brand" style={{ display: "inline-block", marginBottom: "var(--s6)" }}>
        Oink
      </Link>

      <header className="page-head">
        <h1 className="page-title">Privacy</h1>
        <p className="page-sub">What Oink holds, what it cannot hold, and what is public anyway.</p>
      </header>

      <div className="prose">
        <h2>What never reaches the server</h2>
        <ul>
          <li>Your password.</li>
          <li>Your 12-word secret phrase.</li>
          <li>Your private key, in any form that can be decrypted by us.</li>
        </ul>
        <p>
          The browser derives two keys from your password: one that encrypts your wallet and never
          leaves the device, and one that only proves you know the password. Oink stores a hash of
          the second one and the ciphertext produced by the first.
        </p>

        <h2>What Oink stores</h2>
        <ul>
          <li>Your account ID, your public Solana address and when the account was made.</li>
          <li>
            If you link them: your email address, and your X username and X user ID, which also
            set your tag.
          </li>
          <li>Your encrypted keystore and the parameters needed to derive its key.</li>
          <li>Your authenticator secret, encrypted with a server key, for verifying codes.</li>
          <li>Your mix, your payment requests and the transfers you made through Oink.</li>
          <li>
            Sessions: a hashed token, a truncated hash of your IP, and your browser's user agent.
          </li>
        </ul>

        <h2>What is public no matter what we do</h2>
        <p>
          Solana is a public ledger. Your address, its balances and every transaction it makes are
          visible to anyone, including the split your mix produced. Your tag is deliberately
          public — that is how people pay you — and it is linked to your address.
        </p>

        <h2>Linking email and X</h2>
        <p>
          Linking is optional. It is needed only to claim a tag (X) or to be paid at your email.
          Creating, receiving, sending, setting your mix and recovering all work without it.
          We use Privy to confirm you own the email or X account: Privy sees the email address
          or X account you prove, never your wallet's keys or password.
        </p>

        <h2>No tracking</h2>
        <p>
          There is no advertising network in this product and no third-party analytics reading
          your wallet.
        </p>

        <h2>Logs</h2>
        <p>
          Credential material is redacted from server logs by name, including the derived auth key,
          keystore fields and authenticator codes. Errors returned near credentials carry no details
          in production.
        </p>
      </div>

      <p className="footnote" style={{ marginTop: "var(--s6)" }}>
        <Link to="/legal/terms" className="link">
          Terms
        </Link>{" "}
        ·{" "}
        <Link to="/" className="link">
          Home
        </Link>
      </p>
    </main>
  );
}
