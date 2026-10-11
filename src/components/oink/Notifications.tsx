import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPushConfig } from "@/lib/push/server-fns";
import { currentPushSubscription, disablePush, enablePush, pushSupported } from "@/lib/push/device";

/** Settings switch for payday and Bell notifications on this device. */
export function Notifications() {
  const client = useQueryClient();
  const config = useQuery({
    queryKey: ["push", "config"],
    queryFn: () => getPushConfig(),
    retry: false,
  });
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSupported(pushSupported());
    void currentPushSubscription().then((subscription) => setOn(subscription !== null));
  }, []);

  if (!supported || config.isError || (config.data && !config.data.enabled)) {
    return (
      <div className="panel">
        <p className="meta">
          {config.data && !config.data.enabled
            ? "Notifications are not set up on this Oink server."
            : "This browser cannot receive notifications. Install Oink to your home screen to turn them on."}
        </p>
      </div>
    );
  }

  async function toggle() {
    setError("");
    setBusy(true);
    try {
      if (on) await disablePush();
      else await enablePush(config.data!.publicKey!);
      setOn(!on);
      await client.invalidateQueries({ queryKey: ["push", "config"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="switch-row">
        <div>
          <p className="ledger-title">Payday and Bell alerts</p>
          <p className="meta" style={{ marginTop: 4 }}>
            “Payment received” and “Bell order needs review”. Never amounts, addresses or keys.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Payday and Bell alerts"
          className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`}
          style={{ minHeight: 44, minWidth: 64 }}
          disabled={busy || config.isPending}
          onClick={() => void toggle()}
        >
          {busy ? "…" : on ? "On" : "Off"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
