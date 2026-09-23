/**
 * Proves "I control this email / this X account" and hands back Privy's identity token.
 *
 * Privy is only a witness here, so every proof is a throwaway Privy login: start from
 * signed out, sign in with exactly one method, read the identity token, sign out again.
 * Nothing about the Privy session outlives the proof.
 *
 * X sign-in leaves the page for X's OAuth screen and comes back. The intent is parked in
 * sessionStorage so whichever screen mounts on return can finish the proof; the Privy
 * login callback fires there, not here.
 */
import { getIdentityToken, useLogin, usePrivy } from "@privy-io/react-auth";
import { useCallback, useRef, useState } from "react";

export type ProofMethod = "email" | "twitter";
export type ProofPurpose = "link-email" | "link-x" | "admin";

const PENDING_KEY = "oink:identity-proof";

function readPending(): ProofPurpose | null {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    return value === "link-email" || value === "link-x" || value === "admin" ? value : null;
  } catch {
    return null;
  }
}

function writePending(purpose: ProofPurpose | null) {
  try {
    if (purpose) sessionStorage.setItem(PENDING_KEY, purpose);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode: the proof still works as long as it does not leave the page */
  }
}

const methodFor = (purpose: ProofPurpose): ProofMethod => (purpose === "link-x" ? "twitter" : "email");

export function useIdentityProof({
  purposes,
  onProof,
  onError,
}: {
  /** The purposes this screen can finish; a proof started elsewhere is left alone. */
  purposes: ProofPurpose[];
  onProof: (purpose: ProofPurpose, identityToken: string) => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const { ready, authenticated, logout } = usePrivy();
  const [busy, setBusy] = useState(false);
  const finishing = useRef(false);

  const { login } = useLogin({
    onComplete: async ({ loginMethod }) => {
      const purpose = readPending();
      if (!purpose || !purposes.includes(purpose) || finishing.current) return;
      // Only the method this purpose asked for counts as its proof.
      if (loginMethod && loginMethod !== methodFor(purpose)) return;
      finishing.current = true;
      writePending(null);
      try {
        const token = await getIdentityToken();
        if (!token) throw new Error("no identity token");
        await onProof(purpose, token);
      } catch {
        onError?.("That sign-in didn't come through. Try again.");
      } finally {
        await logout().catch(() => undefined);
        finishing.current = false;
        setBusy(false);
      }
    },
    onError: (error) => {
      writePending(null);
      setBusy(false);
      // Closing the modal is a choice, not a failure.
      if (String(error) !== "exited_auth_flow") onError?.("That sign-in didn't come through. Try again.");
    },
  });

  const start = useCallback(
    async (purpose: ProofPurpose) => {
      if (!ready) return;
      setBusy(true);
      // A leftover Privy session would complete instantly as the wrong person.
      if (authenticated) await logout().catch(() => undefined);
      writePending(purpose);
      login({ loginMethods: [methodFor(purpose)] });
    },
    [ready, authenticated, logout, login],
  );

  return { ready, busy, start };
}
