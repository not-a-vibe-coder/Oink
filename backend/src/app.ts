import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { healthRouter } from "./routes/health";
import { enrollRouter } from "./routes/enroll";
import { authRouter } from "./routes/auth";
import { tagsRouter } from "./routes/tags";
import { electionsRouter } from "./routes/elections";
import { assetsRouter } from "./routes/assets";
import { walletRouter } from "./routes/wallet";
import { transferRouter } from "./routes/transfer";
import { invoicesRouter } from "./routes/invoices";

const redactedKeys = new Set(["privatekey", "secret", "authkey", "totpcode", "ciphertext", "kdfsalt", "mnemonic", "secretphrase", "password", "totpsecret", "signature"]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactedKeys.has(key.toLowerCase()) ? "[REDACTED]" : redact(entry)]));
  }
  return value;
}

const allowedOrigins = [process.env.APP_URL, process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000"].filter((origin): origin is string => Boolean(origin));

export const app = express();

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "64kb" }));
app.use((_request, response, next) => {
  response.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use((request: Request, response: Response, next: NextFunction) => {
  const startedAt = performance.now();
  response.on("finish", () => {
    console.info(JSON.stringify({ action: "request", method: request.method, path: request.path, status: response.statusCode, durationMs: Math.round(performance.now() - startedAt) }));
  });
  if (request.method !== "GET" && request.body && Object.keys(request.body).length > 0) console.info(JSON.stringify({ action: "request_payload", path: request.path, payload: redact(request.body) }));
  next();
});

app.use("/health", healthRouter);
app.use("/api/v1/enroll", enrollRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/tags", tagsRouter);
app.use("/api/v1/elections", electionsRouter);
app.use("/api/v1/assets", assetsRouter);
app.use("/api/v1/wallet", walletRouter);
app.use("/api/v1/transfer", transferRouter);
app.use("/api/v1/invoices", invoicesRouter);

app.use((_request, response) => response.status(404).json({ error: "NOT_FOUND", message: "The requested resource does not exist.", details: null }));


