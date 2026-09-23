import { expect, test } from "bun:test";
import { parseRecipient } from "../src/lib/recipient";

test("tells every recipient form apart", () => {
  expect(parseRecipient("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toEqual({
    kind: "address",
    address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  });
  expect(parseRecipient(" Izuu@Gmail.com ")).toEqual({ kind: "email", email: "izuu@gmail.com" });
  expect(parseRecipient("x:@Izuu_X")).toEqual({ kind: "x", username: "Izuu_X" });
  expect(parseRecipient("x: izuu")).toEqual({ kind: "x", username: "izuu" });
  expect(parseRecipient("https://x.com/izuu")).toEqual({ kind: "x", username: "izuu" });
  expect(parseRecipient("twitter.com/@izuu/")).toEqual({ kind: "x", username: "izuu" });
  expect(parseRecipient("@pascal")).toEqual({ kind: "identifier", id: { kind: "tag", tag: "pascal" } });
  expect(parseRecipient("oink-k7p2-9xqm")).toEqual({ kind: "identifier", id: { kind: "account", accountId: "oink-k7p2-9xqm" } });
});

test("rejects what is none of them", () => {
  expect(parseRecipient("")).toBeNull();
  expect(parseRecipient("a@b")).toBeNull();
  expect(parseRecipient("x:@this_name_is_too_long_for_x")).toBeNull();
  expect(parseRecipient(42)).toBeNull();
});
