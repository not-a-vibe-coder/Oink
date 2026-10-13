import { describe, expect, test } from "bun:test";
import { isMobileBrowser, isPaymentWallet, mwaSupported, transactionRequestLink } from "../mwa";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Seeker) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

describe("Mobile Wallet Adapter availability", () => {
  test("Android Chrome (including TWAs, which report as Chrome) is supported", () => {
    expect(mwaSupported(ANDROID_CHROME)).toBe(true);
  });
  test("WebViews, iOS, desktop and other Android browsers are not", () => {
    for (const agent of [
      ANDROID_CHROME.replace("Seeker)", "Seeker; wv)"),
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/129.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      `${ANDROID_CHROME} SamsungBrowser/25.0`,
      `${ANDROID_CHROME} EdgA/129.0`,
      "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
      "",
    ])
      expect(mwaSupported(agent)).toBe(false);
  });
});

describe("Solana Pay transaction-request links", () => {
  test("extracts the encoded https endpoint", () => {
    const link = "https://api.oink.example/api/v1/pay/oink-k7p2-9xqm?amount=5&token=USDC";
    expect(transactionRequestLink(`solana:${encodeURIComponent(link)}`)).toBe(link);
  });
  test("transfer requests and non-https links are not transaction requests", () => {
    expect(
      transactionRequestLink(
        "solana:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin?amount=5&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ),
    ).toBeNull();
    expect(
      transactionRequestLink(`solana:${encodeURIComponent("http://evil.example/x")}`),
    ).toBeNull();
    expect(transactionRequestLink("https://example.com")).toBeNull();
  });
});

describe("payment wallet detection", () => {
  const wallet = (name: string, features: string[], chains = ["solana:mainnet"]) =>
    ({
      name,
      chains,
      features: Object.fromEntries(features.map((f) => [f, {}])),
    }) as unknown as import("@wallet-standard/base").Wallet;
  test("extension wallets that can connect and sign-and-send on Solana qualify", () => {
    expect(
      isPaymentWallet(wallet("Phantom", ["standard:connect", "solana:signAndSendTransaction"])),
    ).toBe(true);
  });
  test("MWA, sign-only, and non-Solana wallets do not", () => {
    expect(
      isPaymentWallet(
        wallet("Mobile Wallet Adapter", ["standard:connect", "solana:signAndSendTransaction"]),
      ),
    ).toBe(false);
    expect(
      isPaymentWallet(wallet("SignOnly", ["standard:connect", "solana:signTransaction"])),
    ).toBe(false);
    expect(
      isPaymentWallet(
        wallet("EvmOnly", ["standard:connect", "solana:signAndSendTransaction"], ["eip155:1"]),
      ),
    ).toBe(false);
  });
  test("mobile browser detection", () => {
    expect(isMobileBrowser(ANDROID_CHROME)).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/129")).toBe(false);
  });
});
