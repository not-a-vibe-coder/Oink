import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BellQuoteBrief } from "@/components/bell/BellPurchases";
import { DEMO_ALLOCATION, demoQuotes } from "@/lib/demo/scenario";
import { displayUsdc } from "@/lib/flow/amounts";
import { evaluateBellPolicy } from "@/lib/bell/policy";
import type { BellQuote } from "@/lib/bell/types";
export const Route = createFileRoute("/demo")({
  component: DemoPage,
  head: () => ({
    meta: [
      { title: "Oink Flow + Bell — simulated product walkthrough" },
      { name: "robots", content: "noindex" },
    ],
  }),
});
type Stage =
  "request" | "received" | "allocated" | "quoted" | "prepared" | "submitted" | "completed";
function DemoPage() {
  const [stage, setStage] = useState<Stage>("request");
  const [quotes, setQuotes] = useState<BellQuote[]>([]);
  const [error, setError] = useState("");
  const allocated = ["allocated", "quoted", "prepared", "submitted", "completed"].includes(stage);
  function check() {
    setQuotes(demoQuotes(Date.now()));
    setStage("quoted");
    setError("");
  }
  function approve() {
    const quote = quotes[0];
    if (
      !quote ||
      evaluateBellPolicy({ ...quote, slippageBps: quote.policy.slippageBps }, quote.policy)
        .status !== "pass"
    ) {
      setError("Quote expired. Check fresh quotes and review again.");
      return;
    }
    setStage("submitted");
  }
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            Oink
          </Link>
          <span className="meta">Flow + Bell</span>
        </div>
      </header>
      <main className="stack demo-page">
        <p className="notice" role="note">
          Simulated walkthrough. All payments, quotes and fills below are fictional. No wallet
          connection, signing, or funds movement.
        </p>
        <div className="page-head">
          <p className="eyebrow">From income to investments</p>
          <h1 className="page-title">Keep your cash. Grow your plan.</h1>
          <p className="page-sub">
            Fill your cash reserve first. Review each investment before it leaves USDC.
          </p>
        </div>
        <section className="panel stack">
          <h2 className="eyebrow">Your income plan</h2>
          <p className="figure">
            1,000 <span className="meta">USDC cash target</span>
          </p>
          <p className="meta">
            800 USDC available before payment · Invest surplus 60% SPYx / 40% AAPLx.
          </p>
        </section>
        <section className="panel stack">
          <h2 className="eyebrow">Client payment</h2>
          <p className="figure">
            500 <span className="meta">USDC</span>
          </p>
          <p role="status">
            {stage === "request"
              ? "Payment requested"
              : "Payment received · illustrative finalized receipt"}
          </p>
          {stage === "request" && (
            <button className="btn btn-primary" onClick={() => setStage("received")}>
              Simulate payment receipt
            </button>
          )}
          {stage === "received" && (
            <button className="btn btn-primary" onClick={() => setStage("allocated")}>
              Allocate received income
            </button>
          )}
          {allocated && (
            <>
              <p className="meta">
                {displayUsdc(DEMO_ALLOCATION.cashBase)} USDC stays in cash ·{" "}
                {displayUsdc(DEMO_ALLOCATION.investmentBase)} USDC assigned to investments.
              </p>
              <p className="footnote">
                Your cash target is filled. Investment orders are accounted for separately from
                payment receipt.
              </p>
            </>
          )}
        </section>
        {allocated && (
          <section className="stack">
            <h2 className="eyebrow">Bell investment orders</h2>
            {["allocated", "quoted", "prepared"].includes(stage) && (
              <button className="btn btn-outline" onClick={check}>
                Check fresh demo quotes
              </button>
            )}
            {quotes.map((quote, index) => (
              <article key={quote.id} className="panel stack">
                <div className="row">
                  <h3>{quote.symbol}</h3>
                  <span className="meta">
                    {index === 1
                      ? "Deferred · USDC reserved"
                      : stage === "completed"
                        ? "Completed"
                        : stage === "submitted"
                          ? "Submitted · USDC reserved"
                          : "Awaiting approval"}
                  </span>
                </div>
                <BellQuoteBrief quote={quote} />
                {index === 0 && stage === "quoted" && (
                  <button className="btn btn-outline" onClick={() => setStage("prepared")}>
                    Review demo simulation
                  </button>
                )}
                {index === 0 && stage === "prepared" && (
                  <>
                    <p className="meta">
                      Illustrative simulation: 180 USDC spent · 0.3 SPYx received · 0.000005 SOL
                      fee.
                    </p>
                    <button className="btn btn-primary" onClick={approve}>
                      Simulate approval
                    </button>
                  </>
                )}
                {index === 0 && stage === "submitted" && (
                  <button className="btn btn-primary" onClick={() => setStage("completed")}>
                    Simulate finalized receipt
                  </button>
                )}
                {index === 0 && stage === "completed" && (
                  <p className="meta">
                    Illustrative actual fill: 180 USDC spent · 0.3 SPYx received · 0.000005 SOL fee.
                    No chain transaction exists for this example.
                  </p>
                )}
              </article>
            ))}
          </section>
        )}
        {stage === "completed" && (
          <section className="panel stack">
            <h2 className="eyebrow">Payment and investment receipt</h2>
            <p className="meta">
              500 USDC received · 200 USDC cash · 180 USDC completed · 120 USDC reserved for the
              deferred purchase.
            </p>
            <p>
              The AAPLx order exceeds the 100 USDC token-price limit. That money remains in USDC.
            </p>
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="row">
          <button
            className="btn btn-outline"
            onClick={() => {
              setStage("request");
              setQuotes([]);
              setError("");
            }}
          >
            Restart walkthrough
          </button>
          <Link className="link" to="/create">
            Create an Oink wallet
          </Link>
        </div>
      </main>
    </div>
  );
}
