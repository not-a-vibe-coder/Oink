import { enrollStart } from "@/lib/oink-server-fns";

/**
 * enroll/start is usually the first request of a visit, so it is the one that meets a cold
 * API. The first attempt can time out at the proxy while the API is still booting, and by
 * then the boot is done — so one immediate retry turns most "refresh the page" moments
 * into a slightly longer wait. A rate limit is final; retrying it only burns the budget.
 */
export async function startEnrollmentWithRetry(): ReturnType<typeof enrollStart> {
  const first = await enrollStart();
  if (first.ok || first.code === "RATE_LIMITED") return first;
  return enrollStart();
}
