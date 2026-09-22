import { describe, expect, test } from "bun:test";
import {
  formatTokenUnits,
  parseTokenUnits,
} from "../src/services/electionEngine";

describe("electionEngine", () => {
  test("parseTokenUnits converts decimal string to base atomic units", () => {
    expect(parseTokenUnits("1.5", 6)).toBe("1500000");
    expect(parseTokenUnits("0.000001", 6)).toBe("1");
    expect(parseTokenUnits("100", 9)).toBe("100000000000");
    expect(parseTokenUnits("25.12345678", 6)).toBe("25123456"); // Truncates beyond decimals
  });

  test("formatTokenUnits formats base atomic units back to decimal string", () => {
    expect(formatTokenUnits("1500000", 6)).toBe("1.5");
    expect(formatTokenUnits(1500000n, 6)).toBe("1.5");
    expect(formatTokenUnits("1", 6)).toBe("0.000001");
    expect(formatTokenUnits("100000000000", 9)).toBe("100");
    expect(formatTokenUnits("0", 6)).toBe("0");
  });

  test("BigInt integer division remainder distribution", () => {
    // 100 USDC (100,000,000 base units) split 3333, 3333, 3334 bps
    const totalBig = 100000000n;
    const legs = [
      { bps: 3333n },
      { bps: 3333n },
      { bps: 3334n }, // largest
    ];

    let allocatedSum = 0n;
    const allocated: bigint[] = [];
    let largestIdx = 2;

    for (let i = 0; i < legs.length; i++) {
      const legIn = (totalBig * legs[i].bps) / 10000n;
      allocated.push(legIn);
      allocatedSum += legIn;
    }

    const remainder = totalBig - allocatedSum;
    allocated[largestIdx] += remainder;

    // Total must equal exact input
    const sum = allocated.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(totalBig);
  });
});
