import { describe, expect, test } from "bun:test";
import { DEFAULT_BELL_POLICY, evaluateBellPolicy } from "../policy";
import {
  effectiveMultiplier,
  exceedsPremium,
  float64Rational,
  marketSession,
  premiumBps,
  referenceGap,
  type BellReference,
} from "../reference";

// Pyth's live schedule for Equity.US.SPY/USD, read October 11, 2026.
const SCHEDULE =
  "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C";
const at = (iso: string) => new Date(iso);

describe("market session", () => {
  test("regular, extended and closed on a normal weekday (ET, DST)", () => {
    expect(marketSession(SCHEDULE, at("2026-10-13T14:00:00Z"))).toBe("regular"); // 10:00 ET
    expect(marketSession(SCHEDULE, at("2026-10-13T13:29:00Z"))).toBe("extended"); // 09:29 ET
    expect(marketSession(SCHEDULE, at("2026-10-13T20:00:00Z"))).toBe("extended"); // 16:00 ET
    expect(marketSession(SCHEDULE, at("2026-10-14T00:00:00Z"))).toBe("closed"); // 20:00 ET
    expect(marketSession(SCHEDULE, at("2026-10-13T07:59:00Z"))).toBe("closed"); // 03:59 ET
  });
  test("weekends and holidays are closed, half days close early", () => {
    expect(marketSession(SCHEDULE, at("2026-10-11T15:00:00Z"))).toBe("closed"); // Sunday
    expect(marketSession(SCHEDULE, at("2026-11-26T15:00:00Z"))).toBe("closed"); // Thanksgiving
    expect(marketSession(SCHEDULE, at("2026-11-27T17:59:00Z"))).toBe("regular"); // 12:59 EST
    expect(marketSession(SCHEDULE, at("2026-11-27T18:00:00Z"))).toBe("extended"); // 13:00 EST
  });
  test("standard time shifts the UTC window", () => {
    expect(marketSession(SCHEDULE, at("2026-12-01T14:00:00Z"))).toBe("extended"); // 09:00 EST
    expect(marketSession(SCHEDULE, at("2026-12-01T14:30:00Z"))).toBe("regular"); // 09:30 EST
  });
  test("malformed schedules are unknown, never open", () => {
    for (const bad of [
      "",
      "America/New_York;0930-1600",
      "Mars/Base;O,O,O,O,O,O,O",
      "America/New_York;X,C,C,C,C,C,C",
    ])
      expect(marketSession(bad, at("2026-10-13T14:00:00Z"))).toBe("unknown");
  });
});

describe("scaled UI multiplier", () => {
  test("converts an f64 to its exact rational value", () => {
    expect(float64Rational(1)).toEqual({ numerator: 1n, denominator: 1n });
    expect(float64Rational(0.5)).toEqual({ numerator: 1n, denominator: 2n });
    const live = float64Rational(1.005714560286254); // SPYx on-chain, October 2026
    expect(Number(live.numerator) / Number(live.denominator)).toBe(1.005714560286254);
    expect(live.denominator & (live.denominator - 1n)).toBe(0n); // a power of two
    expect(live.numerator % 2n).toBe(1n); // fully reduced
  });
  test("switches to the new multiplier at its effective time", () => {
    const config = { multiplier: 1, newMultiplier: 2, newMultiplierEffectiveTimestamp: 100n };
    expect(effectiveMultiplier(config, 99.9)).toEqual({ numerator: "1", denominator: "1" });
    expect(effectiveMultiplier(config, 100)).toEqual({ numerator: "2", denominator: "1" });
  });
  test("rejects zero, negative, non-finite and absurd multipliers", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e-4, 1e4])
      expect(() =>
        effectiveMultiplier(
          { multiplier: bad, newMultiplier: bad, newMultiplierEffectiveTimestamp: 0n },
          1,
        ),
      ).toThrow();
  });
});

// 100 USDC buys at least 0.2 tokens (8 decimals) → 500 USDC per token.
const quotedAt = "2026-10-13T14:00:00.000Z";
const t = Date.parse(quotedAt);
const quote = {
  inAmount: "100000000",
  outAmount: "20100000",
  minimumOutput: "20000000",
  outputDecimals: 8,
  slippageBps: 50,
  priceImpact: "0",
  quotedAt,
  expiresAt: new Date(t + 30000).toISOString(),
};
function reference(over: Partial<BellReference> = {}, price = "49500000000"): BellReference {
  return {
    status: "available",
    marketSession: "regular",
    price: { price, conf: "0", expo: -8, publishTime: t / 1000 - 5 },
    multiplier: { numerator: "1", denominator: "1" },
    ...over,
  };
}

describe("premium math", () => {
  test("premium against the reference is exact", () => {
    // 500 paid vs 495 reference = +101.01… bps, floored.
    expect(premiumBps(quote, reference())).toBe(101n);
    expect(exceedsPremium(quote, reference(), 101)).toBe(true);
    expect(exceedsPremium(quote, reference(), 102)).toBe(false);
    expect(premiumBps(quote, reference({}, "50500000000"))).toBe(-100n);
  });
  test("the multiplier changes shares per token, not 1:1", () => {
    // Each token is 1.01 shares: 500 / 1.01 = 495.0495… per share, +1.0001 bps over 495.
    const scaled = reference({ multiplier: { numerator: "101", denominator: "100" } });
    expect(premiumBps(quote, scaled)).toBe(1n);
    expect(exceedsPremium(quote, scaled, 1)).toBe(true);
    expect(exceedsPremium(quote, scaled, 2)).toBe(false);
    expect(exceedsPremium(quote, reference(), 2)).toBe(true); // 1:1 would read +101 bps
  });
  test("confidence widens the check against the user", () => {
    const wide = reference({
      price: { price: "50000000000", conf: "250000000", expo: -8, publishTime: t / 1000 },
    });
    // Mid 500 → 0 bps, but lower bound 497.5 → 50.25 bps.
    expect(premiumBps(quote, wide)).toBe(0n);
    expect(exceedsPremium(quote, wide, 50)).toBe(true);
    expect(exceedsPremium(quote, wide, 51)).toBe(false);
  });
  test("positive exponents scale correctly", () => {
    const coarse = reference({
      price: { price: "495", conf: "0", expo: 0, publishTime: t / 1000 },
    });
    expect(premiumBps(quote, coarse)).toBe(101n);
  });
});

describe("reference gaps fail closed", () => {
  test("usable evidence has no gap", () => {
    expect(referenceGap(reference(), t)).toBeNull();
  });
  test("missing, out-of-session, stale, future, low-confidence and corrupt evidence", () => {
    expect(referenceGap(undefined, t)).toBe("PROVIDER_UNAVAILABLE");
    expect(
      referenceGap({ status: "unavailable", marketSession: "closed", reason: "NOT_CONFIGURED" }, t),
    ).toBe("NOT_CONFIGURED");
    expect(referenceGap(reference({ marketSession: "extended" }), t)).toBe("MARKET_NOT_REGULAR");
    const priced = (p: Partial<NonNullable<BellReference["price"]>>) =>
      reference({
        price: { price: "49500000000", conf: "0", expo: -8, publishTime: t / 1000, ...p },
      });
    expect(referenceGap(priced({ publishTime: t / 1000 - 61 }), t)).toBe("STALE");
    expect(referenceGap(priced({ publishTime: t / 1000 + 6 }), t)).toBe("STALE");
    expect(referenceGap(priced({ conf: "1000000000" }), t)).toBe("LOW_CONFIDENCE");
    expect(referenceGap(priced({ price: "0" }), t)).toBe("PROVIDER_UNAVAILABLE");
    expect(referenceGap(priced({ price: "1.5" }), t)).toBe("PROVIDER_UNAVAILABLE");
    expect(referenceGap(reference({ multiplier: { numerator: "0", denominator: "1" } }), t)).toBe(
      "MULTIPLIER_UNAVAILABLE",
    );
    expect(referenceGap(reference({ multiplier: undefined }), t)).toBe("PROVIDER_UNAVAILABLE");
    expect(referenceGap(reference(), Number.NaN)).toBe("STALE");
  });
});

describe("policy premium cap", () => {
  const policy = { ...DEFAULT_BELL_POLICY, maxPriceImpactBps: null };
  const now = t + 1000;
  test("passes, defers or stays unavailable", () => {
    const withRef = { ...quote, reference: reference() };
    expect(evaluateBellPolicy(withRef, { ...policy, maxPremiumBps: 150 }, now).status).toBe("pass");
    expect(evaluateBellPolicy(withRef, { ...policy, maxPremiumBps: 50 }, now).reason).toBe(
      "PREMIUM_LIMIT",
    );
    expect(evaluateBellPolicy(quote, { ...policy, maxPremiumBps: 150 }, now).reason).toBe(
      "REFERENCE_UNAVAILABLE",
    );
    expect(
      evaluateBellPolicy(
        { ...withRef, quotedAt: undefined },
        { ...policy, maxPremiumBps: 150 },
        now,
      ).reason,
    ).toBe("REFERENCE_UNAVAILABLE");
  });
  test("without a cap, missing reference data changes nothing", () => {
    expect(evaluateBellPolicy(quote, policy, now).status).toBe("pass");
  });
});
