import { baseAmount } from "./amounts";
import { validateFlowSettings } from "./settings";
import type { FlowAllocation, FlowWeight } from "./types";
export function allocateIncome(paymentBase: string, availableCashBase: string, cashTargetBase: string, weights: FlowWeight[]): FlowAllocation {
  const payment = baseAmount(paymentBase);
  const available = baseAmount(availableCashBase);
  const settings = validateFlowSettings(cashTargetBase, weights);
  const shortfall = BigInt(settings.cashTargetBase) > available ? BigInt(settings.cashTargetBase) - available : 0n;
  const cash = shortfall > payment ? payment : shortfall;
  const budget = payment - cash;
  const purchases = settings.weights.map(({ symbol, basisPoints }) => ({ symbol, amountBase: (budget * BigInt(basisPoints) / 10000n).toString() })).filter((purchase) => purchase.amountBase !== "0");
  const invested = purchases.reduce((sum, purchase) => sum + BigInt(purchase.amountBase), 0n);
  return { paymentBase, cashBase: (payment - invested).toString(), investmentBase: invested.toString(), purchases };
}
