import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { ConfigError, defaultUserDataRoot, loadLocalConfig } from "../src/config/load.js";

it("uses local server defaults without an env file", () => {
  const config = loadLocalConfig({});
  expect(config.backendUrl).toBe("http://127.0.0.1:8787");
  expect(config.userDataRoot).toBe(defaultUserDataRoot());
  expect(config.userDataRoot).toBe(path.join(os.homedir(), ".agentup"));
});

it("lets the process environment override the defaults", () => {
  const root = path.join(os.tmpdir(), "agentup-user-data");
  const config = loadLocalConfig({
    AGENTUP_BACKEND_URL: "http://127.0.0.1:9000",
    AGENTUP_USER_DATA_ROOT: root,
  });
  expect(config.backendUrl).toBe("http://127.0.0.1:9000");
  expect(config.userDataRoot).toBe(root);
});

it("keeps the desktop listener on loopback without a model name", () => {
  const config = loadLocalConfig({});
  expect(config.host).toBe("127.0.0.1");
  expect(config.port).toBe(47391);
  expect(config.backendUrl).toBe("http://127.0.0.1:8787");
  expect(() => loadLocalConfig({ AGENTUP_RUNTIME_HOST: "0.0.0.0" })).toThrow(ConfigError);
  expect(() => loadLocalConfig({ AGENTUP_RUNTIME_PORT: "47391.5" })).toThrow(ConfigError);
});
