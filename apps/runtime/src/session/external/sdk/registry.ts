import { getProviderTemplate } from "../../../config/provider-templates.js";
import {
  agentSdkDir,
  readInstalledSdk,
} from "../../../config/providers/agent-sdk/installer.js";
import { claudeCodeDriver } from "./adapters/claude-code/index.js";
import { codebuddyDriver } from "./adapters/codebuddy/index.js";
import { installedCliPath as codebuddyCliPath } from "./adapters/codebuddy/load.js";
import { codexDriver } from "./adapters/codex/index.js";
import { resolveCodexCliPath } from "./adapters/codex/load.js";
import { cursorDriver } from "./adapters/cursor/index.js";
import type { ExternalDriver, ExternalDriverId } from "./contract.js";

const DRIVERS: Record<string, ExternalDriver> = {
  codebuddy: codebuddyDriver,
  "claude-code": claudeCodeDriver,
  cursor: cursorDriver,
  codex: codexDriver,
};

export function getExternalDriver(driverId: ExternalDriverId | string): ExternalDriver {
  const driver = DRIVERS[driverId];
  if (!driver) throw new Error(`未知的外部 SDK driver：${driverId}`);
  return driver;
}

/** 模板 → driverId；未声明则报错（强制新模板带上）。 */
export function driverIdOfTemplate(templateId: string): string {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile?.driverId) throw new Error(`模板 ${templateId} 未声明 agentSdk.driverId`);
  return profile.driverId;
}

export function listExternalDriverIds(): string[] {
  return Object.keys(DRIVERS);
}

/** 安装目录内 CLI 路径；按 driver 分发（CodeBuddy 有专用字段）。 */
export function installedCliPathFor(userDataRoot: string, templateId: string): string | null {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile) return null;
  if (profile.driverId === "codebuddy") {
    return codebuddyCliPath(userDataRoot, templateId);
  }
  if (profile.driverId === "codex") {
    return resolveCodexCliPath(userDataRoot, templateId);
  }
  // 其它厂商：有 CLI 时再按 profile 扩展；默认读安装记录
  return readInstalledSdk(agentSdkDir(userDataRoot, templateId), profile.package)?.cliPath ?? null;
}
