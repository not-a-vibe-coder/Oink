import { FLOW_SYMBOLS } from "../../../../src/lib/flow/settings";
import { resolveSolanaToken, USDC } from "../../lib/tokens";
import { getConfig } from "../../config";
import { FlowError } from "../flow/settings";
export function bellAsset(symbol: string) {
  if (!FLOW_SYMBOLS.some((allowed) => allowed === symbol))
    throw new FlowError("UNSUPPORTED_ASSET", "This asset is outside the Bell allowlist.");
  const token = resolveSolanaToken(symbol);
  if (!token || !Number.isInteger(token.decimals))
    throw new FlowError("UNSUPPORTED_ASSET", "This investment asset is unavailable.");
  return {
    ...token,
    issuer: "Backed / xStocks",
    instrumentUrl: "https://assets.backed.fi/legal-documentation",
  };
}
export function bellNetworkSupported(inputMint: string): boolean {
  return getConfig().network === "mainnet-beta" && inputMint === USDC.mint;
}
