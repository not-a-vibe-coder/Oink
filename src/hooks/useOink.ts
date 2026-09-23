import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  authLogout,
  cancelInvoice,
  createInvoice,
  getAsset,
  getAssets,
  getMix,
  getFeaturedAssets,
  getInvoice,
  getSession,
  getTagProfile,
  getTransferHistory,
  getWallet,
  getWalletAddress,
  listInvoices,
  listSessions,
  resolveTags,
  revokeSession,
  saveMix,
} from "@/lib/oink-server-fns";
import type { MixItem } from "@/types/token";

/**
 * Query keys are namespaced so a confirmed transfer can invalidate exactly the
 * views it changes: ['wallet'], ['activity'], ['mix', accountId].
 */
export const queryKeys = {
  session: ["session"] as const,
  wallet: ["wallet"] as const,
  walletAddress: ["wallet", "address"] as const,
  activity: (limit: number, offset: number) => ["activity", limit, offset] as const,
  mix: (accountId: string) => ["mix", accountId] as const,
  invoices: ["invoices"] as const,
  devices: ["devices"] as const,
};

// ── Session ────────────────────────────────────────────────────────────────

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => getSession(),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authLogout(),
    onSuccess: () => queryClient.clear(),
  });
}

export function useDeviceSessions() {
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: () => listSessions(),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenHashPrefix: string) => revokeSession({ data: { tokenHashPrefix } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

// ── Assets ─────────────────────────────────────────────────────────────────

export function useAssets(params: { search?: string; limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ["assets", params],
    queryFn: () => getAssets({ data: params }),
    staleTime: 60_000,
  });
}

export function useFeaturedAssets() {
  return useQuery({
    queryKey: ["assets", "featured"],
    queryFn: () => getFeaturedAssets(),
    staleTime: 5 * 60_000,
  });
}

export function useAsset(symbolOrMint: string) {
  return useQuery({
    queryKey: ["asset", symbolOrMint],
    queryFn: () => getAsset({ data: { symbolOrMint } }),
    enabled: Boolean(symbolOrMint),
  });
}

// ── Tags ───────────────────────────────────────────────────────────────────

/** Profile by tag or account ID. */
export function useTagProfile(identifier: string) {
  return useQuery({
    queryKey: ["tagProfile", identifier],
    queryFn: () => getTagProfile({ data: { identifier } }),
    enabled: Boolean(identifier),
    retry: false,
  });
}

export function useResolveTags(q: string) {
  return useQuery({
    queryKey: ["resolveTags", q],
    queryFn: () => resolveTags({ data: { q } }),
    enabled: q.length >= 2,
    staleTime: 15_000,
  });
}

// ── Wallet ─────────────────────────────────────────────────────────────────

export function useWallet(enabled = true) {
  return useQuery({
    queryKey: queryKeys.wallet,
    queryFn: () => getWallet(),
    refetchInterval: 20_000,
    enabled,
  });
}

export function useWalletAddress(enabled = true) {
  return useQuery({
    queryKey: queryKeys.walletAddress,
    queryFn: () => getWalletAddress(),
    staleTime: Infinity,
    enabled,
  });
}

// ── Mix ──────────────────────────────────────────────────────────────

export function useMix(accountId: string) {
  return useQuery({
    queryKey: queryKeys.mix(accountId),
    queryFn: () => getMix({ data: { identifier: accountId } }),
    enabled: Boolean(accountId),
  });
}

export function useSaveMix(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mix: MixItem[]) =>
      saveMix({
        data: {
          mix: mix.map((e) => ({
            symbol: e.symbol,
            mint: e.mint,
            basisPoints: e.basisPoints,
          })),
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: queryKeys.mix(accountId) });
        queryClient.invalidateQueries({ queryKey: ["tagProfile"] });
      }
    },
  });
}

// ── Activity ───────────────────────────────────────────────────────────────

export function useActivity(params: { limit?: number; offset?: number } = {}) {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  return useQuery({
    queryKey: queryKeys.activity(limit, offset),
    queryFn: () => getTransferHistory({ data: { limit, offset } }),
  });
}

// ── Invoices ───────────────────────────────────────────────────────────────

export function useInvoices() {
  return useQuery({
    queryKey: queryKeys.invoices,
    queryFn: () => listInvoices(),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => getInvoice({ data: { id } }),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      amount: string;
      tokenSymbol?: string;
      memo?: string;
      applyMix?: boolean;
      expiresInHours?: number;
    }) => createInvoice({ data: params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invoices }),
  });
}

export function useCancelInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelInvoice({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invoices }),
  });
}
