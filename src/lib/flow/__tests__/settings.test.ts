import { expect, test } from "bun:test";
import { validateFlowSettings } from "../settings";
test("empty investment plan retains all income in cash", () => {
  expect(validateFlowSettings("1000000000", []).weights).toEqual([]);
});
test("rejects duplicate, unsupported and invalid allocation weights", () => {
  for (const weights of [[{ symbol: "SPYx", basisPoints: 9999 }], [{ symbol: "USDC", basisPoints: 10000 }], [{ symbol: "SPYx", basisPoints: 5000 }, { symbol: "SPYx", basisPoints: 5000 }], [{ symbol: "SPYx", basisPoints: 10000.1 }]]) expect(() => validateFlowSettings("0", weights)).toThrow();
  expect(validateFlowSettings("0", [{ symbol: "SPYx", basisPoints: 10000 }]).weights.length).toBe(1);
});
