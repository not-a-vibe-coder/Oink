import "dotenv/config";
import { app } from "./app";
import { getConfig } from "./config";
import { migrate } from "./db/migrate";

const config = getConfig();
await migrate();
app.listen(config.port, () => console.info(`Oink API listening on port ${config.port}.`));
