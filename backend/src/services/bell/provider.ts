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
interface BuildParams {
  wallet: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}
export async function fetchBellBuild(params: BuildParams): Promise<BellProviderBuild> {
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
  return validateBellBuild(await response.json(), params);
}
export function validateBellBuild(body: unknown, params: BuildParams): BellProviderBuild {
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
  const positiveAmount = (value: unknown) =>
    typeof value === "string" &&
    /^[1-9]\d{0,19}$/.test(value) &&
    BigInt(value) <= 18446744073709551615n;
  const validInstruction = (value: unknown): value is ApiInstruction => {
    if (!value || typeof value !== "object") return false;
    const item = value as ApiInstruction;
    return (
      typeof item.programId === "string" &&
      typeof item.data === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(item.data) &&
      Array.isArray(item.accounts) &&
      item.accounts.every(
        (a) =>
          a &&
          typeof a.pubkey === "string" &&
          typeof a.isSigner === "boolean" &&
          typeof a.isWritable === "boolean",
      )
    );
  };
  if (
    !positiveAmount(build.outAmount) ||
    !positiveAmount(build.otherAmountThreshold) ||
    (build.priceImpactPct !== undefined &&
      (typeof build.priceImpactPct !== "string" ||
        !/^-?\d{1,20}(\.\d{1,40})?$/.test(build.priceImpactPct))) ||
    !build.routePlan.every(
      (step) => step && step.swapInfo && typeof step.swapInfo.label === "string",
    ) ||
    ![
      ...build.computeBudgetInstructions,
      ...build.setupInstructions,
      build.swapInstruction,
      ...build.otherInstructions,
    ].every(validInstruction) ||
    (build.cleanupInstruction != null && !validInstruction(build.cleanupInstruction)) ||
    (build.tipInstruction != null && !validInstruction(build.tipInstruction)) ||
    !build.blockhashWithMetadata ||
    !Array.isArray(build.blockhashWithMetadata.blockhash) ||
    build.blockhashWithMetadata.blockhash.length !== 32 ||
    !build.blockhashWithMetadata.blockhash.every(
      (b) => Number.isInteger(b) && b >= 0 && b <= 255,
    ) ||
    !Number.isSafeInteger(build.blockhashWithMetadata.lastValidBlockHeight) ||
    build.blockhashWithMetadata.lastValidBlockHeight < 0 ||
    (build.addressesByLookupTableAddress != null &&
      (typeof build.addressesByLookupTableAddress !== "object" ||
        Array.isArray(build.addressesByLookupTableAddress) ||
        !Object.values(build.addressesByLookupTableAddress).every(
          (keys) => Array.isArray(keys) && keys.every((key) => typeof key === "string"),
        )))
  )
    throw new FlowError("INVALID_QUOTE", "The provider returned incomplete route evidence.", 503);
  return build;
}
