import { ConfigError, loadLocalConfig } from "../config/load.js";
import { startLocalServer } from "./server.js";

try {
  const server = await startLocalServer(loadLocalConfig());
  console.log(`listening ${server.url}`);
} catch (error) {
  const message = error instanceof ConfigError || error instanceof Error ? error.message : "本机 runtime 没有启动";
  console.error(message);
  process.exit(1);
}
