import { exportSPKI, generateKeyPair, SignJWT } from "jose";

// Stands in for Privy: an ES256 key pair whose public half is installed as the app's
// verification key, and a minter for identity tokens shaped like Privy's.
export async function installFakePrivy(appId = "test-app") {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  process.env.PRIVY_APP_ID = appId;
  process.env.PRIVY_VERIFICATION_KEY = await exportSPKI(publicKey);

  async function mint(
    linkedAccounts: unknown[],
    overrides: { sub?: string; iss?: string; aud?: string; expSeconds?: number; key?: CryptoKey } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ linked_accounts: JSON.stringify(linkedAccounts) })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setSubject(overrides.sub ?? "did:privy:test-user")
      .setIssuer(overrides.iss ?? "privy.io")
      .setAudience(overrides.aud ?? appId)
      .setIssuedAt(now)
      .setExpirationTime(now + (overrides.expSeconds ?? 3600))
      .sign(overrides.key ?? privateKey);
  }

  const email = (address: string) => ({ type: "email", address });
  const x = (subject: string, username: string) => ({ type: "twitter_oauth", subject, username, name: username });

  return { mint, email, x };
}
