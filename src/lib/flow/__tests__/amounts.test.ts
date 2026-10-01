import { expect, test } from "bun:test";
import { baseAmount, displayUsdc, parseUsdc } from "../amounts";
test("USDC retains precision beyond Number's integer range", () => {
  const value = "9007199254740993.123456";
  expect(displayUsdc(parseUsdc(value))).toBe(value);
  expect(parseUsdc("0.000001")).toBe("1");
});
test("rejects ambiguous, negative, excessive and floating-point boundaries", () => {
  for (const value of ["1e6", "-1", "01", "1.0000001", "NaN", " 1"])
    expect(() => parseUsdc(value)).toThrow();
  expect(() => baseAmount(1)).toThrow();
  expect(() => baseAmount("1".repeat(31))).toThrow();
});
