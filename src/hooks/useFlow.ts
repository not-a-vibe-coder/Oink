import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  allocateIncomeInvoice,
  createIncomeInvoice,
  getIncomeInvoices,
  getIncomePayments,
  getIncomeSettings,
  setIncomeSettings,
} from "@/lib/flow/server-fns";
import type { FlowSettings } from "@/lib/flow/types";
export function useFlowSettings() {
  return useQuery({
    queryKey: ["flow", "settings"],
    queryFn: () => getIncomeSettings(),
    retry: false,
  });
}
export function useFlowPayments() {
  return useQuery({
    queryKey: ["flow", "payments"],
    queryFn: () => getIncomePayments(),
    retry: false,
  });
}
export function useFlowInvoices() {
  return useQuery({
    queryKey: ["flow", "invoices"],
    queryFn: () => getIncomeInvoices(),
    retry: false,
  });
}
export function useSaveFlowSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: FlowSettings) => setIncomeSettings({ data }),
    onSuccess: (settings) => client.setQueryData(["flow", "settings"], settings),
  });
}
export function useCreateFlowInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (amountBase: string) => createIncomeInvoice({ data: { amountBase } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["flow", "invoices"] }),
  });
}
export function useAllocateFlowInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => allocateIncomeInvoice({ data: { id } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["flow"] }),
  });
}
