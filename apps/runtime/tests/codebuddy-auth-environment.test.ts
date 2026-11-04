import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  setAgentSdkAuthEnvironment,
  setAgentSdkState,
} from "../src/config/provider/index.js";
import { codebuddyOptionsOf } from "../src/session/external/sdk/adapters/codebuddy/options.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-codebuddy-env-"));
}

it("injects remembered CodeBuddy auth environment into query options", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.3.295" });
  setAgentSdkAuthEnvironment(root, "codebuddy-sdk", "internal");

  const options = codebuddyOptionsOf({
    prompt: "hi",
    cwd: root,
    additionalDirs: [],
    systemAppend: "",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "codebuddy-sdk",
  });

  expect(options.environment).toBe("internal");
});

it("omits environment when the user has not chosen a site yet", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.3.295" });

  const options = codebuddyOptionsOf({
    prompt: "hi",
    cwd: root,
    additionalDirs: [],
    systemAppend: "",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "codebuddy-sdk",
  });

  expect(options.environment).toBeUndefined();
});
