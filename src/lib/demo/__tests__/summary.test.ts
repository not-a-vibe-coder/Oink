import { expect, test } from "bun:test";
import { demoSummary } from "../scenario";

test("demo payday card follows the walkthrough with production rules", () => {
  expect(demoSummary("request").nextAction).toBe("waiting");
  expect(demoSummary("request").reserve.progressBps).toBe(8000);
  expect(demoSummary("received").nextAction).toBe("allocate");
  const allocated = demoSummary("allocated");
  expect(allocated.nextAction).toBe("review_orders");
  expect(allocated.reserve.filledBase).toBe("1000000000");
  expect(demoSummary("submitted").nextAction).toBe("reconcile");
  expect(demoSummary("submitted").reserve.status).toBe("unavailable");
  const completed = demoSummary("completed");
  expect(completed.orders.confirmed).toBe(1);
  expect(completed.orders.deferred).toBe(1);
  expect(completed.reserve.progressBps).toBe(10000);
});
