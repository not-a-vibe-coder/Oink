/**
 * The two ways a key gets into memory.
 *
 * `signIn` is the full credential check: it spends a challenge, proves the
 * password and a TOTP code to the server, takes a session cookie, and only then
 * decrypts. `unlockKey` is the lighter one used when a session already exists
 * and the browser just needs its key back to sign — no TOTP, because the key
 * itself is the spend authority and the session never was.
 *
 * Both end in `unlockWith`, which is the only path into key-session.ts.
 */
import { authChallenge, authUnlock } from "@/lib/oink-server-fns";
import { deriveKeys, fromBase64, openKeystore, zero } from "@/lib/wallet/credentials";
import { unlockWith } from "@/lib/wallet/key-session";

/** One message for every credential failure — see docs/02 §7. */
export const CREDENTIAL_ERROR = "That tag, password or code doesn't match.";

export interface SignInResult {
  ok: boolean;
  tag?: string;
  publicKey?: string;
  error?: string;
  retryAfterMessage?: string;
}

export async function signIn(args: {
  tag: string;
  password: string;
  totpCode: string;
  onProgress?: (progress: number) => void;
}): Promise<SignInResult> {
  const challenge = await authChallenge({ data: { tag: args.tag } });
  if (!challenge.ok) return { ok: false, error: CREDENTIAL_ERROR };

  const { challengeId, kdfSalt, kdfParams, keystore } = challenge.data;

  let encKey: Uint8Array | null = null;
  let authKey: Uint8Array | null = null;
  let entropy: Uint8Array | null = null;

  try {
    const derived = await deriveKeys(
      args.password,
      fromBase64(kdfSalt),
      kdfParams,
      args.onProgress,
    );
    encKey = derived.encKey;
    authKey = derived.authKey;

    const unlocked = await authUnlock({
      data: {
        challengeId,
        authKey: derived.authKeyBase64,
        totpCode: args.totpCode,
      },
    });

    if (!unlocked.ok) {
      return {
        ok: false,
        error: unlocked.code === "RATE_LIMITED" ? unlocked.message : CREDENTIAL_ERROR,
      };
    }

    entropy = await openKeystore({
      encKey,
      blob: keystore,
      tag: unlocked.data.tag,
      publicKey: unlocked.data.publicKey,
    });

    // The server accepted the password but the blob will not open: a decoy, a
    // tampered keystore, or a wallet whose AAD does not match. Same message.
    if (!entropy) return { ok: false, error: CREDENTIAL_ERROR };

    unlockWith(entropy);
    return { ok: true, tag: unlocked.data.tag, publicKey: unlocked.data.publicKey };
  } finally {
    zero(encKey, authKey, entropy);
  }
}

/**
 * Re-derives the in-memory key for a session that is already authenticated.
 * Returns false for a wrong password and says nothing more than that.
 */
export async function unlockKey(args: {
  tag: string;
  publicKey: string;
  password: string;
  onProgress?: (progress: number) => void;
}): Promise<boolean> {
  const challenge = await authChallenge({ data: { tag: args.tag } });
  if (!challenge.ok) return false;

  let encKey: Uint8Array | null = null;
  let authKey: Uint8Array | null = null;
  let entropy: Uint8Array | null = null;

  try {
    const derived = await deriveKeys(
      args.password,
      fromBase64(challenge.data.kdfSalt),
      challenge.data.kdfParams,
      args.onProgress,
    );
    encKey = derived.encKey;
    authKey = derived.authKey;

    entropy = await openKeystore({
      encKey,
      blob: challenge.data.keystore,
      tag: args.tag,
      publicKey: args.publicKey,
    });

    if (!entropy) return false;
    unlockWith(entropy);
    return true;
  } finally {
    zero(encKey, authKey, entropy);
  }
}
