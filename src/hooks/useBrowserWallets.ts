import { useEffect, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { isPaymentWallet, mwaSupported } from "@/lib/mwa/mwa";

/**
 * Browser-extension wallets (Phantom, Solflare, Backpack…) that announce themselves through the
 * Wallet Standard. Client-only and live: extensions can register after the page loads. Android
 * Chrome uses Mobile Wallet Adapter instead, so this stays empty there.
 */
export function useBrowserWallets(): Wallet[] {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  useEffect(() => {
    if (mwaSupported()) return;
    let off: (() => void)[] = [];
    let cancelled = false;
    void import("@wallet-standard/app").then(({ getWallets }) => {
      if (cancelled) return;
      const registry = getWallets();
      const refresh = () => setWallets(registry.get().filter(isPaymentWallet));
      refresh();
      off = [registry.on("register", refresh), registry.on("unregister", refresh)];
    });
    return () => {
      cancelled = true;
      off.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
  return wallets;
}
