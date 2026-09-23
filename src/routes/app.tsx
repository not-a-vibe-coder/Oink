import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/oink/AppShell";
import { useSession } from "@/hooks/useOink";
import { WalletSessionProvider } from "@/lib/app-session";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

/**
 * The session gate for every locked route.
 *
 * A valid session with a *locked key* is not a reason to throw someone out —
 * reading balances and activity only needs the cookie. Screens that must sign
 * ask for the password in place. Only a missing session redirects.
 */
function AppLayout() {
  const navigate = useNavigate();
  const session = useSession();

  useEffect(() => {
    if (session.isError) void navigate({ to: "/unlock", replace: true });
  }, [session.isError, navigate]);

  if (session.isPending) {
    return (
      <AppShell tag={undefined}>
        <main className="shell">
          <div className="stack">
            <div className="skeleton" style={{ height: 96, maxWidth: 320 }} />
            <div className="skeleton" style={{ height: 14, maxWidth: 220 }} />
            <div className="skeleton" style={{ height: 240 }} />
          </div>
        </main>
      </AppShell>
    );
  }

  if (!session.data) {
    return (
      <AppShell tag={undefined}>
        <main className="shell">
          <div className="empty">
            <p className="empty-title">Your session has ended</p>
            <p className="empty-note">Taking you to the sign-in screen.</p>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <WalletSessionProvider
      value={{
        accountId: session.data.accountId,
        tag: session.data.tag,
        publicKey: session.data.publicKey,
        expiresAt: session.data.expiresAt,
      }}
    >
      <AppShell tag={session.data.tag} accountId={session.data.accountId} avatarSeed={session.data.publicKey.slice(0, 8)}>
        <Outlet />
      </AppShell>
    </WalletSessionProvider>
  );
}
