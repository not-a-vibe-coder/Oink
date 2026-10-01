import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { oinkFetch } from "@/server/oink-api";
import type { FlowAllocation, FlowInvoice, FlowPayment, FlowSettings } from "./types";
const integer = z.string().regex(/^(0|[1-9]\d{0,29})$/);
const id = z.object({ id: z.string().regex(/^flow_[A-Za-z0-9_-]{16}$/) });
const cookie = () => getRequestHeader("cookie");
export const getIncomeSettings = createServerFn({ method: "GET" }).handler(() =>
  oinkFetch<FlowSettings>("/api/v1/flow/settings", { cookie: cookie() }),
);
export const setIncomeSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      cashTargetBase: integer,
      weights: z.array(z.object({ symbol: z.string(), basisPoints: z.number().int() })).max(3),
      revision: z.number().int().nonnegative(),
    }),
  )
  .handler(({ data }) =>
    oinkFetch<FlowSettings>("/api/v1/flow/settings", {
      method: "PUT",
      cookie: cookie(),
      body: data,
    }),
  );
export const previewIncome = createServerFn({ method: "POST" })
  .inputValidator(z.object({ amountBase: integer }))
  .handler(({ data }) =>
    oinkFetch<FlowAllocation>("/api/v1/flow/preview", {
      method: "POST",
      cookie: cookie(),
      body: data,
    }),
  );
export const createIncomeInvoice = createServerFn({ method: "POST" })
  .inputValidator(z.object({ amountBase: integer }))
  .handler(({ data }) =>
    oinkFetch<FlowInvoice>("/api/v1/flow/invoices", {
      method: "POST",
      cookie: cookie(),
      body: data,
    }),
  );
export const getIncomeInvoice = createServerFn({ method: "GET" })
  .inputValidator(id)
  .handler(({ data }) => oinkFetch<FlowInvoice>(`/api/v1/flow/invoices/${data.id}`));
export const confirmIncomeInvoice = createServerFn({ method: "POST" })
  .inputValidator(id.extend({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/) }))
  .handler(({ data }) =>
    oinkFetch<{ status: "paid"; signature: string }>(`/api/v1/flow/invoices/${data.id}/confirm`, {
      method: "POST",
      body: { signature: data.signature },
    }),
  );
export const allocateIncomeInvoice = createServerFn({ method: "POST" })
  .inputValidator(id)
  .handler(({ data }) =>
    oinkFetch<FlowPayment>(`/api/v1/flow/invoices/${data.id}/allocate`, {
      method: "POST",
      cookie: cookie(),
    }),
  );
export const getIncomePayments = createServerFn({ method: "GET" }).handler(() =>
  oinkFetch<{ payments: FlowPayment[] }>("/api/v1/flow/payments", { cookie: cookie() }),
);
export const getIncomeInvoices = createServerFn({ method: "GET" }).handler(() =>
  oinkFetch<{ invoices: FlowInvoice[] }>("/api/v1/flow/invoices", { cookie: cookie() }),
);
