import { expect, test } from "bun:test";
import { canTransition, reservesCash } from "../lifecycle";
test("uncertain submissions cannot be retried or cancelled before reconciliation", () => {
  expect(canTransition("submitted", "pending")).toBe(false);
  expect(canTransition("submitted", "cancelled")).toBe(false);
  expect(reservesCash("submitted")).toBe(true);
  expect(canTransition("submitted", "confirmed")).toBe(true);
  expect(canTransition("confirmed", "pending")).toBe(false);
  expect(reservesCash("cancelled")).toBe(false);
});
