import { expect, it } from "vitest";

import { BackendClientError } from "../src/control/errors.js";
import { isCloudAuthSkip } from "../src/control/groups-api.js";

it("skips cloud sync only on 401", () => {
  expect(isCloudAuthSkip(new BackendClientError("未登录", 401))).toBe(true);
  expect(isCloudAuthSkip(new BackendClientError("找不到群", 404))).toBe(false);
  expect(isCloudAuthSkip(new Error("network"))).toBe(false);
});
