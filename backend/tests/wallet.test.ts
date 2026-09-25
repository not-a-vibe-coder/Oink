import { expect, test } from "bun:test";
import express from "express";
import request from "supertest";
import { walletResponse } from "../src/routes/wallet";
import type { WalletBalances } from "../src/services/rpc";

// Every balance request 500'd in production: solLamports is a BigInt and res.json cannot
// serialise one. Calling getWalletBalances directly never showed it, so this goes through
// a real Express response.
const balances: WalletBalances = {
  accountId: "oink-test-0000",
  publicKey: "5xkaC9F8sFcdHXr8VZmdQin7zswYT47foXf4kdWPkXEa",
  solBalance: "0.042923445",
  solLamports: 42_923_445n,
  totalValueUsd: "5.02",
  solValueUsd: "5.02",
  holdings: [],
  needsSol: false,
};

test("raw balances cannot go through res.json", async () => {
  const app = express().get("/", (_req, res) => {
    try {
      res.json(balances);
    } catch {
      res.status(500).end();
    }
  });
  await request(app).get("/").expect(500);
});

test("the wallet response serialises lamports as a string", async () => {
  const app = express().get("/", (_req, res) => {
    res.json(walletResponse(balances));
  });
  const response = await request(app).get("/").expect(200);
  expect(response.body.solLamports).toBe("42923445");
  expect(response.body.totalValueUsd).toBe("5.02");
});
