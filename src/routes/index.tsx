import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ChevronUp } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const TICKER_ITEMS = [
  "Tokenized Equities (xStocks)",
  "Atomic Jupiter Routing",
  "Human-Readable @tag",
  "Password + TOTP Keystore",
  "Zero Seed-Phrase Onboarding",
  "Portfolio Elections (SPYx, TSLAx)",
  "Non-Custodial on Solana",
  "Gas-Sponsored Transfers",
];

const TRUSTED_COMPANIES = [
  { name: "Solana", className: "brand-solana" },
  { name: "Jupiter", className: "brand-jupiter" },
  { name: "Circle USDC", className: "brand-usdc" },
  { name: "SPYx", className: "brand-spyx" },
  { name: "NVDAx", className: "brand-nvdax" },
  { name: "TSLAx", className: "brand-tslax" },
  { name: "AAPLx", className: "brand-aaplx" },
  { name: "GLDx", className: "brand-gldx" },
  { name: "Phantom", className: "brand-phantom" },
  { name: "Pyth Network", className: "brand-pyth" },
];

const DRAWER_LINKS = [
  { label: "Create Wallet", href: "/create" },
  { label: "Unlock / Recover", href: "/unlock" },
  { label: "Portfolio Elections", href: "/app/election" },
  { label: "Tokenized Equities", href: "#stocks" },
  { label: "Security & Keys", href: "#security" },
  { label: "Documentation", href: "https://github.com" },
];

// Pre-computed constants for deterministic SSR & hydration
const LEFT_CURVES = Array.from({ length: 20 }, (_, i) => ({
  id: `left-curve-${i}`,
  width: `${60 + i * 10}px`,
  delay: `${(i * 0.25).toFixed(2)}s`,
}));

const RIGHT_CURVES = Array.from({ length: 20 }, (_, i) => ({
  id: `right-curve-${i}`,
  width: `${60 + i * 10}px`,
  delay: `${(i * 0.25).toFixed(2)}s`,
}));

const TOP_CURVES = Array.from({ length: 15 }, (_, i) => ({
  id: `top-curve-${i}`,
  height: `${40 + i * 8}px`,
  width: `${100 - i * 4}%`,
  delay: `${(i * 0.25).toFixed(2)}s`,
}));

function LandingPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on Escape key or on desktop resize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };

    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const toggleDrawer = () => setDrawerOpen((prev) => !prev);
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="alwayzz-page">
      {/* 1. Navbar */}
      <nav className="alwayzz-nav" aria-label="Main Navigation">
        <div className="alwayzz-nav-inner">
          <a href="/" className="alwayzz-logo" aria-label="Oink Home">
            Oink<span className="alwayzz-logo-reg">®</span>
          </a>

          <button
            type="button"
            className="alwayzz-menu-btn"
            onClick={toggleDrawer}
            aria-expanded={drawerOpen}
            aria-controls="alwayzz-drawer"
            aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            <span>Menu</span>
            <ChevronUp
              className={`alwayzz-menu-icon ${drawerOpen ? "is-open" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </nav>

      {/* Full-screen Drawer Overlay */}
      <div
        id="alwayzz-drawer"
        className={`alwayzz-drawer ${drawerOpen ? "is-open" : ""}`}
        aria-hidden={!drawerOpen}
      >
        <div className="alwayzz-drawer-links">
          {DRAWER_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="alwayzz-drawer-link"
              onClick={closeDrawer}
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="alwayzz-drawer-footer">
          <p>
            © {new Date().getFullYear()} Oink. Self-custodial Solana wallet. Built for the Solana
            stocks hackathon.
          </p>
        </div>
      </div>

      {/* 2. Hero Section */}
      <section className="alwayzz-hero" aria-label="Hero Section">
        {/* Decorative Curved Lines - Left Side (20 lines) */}
        <div className="lines-left-container" aria-hidden="true">
          {LEFT_CURVES.map((curve) => (
            <div
              key={curve.id}
              className="curved-line-left"
              style={{
                width: curve.width,
                animationDelay: curve.delay,
              }}
            />
          ))}
        </div>

        {/* Decorative Curved Lines - Right Side (20 lines) */}
        <div className="lines-right-container" aria-hidden="true">
          {RIGHT_CURVES.map((curve) => (
            <div
              key={curve.id}
              className="curved-line-right"
              style={{
                width: curve.width,
                animationDelay: curve.delay,
              }}
            />
          ))}
        </div>

        {/* Decorative Curved Lines - Mobile Top Side */}
        <div className="lines-top-container" aria-hidden="true">
          {TOP_CURVES.map((curve) => (
            <div
              key={curve.id}
              className="curved-line-top"
              style={{
                height: curve.height,
                width: curve.width,
                animationDelay: curve.delay,
              }}
            />
          ))}
        </div>

        {/* Ticker Row */}
        <div className="alwayzz-ticker-wrap" aria-label="Capabilities ticker">
          <div className="alwayzz-ticker-track">
            {/* Repeat items 4x for seamless infinite marquee */}
            {[0, 1, 2, 3].flatMap((setIdx) =>
              TICKER_ITEMS.map((item, idx) => (
                <span key={`${setIdx}-${idx}`} className="alwayzz-ticker-item">
                  {item}
                </span>
              )),
            )}
          </div>
        </div>

        {/* Title */}
        <h1 className="alwayzz-hero-title">
          Settle into stocks <span className="serif-italic">oink</span>
          <sup className="reg-mark">®</sup> on Solana.
        </h1>

        {/* Subtitle */}
        <p className="alwayzz-hero-sub">
          Hold a portfolio, not a currency. The self-custodial Solana wallet where your tag is your
          account, onboarding needs no seed phrase, and inbound payments settle atomically into your
          elected stock portfolio.
        </p>

        {/* CTA Row */}
        <div className="alwayzz-cta-row">
          <a href="/create" className="btn-view-plans">
            Create Wallet
          </a>

          <a
            href="/create"
            className="btn-chat"
            aria-label="Claim your tag on Oink, instant setup with no seed phrase"
          >
            <img
              src="https://framerusercontent.com/images/hfneFL6CHBi5BnNvCeOaqU9HqE4.png"
              alt="Oink Tag avatar"
              className="avatar-chat"
              width={40}
              height={40}
              loading="lazy"
            />
            <div className="chat-text-stack">
              <span className="chat-primary">Claim your @tag</span>
              <span className="chat-secondary">
                <span className="green-dot" aria-hidden="true" />
                No seed phrase required
              </span>
            </div>
          </a>
        </div>

        {/* Progressive Blur at Bottom */}
        <div className="alwayzz-blur-bottom" aria-hidden="true" />
      </section>

      {/* 3. TrustedBy Section */}
      <section className="alwayzz-trusted" aria-label="Ecosystem Partners">
        <p className="trusted-label">Settling atomically across Solana &amp; tokenized equities</p>

        <div className="trusted-marquee-wrap">
          <div className="trusted-marquee-track">
            {/* Duplicated 2x for seamless continuous 30s scroll */}
            {[0, 1].flatMap((copyIdx) =>
              TRUSTED_COMPANIES.map((company, idx) => (
                <span key={`${copyIdx}-${idx}`} className={`brand-logo-text ${company.className}`}>
                  {company.name}
                </span>
              )),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
