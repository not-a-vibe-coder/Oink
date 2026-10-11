import { expect, test } from "bun:test";
import { findSolanaToken, resolveSolanaToken } from "../src/lib/tokens";

test("common token aliases resolve only to their matching instruments", () => {
  const aliases = {
    APPLE: "AAPLx",
    AAPL: "AAPLx",
    TESLA: "TSLAx",
    TSLA: "TSLAx",
    NVIDIA: "NVDAx",
    NVDA: "NVDAx",
    GOOGLE: "GOOGLx",
    GOOG: "GOOGLx",
    GOOGL: "GOOGLx",
    ALPHABET: "GOOGLx",
    AMAZON: "AMZNx",
    AMZN: "AMZNx",
    MICROSOFT: "MSFTx",
    MSFT: "MSFTx",
    FACEBOOK: "METAx",
    META: "METAx",
    COINBASE: "COINx",
    COIN: "COINx",
    SP500: "SPYx",
    SPY: "SPYx",
    NASDAQ: "QQQx",
    QQQ: "QQQx",
    PALANTIR: "PLTRx",
    PLTR: "PLTRx",
    AMD: "AMDx",
    NETFLIX: "NFLXx",
    NFLX: "NFLXx",
  } as const;

  for (const [alias, symbol] of Object.entries(aliases)) {
    expect(findSolanaToken(alias)?.symbol).toBe(symbol);
  }
});

test("SpaceX never resolves to the unrelated S&P 500 ETF", () => {
  expect(findSolanaToken("SpaceX")).toBeUndefined();
  expect(resolveSolanaToken("SPCX")?.symbol).toBe("SPCXx");
  expect(resolveSolanaToken("SPY")?.symbol).toBe("SPYx");
});

test("SKR resolves only to the official Seeker mint; look-alikes never do", () => {
  const official = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
  for (const input of ["SKR", "skr", "Seeker", official])
    expect(resolveSolanaToken(input)?.mint).toBe(official);
  expect(resolveSolanaToken(official)?.decimals).toBe(6);
  // Same-symbol launches use other mints (often a "...pump" suffix); none of them resolve.
  for (const lookalike of [
    "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW4",
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgpump",
    "SKR1111111111111111111111111111111111111pump",
  ])
    expect(resolveSolanaToken(lookalike)).toBeUndefined();
  expect(findSolanaToken("SKRx")).toBeUndefined();
});
