import { createContext, useContext } from "react";

export interface WalletSession {
  tag: string;
  publicKey: string;
  expiresAt: string;
}

const WalletSessionContext = createContext<WalletSession | null>(null);

export const WalletSessionProvider = WalletSessionContext.Provider;

/**
 * Available to every locked route because the /app layout has already proven
 * the session before rendering its children.
 */
export function useWalletSession(): WalletSession {
  const session = useContext(WalletSessionContext);
  if (!session) {
    throw new Error("useWalletSession must be used inside the /app layout.");
  }
  return session;
}
