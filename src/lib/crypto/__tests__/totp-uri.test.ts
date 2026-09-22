import { expect, test } from "bun:test";
import { otpauthUri } from "../totp-uri";

test("constructs valid otpauth URI for tag and secret", () => {
  const uri = otpauthUri({ tag: "@pascal", secret: "JBSWY3DPEHPK3PXP" });
  expect(uri).toBe(
    "otpauth://totp/Oink:%40pascal?secret=JBSWY3DPEHPK3PXP&issuer=Oink&algorithm=SHA1&digits=6&period=30"
  );

  const uriWithoutAt = otpauthUri({ tag: "pascal", secret: "JBSWY3DPEHPK3PXP" });
  expect(uriWithoutAt).toBe(
    "otpauth://totp/Oink:%40pascal?secret=JBSWY3DPEHPK3PXP&issuer=Oink&algorithm=SHA1&digits=6&period=30"
  );
});
