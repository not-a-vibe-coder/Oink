import { expect, test } from "bun:test";
import { counterparty, fromBaseUnits } from "../format";

test("base units convert exactly, with no floating point", () => {
  expect(fromBaseUnits("10000000", 6)).toBe("10");
  expect(fromBaseUnits("2500000", 6)).toBe("2.5");
  expect(fromBaseUnits("1", 6)).toBe("0.000001");
  expect(fromBaseUnits("123456789012345678901", 18)).toBe("123.456789012345678901");
  expect(fromBaseUnits("42", 0)).toBe("42");
});

test("counterparty prefers the tag, then the account ID, then the address", () => {
  expect(counterparty("izuu", "oink-k7p2-9xqm", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("@izuu");
  expect(counterparty(null, "oink-k7p2-9xqm", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("oink-k7p2-9xqm");
  expect(counterparty(null, null, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).not.toContain("@");
});
