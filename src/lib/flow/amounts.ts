const MAX_BASE = 10n ** 30n - 1n;
export function baseAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,29})$/.test(value)) throw new Error("Use a non-negative integer amount.");
  const result = BigInt(value);
  if (result > MAX_BASE) throw new Error("Amount is too large.");
  return result;
}
export function parseUsdc(value: string): string {
  if (!/^(0|[1-9]\d{0,23})(\.\d{1,6})?$/.test(value)) throw new Error("Use a USDC amount with at most six decimals.");
  const [whole, fraction = ""] = value.split(".");
  return baseAmount((BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString()).toString();
}
export function displayUsdc(value: string): string {
  const amount = baseAmount(value);
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${amount / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
