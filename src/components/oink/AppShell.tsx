import { Link, useRouterState } from "@tanstack/react-router";
import { Lock, LockOpen } from "lucide-react";
import type { ReactNode } from "react";
import { PigAvatar } from "@/components/oink/PigAvatar";
import { useKeySession } from "@/hooks/useKeySession";
import { lock } from "@/lib/wallet/key-session";

const NAV: Array<{
  to:
    | "/app"
    | "/app/send"
    | "/app/receive"
    | "/app/election"
    | "/app/activity"
    | "/app/invoices"
    | "/app/settings";
  label: string;
  exact?: boolean;
}> = [
  { to: "/app", label: "Wallet", exact: true },
  { to: "/app/send", label: "Send" },
  { to: "/app/receive", label: "Receive" },
  { to: "/app/election", label: "Election" },
  { to: "/app/activity", label: "Activity" },
  { to: "/app/invoices", label: "Requests" },
  { to: "/app/settings", label: "Settings" },
];

export function AppShell({
  tag,
  avatarSeed,
  children,
}: {
  tag: string | undefined;
  avatarSeed?: string;
  children: ReactNode;
}) {
  const { unlocked } = useKeySession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/app" className="brand">
            Oink
          </Link>

          <div className="row" style={{ marginLeft: "auto", gap: "var(--s3)" }}>
            {tag && (
              <span className="identity">
                <PigAvatar seed={avatarSeed ?? tag} size={30} />
                <span className="identity-tag">@{tag}</span>
              </span>
            )}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => lock()}
              disabled={!unlocked}
              title={unlocked ? "Lock the key held in this tab" : "The key is not in memory"}
            >
              {unlocked ? (
                <LockOpen size={15} aria-hidden="true" />
              ) : (
                <Lock size={15} aria-hidden="true" />
              )}
              <span>{unlocked ? "Lock" : "Locked"}</span>
            </button>
          </div>
        </div>

        <nav className="topbar-rail" aria-label="Wallet sections">
          <div className="topbar-nav">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              return (
                <Link key={item.to} to={item.to} className="navlink" data-active={active}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      {children}

      <footer
        className="topbar-rail"
        style={{ borderTop: "1px solid var(--hairline)", borderBottom: 0 }}
      >
        <p className="footnote" style={{ padding: "var(--s4) 0" }}>
          Self-custodial. Oink holds ciphertext it cannot read and a fee payer that can pay fees and
          nothing else.{" "}
          <Link to="/legal/terms" className="link">
            Terms
          </Link>{" "}
          ·{" "}
          <Link to="/legal/privacy" className="link">
            Privacy
          </Link>
        </p>
      </footer>
    </div>
  );
}
