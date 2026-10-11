import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  allocateIncomeInvoice,
  createIncomeInvoice,
  getIncomeInvoices,
  getIncomePayments,
  getIncomeSettings,
  getIncomeSummary,
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
export function useFlowSummary() {
  return useQuery({
    queryKey: ["flow", "summary"],
    queryFn: () => getIncomeSummary(),
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
    onSuccess: (settings) => {
      client.setQueryData(["flow", "settings"], settings);
      void client.invalidateQueries({ queryKey: ["flow", "summary"] });
    },
  });
}
export function useCreateFlowInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (amountBase: string) => createIncomeInvoice({ data: { amountBase } }),
    onSuccess: () =>
      Promise.all(
        ["invoices", "summary"].map((key) => client.invalidateQueries({ queryKey: ["flow", key] })),
      ),
  });
}
export function useAllocateFlowInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => allocateIncomeInvoice({ data: { id } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["flow"] }),
  });
}
