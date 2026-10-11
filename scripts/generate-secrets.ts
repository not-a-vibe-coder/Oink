/**
 * Generates every production secret Oink needs into a gitignored file, readable only by you.
 * It never prints a secret, so its output is safe in a terminal recording or CI log; the only
 * values printed are public (the fee payer's address, which you must fund, and the VAPID public
 * key, which browsers receive anyway).
 *
 *   bun scripts/generate-secrets.ts            # writes .secrets/oink-production.env
 *   bun scripts/generate-secrets.ts --out path # somewhere else (still refuses to overwrite)
 *
 * Paste the backend block into Render and the frontend block into Vercel, then move the file
 * into your password manager. OINK_KMS_KEY seals every user's TOTP secret: if you lose it,
 * every user is locked out of 2FA and must restore with their recovery phrase. Never rotate it
 * casually and never regenerate this file over a live deployment.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { bytesToBase58 } from "../src/lib/solana-bytes";

const outIndex = process.argv.indexOf("--out");
const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] : ".secrets/oink-production.env");
if (existsSync(out)) {
  console.error(`${out} already exists. Refusing to overwrite live secrets; choose --out.`);
  process.exit(1);
}

const secret32 = () => randomBytes(32).toString("base64");

// VAPID: P-256 key pair; web-push wants the raw public point and private scalar, base64url.
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const b64u = (value: string) => Buffer.from(value, "base64url");
const vapidPublic = Buffer.concat([Buffer.from([4]), b64u(pub.x!), b64u(pub.y!)]).toString(
  "base64url",
);
const vapidPrivate = b64u(priv.d!).toString("base64url");

const feePayer = Keypair.generate();
const proxySecret = secret32();

const body = `# Oink production secrets — generated ${new Date().toISOString()}
# KEEP OFF GIT. Store in a password manager. Losing OINK_KMS_KEY locks every user out of 2FA.

# ── Backend (Render) ──────────────────────────────────────────────────────
OINK_KMS_KEY=${secret32()}
OINK_DECOY_KEY=${secret32()}
OINK_SESSION_SECRET=${secret32()}
OINK_ARGON_PEPPER=${secret32()}
OINK_PROXY_SECRET=${proxySecret}
VAPID_PUBLIC_KEY=${vapidPublic}
VAPID_PRIVATE_KEY=${vapidPrivate}
# Fee payer (pays sponsored network fees only; fund with a small amount of SOL)
# address: ${feePayer.publicKey.toBase58()}
FEE_PAYER_SECRET_KEY=${bytesToBase58(feePayer.secretKey)}

# ── Frontend (Vercel) ─────────────────────────────────────────────────────
OINK_PROXY_SECRET=${proxySecret}
`;

mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
writeFileSync(out, body, { mode: 0o600 });
chmodSync(out, 0o600);
console.log(`Wrote ${out} (mode 600). No secret values were printed.`);
console.log(`Fee payer address to fund: ${feePayer.publicKey.toBase58()}`);
console.log(`VAPID public key: ${vapidPublic}`);
