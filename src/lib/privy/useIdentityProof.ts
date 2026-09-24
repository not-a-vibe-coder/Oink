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
import { getIdentityToken, useLogin, usePrivy, useUser } from "@privy-io/react-auth";
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const { refreshUser } = useUser();

  // The identity token can land a moment after login completes, so ask again a few times,
  // forcing Privy to reissue it, before concluding the dashboard setting is off.
  const fetchIdentityToken = useCallback(async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await getIdentityToken().catch(() => null);
      if (token) return token;
      await refreshUser().catch(() => undefined);
      await sleep(400 * (attempt + 1));
    }
    return null;
  }, [refreshUser]);
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
        const token = await fetchIdentityToken();
        if (!token) {
          // Privy only issues these when "Return user data in an identity token" is on in its
          // dashboard; without one there is nothing the API can verify.
          console.error("[oink:privy] signed in, but Privy returned no identity token — enable identity tokens in the Privy dashboard");
          onError?.("Sign-in worked, but Oink couldn't get proof of it from Privy. Try again shortly.");
          return;
        }
        await onProof(purpose, token);
      } catch (err) {
        // Name and message only; the token itself is never logged.
        console.error(`[oink:privy] proof failed — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
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
      if (String(error) === "exited_auth_flow") return;
      console.error(`[oink:privy] login error — ${String(error)}`);
      onError?.("That sign-in didn't come through. Try again.");
    },
  });

  const start = useCallback(
    async (purpose: ProofPurpose) => {
      if (!ready) {
        console.error("[oink:privy] not ready yet — check this site is in Privy's allowed domains");
        return;
      }
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
