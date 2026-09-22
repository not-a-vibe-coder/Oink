export type Config = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  appUrl: string;
  databaseUrl: string | undefined;
  network: string;
  rpcUrl: string;
  rpcFallbackUrl: string;
  jupiterApiUrl: string;
  jupiterPriceApiUrl: string;
  jupiterApiKey: string;
  kmsKey: string | undefined;
  decoyKey: string | undefined;
  sessionSecret: string | undefined;
  argonPepper: string | undefined;
  feePayerSecretKey: string | undefined;
  sponsorship: {
    enabled: boolean;
    maxTxPerDay: number;
    maxLamportsPerDay: bigint;
    globalLamportsPerDay: bigint;
  };
  oinkFeeBps: number;
  oinkFeeWallet: string;
  defaultSlippageBps: number;
  safeSettlePriceImpactPct: number;
};

const optional = (name: string, fallback: string): string => process.env[name] ?? fallback;

function requiredSecret(name: string): string {
  const raw = process.env[name];
  if (!raw || Buffer.from(raw, "base64").length < 32) {
    throw new Error(`${name} is missing or shorter than 32 bytes. Refusing to start.`);
  }
  return raw;
}

function requiredValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Refusing to start.`);
  return value;
}

export function getConfig(): Config {
  const nodeEnv = optional("NODE_ENV", "development") as Config["nodeEnv"];
  const isProduction = nodeEnv === "production";
  return {
    nodeEnv,
    port: Number(optional("PORT", "3001")),
    appUrl: optional("APP_URL", "http://localhost:3000"),
    databaseUrl: isProduction ? requiredValue("DATABASE_URL") : process.env.DATABASE_URL,
    network: optional("SOLANA_NETWORK", "devnet"),
    rpcUrl: optional("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    rpcFallbackUrl: optional("SOLANA_RPC_FALLBACK_URL", "https://api.devnet.solana.com"),
    jupiterApiUrl: optional("JUPITER_API_URL", "https://api.jup.ag/swap/v1"),
    jupiterPriceApiUrl: optional("JUPITER_PRICE_API_URL", "https://api.jup.ag/price/v2"),
    jupiterApiKey: optional("JUPITER_API_KEY", ""),
    kmsKey: isProduction ? requiredSecret("OINK_KMS_KEY") : process.env.OINK_KMS_KEY,
    decoyKey: isProduction ? requiredSecret("OINK_DECOY_KEY") : process.env.OINK_DECOY_KEY,
    sessionSecret: isProduction ? requiredSecret("OINK_SESSION_SECRET") : process.env.OINK_SESSION_SECRET,
    argonPepper: isProduction ? requiredSecret("OINK_ARGON_PEPPER") : process.env.OINK_ARGON_PEPPER,
    feePayerSecretKey: process.env.FEE_PAYER_SECRET_KEY,
    sponsorship: {
      enabled: optional("FEE_SPONSOR_ENABLED", "true") === "true",
      maxTxPerDay: Number(optional("FEE_SPONSOR_MAX_TX_PER_DAY", "20")),
      maxLamportsPerDay: BigInt(optional("FEE_SPONSOR_MAX_LAMPORTS_PER_DAY", "50000000")),
      globalLamportsPerDay: BigInt(optional("FEE_SPONSOR_GLOBAL_LAMPORTS_PER_DAY", "2000000000")),
    },
    oinkFeeBps: Number(optional("OINK_FEE_BPS", "0")),
    oinkFeeWallet: optional("OINK_FEE_WALLET", ""),
    defaultSlippageBps: Number(optional("DEFAULT_SLIPPAGE_BPS", "100")),
    safeSettlePriceImpactPct: Number(optional("SAFE_SETTLE_PRICE_IMPACT_PCT", "3")),
  };
}
