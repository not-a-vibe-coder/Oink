import { useEffect, useSyncExternalStore } from "react";
import {
  armBrowserLockGuards,
  isUnlocked,
  onLockChange,
  publicKey,
} from "@/lib/wallet/key-session";

/**
 * React's only view of the key session. It reads the two safe predicates and
 * never touches the Keypair — see docs/06 §9.
 */
export function useKeySession(): { unlocked: boolean; publicKey: string | null } {
  const unlocked = useSyncExternalStore(
    onLockChange,
    () => isUnlocked(),
    () => false,
  );

  useEffect(() => {
    armBrowserLockGuards();
  }, []);

  return { unlocked, publicKey: unlocked ? publicKey() : null };
}
