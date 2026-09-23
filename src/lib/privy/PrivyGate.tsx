/**
 * Privy, loaded only where an identity has to be proven: the linking controls and /admin.
 *
 * Privy's SDK is third-party code running in our origin, and the wallet's key lives in
 * this origin's memory while unlocked. So it is never part of the main bundle: it loads
 * lazily, client-side only, on the few surfaces that need it. It is configured to create
 * no embedded wallets — Privy proves an email or an X account and nothing else.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { privyAppId as appId } from "./config";

const LazyProvider = lazy(() => import("./PrivyProviderImpl"));

export function PrivyGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  // The provider touches window and storage, so it mounts only after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!appId || !mounted) return <>{fallback}</>;
  return (
    <Suspense fallback={fallback}>
      <LazyProvider appId={appId}>{children}</LazyProvider>
    </Suspense>
  );
}
