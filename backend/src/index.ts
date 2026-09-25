import "dotenv/config";
import { app } from "./app";
import { getConfig } from "./config";
import { migrate } from "./db/migrate";
import { heldPaymentsConfigured } from "./services/held/provider";
import { startHeldPaymentsWorker } from "./services/held/heldPayments";
import { keepAliveUrl, startKeepAlive } from "./services/keepAlive";

const config = getConfig();
await migrate();
app.listen(config.port, () => console.info(`Oink API listening on port ${config.port}.`));

// Claims and 48-hour refunds for payments to people not on Oink yet. Started here, not in
// app.ts, so tests that import the app never get a background worker.
if (heldPaymentsConfigured()) {
  startHeldPaymentsWorker();
  console.info("Held payments worker started.");
}

const pingUrl = keepAliveUrl();
if (pingUrl) {
  startKeepAlive(pingUrl);
  console.info(`Keep-alive pinging ${pingUrl} every minute.`);
}
