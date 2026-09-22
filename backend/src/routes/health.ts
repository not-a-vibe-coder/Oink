import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  response.status(200).json({
    status: "ok",
    version: "0.1.0",
    network: process.env.SOLANA_NETWORK ?? "devnet",
    timestamp: new Date().toISOString(),
  });
});
