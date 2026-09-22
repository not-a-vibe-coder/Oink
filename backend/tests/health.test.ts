import { expect, test } from "bun:test";
import request from "supertest";
import { app } from "../src/app";

test("GET /health returns an operational payload", async () => {
  const response = await request(app).get("/health").expect(200);
  expect(response.body.status).toBe("ok");
  expect(response.body.network).toBe("devnet");
  expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
});
