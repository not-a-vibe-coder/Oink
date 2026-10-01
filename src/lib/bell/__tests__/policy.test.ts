import { expect, test } from "bun:test";
import {
  DEFAULT_BELL_POLICY,
  displayImpactPercent,
  evaluateBellPolicy,
  validateBellPolicy,
} from "../policy";
const quote = {
  inAmount: "10000000",
  outAmount: "1000000",
  minimumOutput: "995000",
  outputDecimals: 8,
  slippageBps: 50,
  priceImpact: "0.001",
  expiresAt: new Date(2000).toISOString(),
};
test("uses exact worst-case execution price and fractional impact units", () => {
  expect(evaluateBellPolicy(quote, DEFAULT_BELL_POLICY, 1000).status).toBe("pass");
  expect(
    evaluateBellPolicy(quote, { ...DEFAULT_BELL_POLICY, maxTokenPriceBase: "1000000000" }, 1000)
      .reason,
  ).toBe("PRICE_LIMIT");
  expect(
    evaluateBellPolicy(
      { ...quote, priceImpact: "0.0200000000000000000000000001" },
      DEFAULT_BELL_POLICY,
      1000,
    ).reason,
  ).toBe("PRICE_IMPACT_LIMIT");
  expect(displayImpactPercent("0.001")).toBe("0.10%");
});
test("expired, unsafe, missing-reference and malformed quotes fail closed", () => {
  expect(evaluateBellPolicy(quote, DEFAULT_BELL_POLICY, 2000).reason).toBe("QUOTE_EXPIRED");
  expect(
    evaluateBellPolicy({ ...quote, minimumOutput: "1" }, DEFAULT_BELL_POLICY, 1000).reason,
  ).toBe("INVALID_QUOTE");
  expect(
    evaluateBellPolicy({ ...quote, priceImpact: null }, DEFAULT_BELL_POLICY, 1000).reason,
  ).toBe("PRICE_IMPACT_UNAVAILABLE");
  expect(
    evaluateBellPolicy(quote, { ...DEFAULT_BELL_POLICY, maxPremiumBps: 50 }, 1000).reason,
  ).toBe("REFERENCE_UNAVAILABLE");
  expect(() => validateBellPolicy({ ...DEFAULT_BELL_POLICY, slippageBps: 1000 })).toThrow();
});
