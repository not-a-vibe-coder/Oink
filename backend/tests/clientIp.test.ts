import { afterEach, expect, test } from "bun:test";
import type { Request } from "express";
import { getClientIp } from "../src/middleware/rateLimit";

const req = (headers: Record<string, string>, remote = "10.0.0.1") =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as Request;

afterEach(() => {
  delete process.env.OINK_PROXY_SECRET;
});

test("trusts the forwarded browser IP only with the proxy secret", () => {
  process.env.OINK_PROXY_SECRET = "s3cret";
  expect(getClientIp(req({ "x-oink-client-ip": "1.2.3.4", "x-oink-proxy-secret": "s3cret" }))).toBe("1.2.3.4");
  expect(getClientIp(req({ "x-oink-client-ip": "1.2.3.4", "x-oink-proxy-secret": "guess" }))).toBe("10.0.0.1");
  expect(getClientIp(req({ "x-oink-client-ip": "1.2.3.4" }))).toBe("10.0.0.1");
});

test("ignores the forwarded IP when no secret is configured", () => {
  expect(getClientIp(req({ "x-oink-client-ip": "1.2.3.4", "x-oink-proxy-secret": "" }))).toBe("10.0.0.1");
});

test("uses the hop the platform proxy appended, not the one the caller wrote", () => {
  expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
});
