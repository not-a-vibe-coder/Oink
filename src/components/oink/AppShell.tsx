import { Link, useRouterState } from "@tanstack/react-router";
import { Lock, LockOpen } from "lucide-react";
import type { ReactNode } from "react";
import { PigAvatar } from "@/components/oink/PigAvatar";
import { useKeySession } from "@/hooks/useKeySession";
import { lock } from "@/lib/wallet/key-session";

type NavTarget =
  | "/app"
  | "/app/send"
  | "/app/receive"
  | "/app/mix"
  | "/app/activity"
  | "/app/invoices"
  | "/app/settings";

// Icons8 line icons, served from public/nav. Send has no icon of its own: it is Receive's
// arrow turned upward (the `flip` flag), so the pair reads as one gesture in two directions.
// Mix swaps its still frame for the animated one while hovered or open.
const NAV: Array<{
  to: NavTarget;
  label: string;
  icon: string;
  animated?: string;
  flip?: boolean;
  exact?: boolean;
}> = [
  { to: "/app", label: "Wallet", icon: "/nav/wallet.png", exact: true },
  { to: "/app/send", label: "Send", icon: "/nav/receive.png", flip: true },
  { to: "/app/receive", label: "Receive", icon: "/nav/receive.png" },
  { to: "/app/mix", label: "Mix", icon: "/nav/mix.png", animated: "/nav/mix.gif" },
  { to: "/app/activity", label: "Activity", icon: "/nav/activity.png" },
  { to: "/app/invoices", label: "Requests", icon: "/nav/requests.png" },
  { to: "/app/settings", label: "Settings", icon: "/nav/settings.png" },
];

export function AppShell({
  tag,
  accountId,
  avatarSeed,
  children,
}: {
  tag: string | null | undefined;
  /** Shown in place of the tag until the user links X. */
  accountId?: string;
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
            {(tag || accountId) && (
              <span className="identity">
                <PigAvatar seed={avatarSeed ?? tag ?? accountId ?? ""} size={30} />
                <span className="identity-tag">{tag ? `@${tag}` : accountId}</span>
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

      </header>

      <nav className="dock" aria-label="Wallet sections">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className="dock-item"
              data-active={active}
              aria-current={active ? "page" : undefined}
            >
              <span className="dock-icon" data-flip={item.flip || undefined}>
                <img src={item.icon} alt="" className="dock-still" draggable={false} />
                {item.animated && <img src={item.animated} alt="" className="dock-animated" draggable={false} />}
              </span>
              <span className="dock-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

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
          </Link>{" "}
          · Icons by{" "}
          <a href="https://icons8.com" target="_blank" rel="noreferrer" className="link">
            Icons8
          </a>
        </p>
      </footer>
    </div>
  );
}
