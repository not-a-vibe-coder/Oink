import { describe, expect, test } from "bun:test";
import { EMPTY_ORDER_COUNTS, nextPaydayAction, reserveProgress } from "../journey";

const base = { planConfigured: true, unallocatedPayments: 0, openInvoices: 0 };

describe("reserveProgress", () => {
  test("fills up to the target after open reservations", () => {
    expect(reserveProgress(1_000_000_000n, 1_300_000_000n, 500_000_000n)).toEqual({
      status: "available",
      targetBase: "1000000000",
      availableBase: "800000000",
      filledBase: "800000000",
      progressBps: 8000,
    });
  });
  test("caps at the target and treats a zero target as funded", () => {
    expect(reserveProgress(100n, 1_000n, 0n).progressBps).toBe(10000);
    expect(reserveProgress(0n, 0n, 0n).progressBps).toBe(10000);
  });
  test("never goes negative when reservations exceed the balance", () => {
    const reserve = reserveProgress(100n, 10n, 50n);
    expect(reserve.availableBase).toBe("0");
    expect(reserve.progressBps).toBe(0);
  });
  test("rounds down and stays exact beyond float precision", () => {
    const target = 3n * 10n ** 24n;
    expect(reserveProgress(target, 10n ** 24n, 0n).progressBps).toBe(3333);
  });
  test("fails closed without a balance", () => {
    expect(reserveProgress(100n, null, 0n)).toEqual({
      status: "unavailable",
      targetBase: "100",
      availableBase: null,
      filledBase: null,
      progressBps: null,
    });
  });
});

describe("nextPaydayAction", () => {
  test("an unresolved submission outranks everything", () => {
    expect(
      nextPaydayAction({
        ...base,
        unallocatedPayments: 2,
        orders: { ...EMPTY_ORDER_COUNTS, submitted: 1, pending: 3 },
      }),
    ).toBe("reconcile");
  });
  test("received income is allocated before orders are reviewed", () => {
    expect(
      nextPaydayAction({
        ...base,
        unallocatedPayments: 1,
        orders: { ...EMPTY_ORDER_COUNTS, deferred: 1 },
      }),
    ).toBe("allocate");
  });
  test("open, deferred or failed orders need review", () => {
    for (const state of ["pending", "deferred", "approved", "failed"] as const)
      expect(nextPaydayAction({ ...base, orders: { ...EMPTY_ORDER_COUNTS, [state]: 1 } })).toBe(
        "review_orders",
      );
  });
  test("settled orders fall through to plan, waiting and request", () => {
    const orders = { ...EMPTY_ORDER_COUNTS, confirmed: 4, cancelled: 1 };
    expect(nextPaydayAction({ ...base, planConfigured: false, orders })).toBe("set_plan");
    expect(nextPaydayAction({ ...base, openInvoices: 1, orders })).toBe("waiting");
    expect(nextPaydayAction({ ...base, orders })).toBe("request_income");
  });
});
