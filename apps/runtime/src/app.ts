import type { RuntimeConfig } from "./config/load.js";
import { HttpPackageSource } from "./control/client.js";
import { Runtime } from "./package/sync.js";

export function createRuntime(config: RuntimeConfig, token: string): Runtime {
  return new Runtime(new HttpPackageSource(config.backendUrl, token), config.userDataRoot);
}
