/**
 * Seeker / Android wallets through Mobile Wallet Adapter, for wallets Oink does not hold the key
 * to: paying someone's request, or topping up the user's own Oink wallet. The Oink account
 * wallet never goes through here and remains the only Bell signer.
 *
 * MWA works only in Android Chrome (and Chrome-based PWAs/TWAs), is not SSR-safe, and Chrome
 * blocks the wallet intent unless it follows a user gesture, so: registration is lazy and
 * client-only, and connect/sign are only ever called from tap handlers.
 */
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { base64ToBytes, bytesToBase58 } from "@/lib/solana-bytes";

export const MWA_WALLET_NAME = "Mobile Wallet Adapter";

/** Android Chrome, excluding in-app WebViews (`; wv)`) and other Chromium-branded browsers. */
export function mwaSupported(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  return (
    /Android/i.test(userAgent) &&
    /Chrome\/\d+/.test(userAgent) &&
    !/; wv\)/.test(userAgent) &&
    !/(EdgA|OPR|SamsungBrowser|Firefox|FxiOS|YaBrowser|UCBrowser)\//.test(userAgent)
  );
}

let registration: Promise<void> | null = null;

export function registerMobileWallet(): Promise<void> {
  if (typeof window === "undefined" || !mwaSupported()) return Promise.resolve();
  registration ??= import("@solana-mobile/wallet-standard-mobile").then((mwa) =>
    mwa.registerMwa({
      appIdentity: {
        name: "Oink",
        uri: window.location.origin,
        icon: "/icons/icon-192.png",
      },
      authorizationCache: mwa.createDefaultAuthorizationCache(),
      chains: ["solana:mainnet", "solana:devnet"],
      chainSelector: mwa.createDefaultChainSelector(),
      onWalletNotFound: mwa.createDefaultWalletNotFoundHandler(),
    }),
  );
  return registration;
}

async function mobileWallet(): Promise<Wallet> {
  await registerMobileWallet();
  const { getWallets } = await import("@wallet-standard/app");
  const wallet = getWallets()
    .get()
    .find((candidate) => candidate.name === MWA_WALLET_NAME);
  if (!wallet) throw new Error("No mobile wallet is available in this browser.");
  return wallet;
}

type ConnectFeature = {
  "standard:connect": { connect(): Promise<{ accounts: readonly WalletAccount[] }> };
};
type SignAndSendFeature = {
  "solana:signAndSendTransaction": {
    signAndSendTransaction(
      ...inputs: { account: WalletAccount; transaction: Uint8Array; chain: string }[]
    ): Promise<readonly { signature: Uint8Array }[]>;
  };
};

export interface MobileSession {
  wallet: Wallet;
  account: WalletAccount;
}

/** Call from a tap handler. Opens the wallet app for authorization. */
export async function connectMobileWallet(): Promise<MobileSession> {
  const wallet = await mobileWallet();
  const connect = (wallet.features as Partial<ConnectFeature>)["standard:connect"];
  if (!connect) throw new Error("This wallet cannot connect.");
  const { accounts } = await connect.connect();
  const account = accounts[0] ?? wallet.accounts[0];
  if (!account) throw new Error("The wallet did not share an account.");
  return { wallet, account };
}

/** Call from a tap handler. The external wallet signs and broadcasts; returns the signature. */
export async function signAndSendWithMobileWallet(
  session: MobileSession,
  transactionBase64: string,
  chain: string,
): Promise<string> {
  const feature = (session.wallet.features as Partial<SignAndSendFeature>)[
    "solana:signAndSendTransaction"
  ];
  if (!feature) throw new Error("This wallet cannot sign and send transactions.");
  const [result] = await feature.signAndSendTransaction({
    account: session.account,
    transaction: base64ToBytes(transactionBase64),
    chain,
  });
  if (!result?.signature?.length) throw new Error("The wallet did not return a signature.");
  return bytesToBase58(result.signature);
}

/** The https link inside a Solana Pay transaction request, or null for transfer requests. */
export function transactionRequestLink(uri: string): string | null {
  if (!uri.startsWith("solana:")) return null;
  try {
    const url = new URL(decodeURIComponent(uri.slice("solana:".length)));
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
