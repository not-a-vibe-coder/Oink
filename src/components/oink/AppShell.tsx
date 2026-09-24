import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AccountBubble } from "@/components/oink/AccountBubble";
import { MobileTabBar } from "@/components/oink/MobileTabBar";
import { ThemeToggle } from "@/components/oink/ThemeToggle";

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
export type NavItem = {
  to: NavTarget;
  label: string;
  icon: string;
  animated?: string;
  flip?: boolean;
  exact?: boolean;
};

const WALLET: NavItem = { to: "/app", label: "Wallet", icon: "/nav/wallet.png", exact: true };
const SEND: NavItem = { to: "/app/send", label: "Send", icon: "/nav/receive.png", flip: true };
const RECEIVE: NavItem = { to: "/app/receive", label: "Receive", icon: "/nav/receive.png" };
const MIX: NavItem = { to: "/app/mix", label: "Mix", icon: "/nav/mix.png", animated: "/nav/mix.gif" };
const ACTIVITY: NavItem = { to: "/app/activity", label: "Activity", icon: "/nav/activity.png" };
const REQUESTS: NavItem = { to: "/app/invoices", label: "Requests", icon: "/nav/requests.png" };
const SETTINGS: NavItem = { to: "/app/settings", label: "Settings", icon: "/nav/settings.png" };

// Desktop dock order. On phones the pill carries the everyday four and the plus opens the rest.
const NAV = [WALLET, SEND, RECEIVE, MIX, ACTIVITY, REQUESTS, SETTINGS];
const PHONE_PRIMARY = [WALLET, SEND, RECEIVE, SETTINGS];
const PHONE_MORE = [MIX, ACTIVITY, REQUESTS];

export function AppShell({
  accountId,
  address,
  avatarSeed,
  children,
}: {
  accountId?: string;
  address?: string;
  avatarSeed?: string;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/app" className="brand">
            Oink
          </Link>

          <div className="topbar-end">
            <ThemeToggle />
            {accountId && address && (
              <AccountBubble accountId={accountId} address={address} avatarSeed={avatarSeed ?? accountId} />
            )}
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

      <MobileTabBar primary={PHONE_PRIMARY} more={PHONE_MORE} />

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
