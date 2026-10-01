import { expect, test } from "bun:test";
import { allocateIncome } from "../allocation";
const weights = [{ symbol: "SPYx", basisPoints: 6000 }, { symbol: "AAPLx", basisPoints: 4000 }];
test("income fills the cash shortfall before investing", () => {
  expect(allocateIncome("500000000", "800000000", "1000000000", weights)).toEqual({ paymentBase: "500000000", cashBase: "200000000", investmentBase: "300000000", purchases: [{ symbol: "SPYx", amountBase: "180000000" }, { symbol: "AAPLx", amountBase: "120000000" }] });
});
test("small payments, missing weights and rounding retain cash", () => {
  expect(allocateIncome("1", "0", "0", weights).cashBase).toBe("1");
  expect(allocateIncome("100", "0", "200", weights).purchases).toEqual([]);
  expect(allocateIncome("100", "0", "0", []).cashBase).toBe("100");
});
test("conserves every micro-USDC across variable balances", () => {
  for (let i = 0n; i < 300n; i++) {
    const result = allocateIncome(i.toString(), (i * 2n).toString(), "200", weights);
    expect(BigInt(result.cashBase) + BigInt(result.investmentBase)).toBe(i);
    expect(result.purchases.reduce((sum, p) => sum + BigInt(p.amountBase), 0n)).toBe(BigInt(result.investmentBase));
  }
});
