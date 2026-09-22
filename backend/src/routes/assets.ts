import { Router, type Request, type Response } from "express";
import {
  ALL_SOLANA_XSTOCKS,
  FEATURED_SOLANA_STOCKS,
  SOLANA_BASE_CURRENCIES,
  findSolanaToken,
  resolveSolanaToken,
} from "../lib/tokens";
import { fetchTokenPrices } from "../services/rpc";

export const assetsRouter = Router();

// GET /api/v1/assets
assetsRouter.get("/", async (req: Request, res: Response) => {
  const featured = req.query.featured === "true";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
  const offset = Math.max(0, parseInt((req.query.offset as string) || "0", 10));

  if (featured) {
    res.status(200).json({
      baseCurrencies: SOLANA_BASE_CURRENCIES,
      featured: FEATURED_SOLANA_STOCKS,
      count: FEATURED_SOLANA_STOCKS.length,
    });
    return;
  }

  let filtered = ALL_SOLANA_XSTOCKS;

  if (search) {
    filtered = ALL_SOLANA_XSTOCKS.filter(
      (t) =>
        t.symbol.toLowerCase().includes(search) ||
        t.name.toLowerCase().includes(search) ||
        (t.underlyingTicker && t.underlyingTicker.toLowerCase().includes(search)),
    );
  }

  const paginated = filtered.slice(offset, offset + limit);

  res.status(200).json({
    assets: paginated,
    total: filtered.length,
    limit,
    offset,
  });
});

// GET /api/v1/assets/prices?mints=...
assetsRouter.get("/prices", async (req: Request, res: Response) => {
  const mintsParam = (req.query.mints as string) || "";
  if (!mintsParam) {
    res.status(200).json({ prices: {} });
    return;
  }

  const mints = mintsParam.split(",").map((m) => m.trim()).filter(Boolean);
  try {
    const prices = await fetchTokenPrices(mints);
    res.status(200).json({ prices });
  } catch (err) {
    console.error("Fetch asset prices error:", err);
    res.status(500).json({ error: "INTERNAL", message: "Failed to fetch prices.", details: null });
  }
});

// GET /api/v1/assets/:symbolOrMint
assetsRouter.get("/:symbolOrMint", async (req: Request, res: Response) => {
  const token = resolveSolanaToken(req.params.symbolOrMint) || findSolanaToken(req.params.symbolOrMint);
  if (!token) {
    res.status(404).json({ error: "NOT_FOUND", message: "Token not found.", details: null });
    return;
  }

  let priceUsd: string | null = null;
  try {
    const prices = await fetchTokenPrices([token.mint]);
    priceUsd = prices[token.mint] || null;
  } catch {}

  res.status(200).json({
    ...token,
    priceUsd,
  });
});
