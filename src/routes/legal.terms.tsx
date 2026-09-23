import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="stage stage-wide">
      <Link to="/" className="brand" style={{ display: "inline-block", marginBottom: "var(--s6)" }}>
        Oink
      </Link>

      <header className="page-head">
        <h1 className="page-title">Terms</h1>
        <p className="page-sub">
          Plain language, because the things that can go wrong here are permanent.
        </p>
      </header>

      <div className="prose">
        <h2>Oink is self-custodial</h2>
        <p>
          Your private key is generated in your browser and encrypted there with your password. Oink
          stores the ciphertext and cannot decrypt it. Nobody at Oink can move your money, freeze
          it, reverse a payment or sign anything on your behalf.
        </p>

        <h2>If you lose your credentials, we cannot help</h2>
        <p>
          There is no password reset, no backup code and no support channel that can restore access.
          Your 12-word secret phrase is the only recovery path in the product. If you lose your
          password and your phrase, the money in that wallet is gone permanently.
        </p>

        <h2>Payments are final</h2>
        <p>
          A transaction broadcast to Solana cannot be recalled. Check the tag or address before you
          send. A payment to the wrong address is not recoverable by us or by anyone else.
        </p>

        <h2>Mix and market risk</h2>
        <p>
          When a payment settles into your mix, it is swapped through Jupiter into the assets
          you chose. Those assets are tokenized instruments whose value moves with their underlying
          markets, and can fall. Routing depends on available liquidity: when the price impact on an
          elected asset exceeds a safe limit, that portion is settled into USDC instead and the
          transaction says so.
        </p>

        <h2>Fee sponsorship</h2>
        <p>
          A new wallet has no SOL, so Oink may co-sign as fee payer to cover network fees, subject
          to a daily cap. The fee payer can pay fees and nothing else — it has no authority over
          your funds. Sponsorship is a courtesy, not a guarantee, and may be withdrawn.
        </p>

        <h2>Tags</h2>
        <p>
          Tags are first come, first served, unique, and permanent once claimed. Reserved tags and
          tags that impersonate others may be withheld or reclaimed.
        </p>

        <h2>No warranty</h2>
        <p>
          Oink is provided as is, without warranty of any kind. It is a young product built for a
          hackathon. Do not put in more than you can afford to lose.
        </p>
      </div>

      <p className="footnote" style={{ marginTop: "var(--s6)" }}>
        <Link to="/legal/privacy" className="link">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link to="/" className="link">
          Home
        </Link>
      </p>
    </main>
  );
}
