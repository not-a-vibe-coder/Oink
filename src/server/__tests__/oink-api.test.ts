import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OinkApiError, oinkFetch, oinkFetchRaw } from "../oink-api";

/**
 * Covers the two things this module exists for: forwarding the session cookie
 * to the API, and carrying its Set-Cookie back out so a server function can
 * relay it. Plus the failure paths — 4xx must surface the machine code, 5xx
 * must fall through to the secondary host.
 */

let primary: ReturnType<typeof Bun.serve>;
let fallback: ReturnType<typeof Bun.serve>;
let lastCookieSeen: string | null = null;
let primaryHits = 0;

beforeAll(() => {
  primary = Bun.serve({
    port: 0,
    fetch(request) {
      primaryHits += 1;
      const url = new URL(request.url);
      lastCookieSeen = request.headers.get("cookie");

      if (url.pathname === "/session") {
        const headers = new Headers({ "content-type": "application/json" });
        headers.append("set-cookie", "oink_session=abc; HttpOnly; Path=/");
        headers.append("set-cookie", "other=1; Path=/");
        return new Response(JSON.stringify({ tag: "pascal" }), { headers });
      }

      if (url.pathname === "/taken") {
        return Response.json(
          { error: "TAG_TAKEN", message: "That tag is already claimed.", details: null },
          { status: 409 },
        );
      }

      if (url.pathname === "/query") {
        return Response.json({ seen: url.search });
      }

      if (url.pathname === "/broken") {
        return new Response("upstream on fire", { status: 503 });
      }

      if (url.pathname === "/empty") {
        return new Response(null, { status: 204 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  fallback = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ from: "fallback" });
    },
  });

  process.env.OINK_API_URL = `http://localhost:${primary.port}`;
  process.env.OINK_API_FALLBACK_URL = `http://localhost:${fallback.port}`;
});

afterAll(() => {
  primary.stop(true);
  fallback.stop(true);
  delete process.env.OINK_API_URL;
  delete process.env.OINK_API_FALLBACK_URL;
});

describe("oinkFetchRaw", () => {
  test("forwards the caller's cookie header to the API", async () => {
    await oinkFetchRaw("/session", { cookie: "oink_session=deadbeef" });
    expect(lastCookieSeen).toBe("oink_session=deadbeef");
  });

  test("sends no cookie header when there is no session", async () => {
    lastCookieSeen = null;
    await oinkFetchRaw("/session");
    expect(lastCookieSeen).toBeNull();
  });

  test("returns every Set-Cookie value so all of them can be relayed", async () => {
    const { data, setCookies } = await oinkFetchRaw<{ tag: string }>("/session");
    expect(data.tag).toBe("pascal");
    expect(setCookies).toHaveLength(2);
    expect(setCookies[0]).toContain("oink_session=abc");
    expect(setCookies[0]).toContain("HttpOnly");
  });

  test("treats 204 as an empty body rather than a parse error", async () => {
    const { data } = await oinkFetchRaw("/empty");
    expect(data).toEqual({});
  });
});

describe("error handling", () => {
  test("surfaces the API's machine code on a 4xx", async () => {
    expect.assertions(3);
    try {
      await oinkFetch("/taken");
    } catch (err) {
      expect(err).toBeInstanceOf(OinkApiError);
      expect((err as OinkApiError).code).toBe("TAG_TAKEN");
      expect((err as OinkApiError).status).toBe(409);
    }
  });

  test("does not retry the fallback host on a 4xx", async () => {
    primaryHits = 0;
    await oinkFetch("/taken").catch(() => undefined);
    expect(primaryHits).toBe(1);
  });

  test("falls through to the fallback host on a 5xx", async () => {
    const result = await oinkFetch<{ from: string }>("/broken");
    expect(result.from).toBe("fallback");
  });

  test("reports UNREACHABLE when no host answers", async () => {
    const savedPrimary = process.env.OINK_API_URL;
    const savedFallback = process.env.OINK_API_FALLBACK_URL;
    process.env.OINK_API_URL = "http://127.0.0.1:1";
    delete process.env.OINK_API_FALLBACK_URL;

    try {
      await oinkFetch("/session");
      throw new Error("should not resolve");
    } catch (err) {
      expect(err).toBeInstanceOf(OinkApiError);
      expect((err as OinkApiError).code).toBe("UNREACHABLE");
    } finally {
      process.env.OINK_API_URL = savedPrimary;
      process.env.OINK_API_FALLBACK_URL = savedFallback;
    }
  });
});

describe("query strings", () => {
  test("drops undefined and empty values instead of sending them", async () => {
    const result = await oinkFetch<{ seen: string }>("/query", {
      query: { limit: 20, offset: 0, search: undefined, featured: "" },
    });
    expect(result.seen).toContain("limit=20");
    expect(result.seen).toContain("offset=0");
    expect(result.seen).not.toContain("search");
    expect(result.seen).not.toContain("featured");
  });
});
