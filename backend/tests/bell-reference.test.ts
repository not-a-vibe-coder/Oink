import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  BELL_REFERENCE_FEEDS,
  gatherBellReference,
  parseHermesPrice,
} from "../src/services/bell/reference";
import { getSolanaConnection } from "../src/services/txBuilder";
import { scaledMint } from "./helpers/bell-fixture";

const SCHEDULE =
  "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;1126/C,1225/C";
const OPEN = Date.parse("2026-10-13T14:00:00Z"); // Tuesday 10:00 ET
const CLOSED = Date.parse("2026-10-11T15:00:00Z"); // Sunday
const feed = BELL_REFERENCE_FEEDS.SPYx;
const mint = Keypair.generate().publicKey.toBase58();

let restores: (() => void)[] = [];
afterEach(() => {
  restores.forEach((restore) => restore());
  restores = [];
  delete process.env.PYTH_API_KEY;
});

function mockHermes(price: Record<string, unknown> | null, symbol = feed.symbol) {
  const seen: { url: string; auth: string | null }[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        if (url.includes("/v2/price_feeds"))
          return Response.json([{ id: feed.id, attributes: { symbol, schedule: SCHEDULE } }]);
        if (!price) return new Response("unauthorized", { status: 401 });
        return Response.json({ parsed: [{ id: feed.id, price }] });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  restores.push(() => mock.mockRestore());
  return seen;
}

function mockMint(data: Buffer | null, owner = TOKEN_2022_PROGRAM_ID) {
  const mock = spyOn(getSolanaConnection(), "getAccountInfo").mockResolvedValue(
    data && { data, owner, lamports: 1, executable: false, rentEpoch: 0 },
  );
  restores.push(() => mock.mockRestore());
}

const livePrice = (publishTime: number) => ({
  price: "49500000000",
  conf: "1000000",
  expo: -8,
  publish_time: publishTime,
});

describe("Bell reference evidence", () => {
  test("assembles a fresh price and the effective on-chain multiplier", async () => {
    process.env.PYTH_API_KEY = "test-key";
    const seen = mockHermes(livePrice(OPEN / 1000 - 2));
    mockMint(scaledMint(1, 1.005, BigInt(OPEN / 1000 - 10)));
    const reference = await gatherBellReference("SPYx", mint, OPEN);
    expect(reference.status).toBe("available");
    expect(reference.marketSession).toBe("regular");
    expect(reference.price?.price).toBe("49500000000");
    expect(
      Number(reference.multiplier!.numerator) / Number(reference.multiplier!.denominator),
    ).toBe(1.005);
    const priceCall = seen.find((call) => call.url.includes("/updates/price/latest"));
    expect(priceCall?.auth).toBe("Bearer test-key");
    expect(seen.find((call) => call.url.includes("/price_feeds"))?.auth).toBeNull();
  });
  test("without an API key, reports the session but no price", async () => {
    const seen = mockHermes(livePrice(OPEN / 1000));
    const reference = await gatherBellReference("SPYx", mint, OPEN);
    expect(reference).toMatchObject({
      status: "unavailable",
      marketSession: "regular",
      reason: "NOT_CONFIGURED",
    });
    expect(seen.some((call) => call.url.includes("/updates/"))).toBe(false);
  });
  test("outside the regular session no price is requested", async () => {
    process.env.PYTH_API_KEY = "test-key";
    const seen = mockHermes(livePrice(CLOSED / 1000));
    expect(await gatherBellReference("SPYx", mint, CLOSED)).toMatchObject({
      marketSession: "closed",
      reason: "MARKET_NOT_REGULAR",
    });
    expect(seen.some((call) => call.url.includes("/updates/"))).toBe(false);
  });
  test("a provider 401, metadata mismatch, or bad mint fails closed", async () => {
    process.env.PYTH_API_KEY = "bad";
    mockHermes(null);
    mockMint(scaledMint(1, 1, 0n));
    expect((await gatherBellReference("SPYx", mint, OPEN)).reason).toBe("PROVIDER_UNAVAILABLE");
    restores.forEach((restore) => restore());
    restores = [];

    mockHermes(livePrice(OPEN / 1000), "Equity.US.SPYG/USD");
    expect(await gatherBellReference("SPYx", mint, OPEN + 2 * 3600_000)).toMatchObject({
      marketSession: "unknown",
      reason: "PROVIDER_UNAVAILABLE",
    });
    restores.forEach((restore) => restore());
    restores = [];

    process.env.PYTH_API_KEY = "test-key";
    mockHermes(livePrice(OPEN / 1000));
    mockMint(scaledMint(1, 1, 0n), TOKEN_PROGRAM_ID);
    expect((await gatherBellReference("SPYx", mint, OPEN)).reason).toBe("MULTIPLIER_UNAVAILABLE");
  });
  test("price parsing rejects wrong feeds and malformed numbers", () => {
    const ok = { parsed: [{ id: feed.id, price: livePrice(1) }] };
    expect(parseHermesPrice(ok, feed.id)?.publishTime).toBe(1);
    expect(() => parseHermesPrice(ok, BELL_REFERENCE_FEEDS.AAPLx.id)).toThrow();
    for (const bad of [
      { ...livePrice(1), price: 495 },
      { ...livePrice(1), conf: "-1" },
      { ...livePrice(1), expo: 1.5 },
      { ...livePrice(1), publish_time: "1" },
    ])
      expect(() => parseHermesPrice({ parsed: [{ id: feed.id, price: bad }] }, feed.id)).toThrow();
    expect(() => parseHermesPrice({ parsed: [] }, feed.id)).toThrow();
  });
});
