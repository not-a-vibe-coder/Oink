import { getConfig } from "../../config";
import { FlowError } from "../flow/settings";
export interface ApiInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}
export interface BellProviderBuild {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan: { swapInfo: { label: string } }[];
  computeBudgetInstructions: ApiInstruction[];
  setupInstructions: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction: ApiInstruction | null;
  otherInstructions: ApiInstruction[];
  tipInstruction: ApiInstruction | null;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: { blockhash: number[]; lastValidBlockHeight: number };
}
export async function fetchBellBuild(params: {
  wallet: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}): Promise<BellProviderBuild> {
  const url = new URL("https://api.jup.ag/swap/v2/build");
  url.search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: params.wallet,
    slippageBps: String(params.slippageBps),
  }).toString();
  const key = getConfig().jupiterApiKey;
  const response = await fetch(url, {
    headers: key ? { "x-api-key": key } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new FlowError(
      "ROUTE_UNAVAILABLE",
      "A usable stock route is unavailable. Try again later.",
      503,
    );
  const body: unknown = await response.json();
  if (!body || typeof body !== "object")
    throw new FlowError("INVALID_QUOTE", "The provider returned an invalid route.", 503);
  const build = body as BellProviderBuild;
  if (
    build.inputMint !== params.inputMint ||
    build.outputMint !== params.outputMint ||
    build.inAmount !== params.amount ||
    build.slippageBps !== params.slippageBps ||
    build.swapMode !== "ExactIn" ||
    !Array.isArray(build.routePlan) ||
    !build.routePlan.length ||
    !build.swapInstruction ||
    !Array.isArray(build.setupInstructions) ||
    !Array.isArray(build.computeBudgetInstructions) ||
    !Array.isArray(build.otherInstructions)
  )
    throw new FlowError("INVALID_QUOTE", "The route does not match the requested purchase.", 503);
  return build;
}
