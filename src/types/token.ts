export interface OinkToken {
  slug?: string;
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  isNative?: boolean;
  isBaseCurrency?: boolean;
  underlyingTicker?: string;
  iconUrl?: string;
  priceUsd?: string | null;
}

export interface ElectionItem {
  symbol: string;
  mint: string;
  decimals?: number;
  basisPoints: number; // 1 to 10000
  percentage?: number; // 0 to 100
}

export interface WalletHolding {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  amount: string;
  amountBase: string;
  valueUsd: string | null;
  priceUsd: string | null;
  iconUrl?: string;
  underlyingTicker?: string;
}
