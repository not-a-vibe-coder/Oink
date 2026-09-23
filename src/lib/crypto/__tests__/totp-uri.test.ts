import { expect, test } from "bun:test";
import { otpauthUri } from "../totp-uri";

test("labels the authenticator entry with the account ID", () => {
  expect(otpauthUri({ accountId: "oink-k7p2-9xqm", secret: "JBSWY3DPEHPK3PXP" })).toBe(
    "otpauth://totp/Oink:oink-k7p2-9xqm?secret=JBSWY3DPEHPK3PXP&issuer=Oink&algorithm=SHA1&digits=6&period=30",
  );
});
