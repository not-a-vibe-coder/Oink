/**
 * Keeps the API from falling asleep on hosts that idle a service with no inbound traffic
 * (Render's free plan spins down after ~15 minutes, and the next visitor then waits 30–60s
 * for a cold start — usually on the authenticator step, the first call of a sign-up).
 *
 * It calls its own *public* URL once a minute, so the request arrives from outside the way
 * the host counts traffic. Render sets RENDER_EXTERNAL_URL itself; KEEPALIVE_URL overrides
 * it elsewhere. With neither set this does nothing, which is what local dev and tests want.
 *
 * It can only keep an awake server awake. If the instance does sleep (a deploy, a host
 * restart), the first outside request wakes it and the loop resumes with the new process.
 */
const INTERVAL_MS = 60_000;
const TIMEOUT_MS = 15_000;

export function keepAliveUrl(): string | null {
  const base = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/health`;
}

export function startKeepAlive(url: string): () => void {
  let failing = false;

  async function ping() {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      if (failing) console.info(JSON.stringify({ action: "keepalive_recovered", url }));
      failing = false;
    } catch (err) {
      // Logged once per outage, not once a minute.
      if (!failing) {
        console.warn(JSON.stringify({ action: "keepalive_failed", url, error: String(err) }));
      }
      failing = true;
    }
  }

  const timer = setInterval(() => void ping(), INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
