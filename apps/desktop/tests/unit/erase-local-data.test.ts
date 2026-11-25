import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

const {
  collectErasePaths,
  dataRootMarkerPath,
  eraseLocalDataPaths,
  resolveAgentDataRoot,
  writeDataRootMarker,
} = createRequire(import.meta.url)("../../electron/erase-local-data.cjs") as {
  collectErasePaths(input: {
    agentDataRoot: string;
    userDataPath: string;
    logsPath?: string;
  }): string[];
  dataRootMarkerPath(userDataPath: string): string;
  eraseLocalDataPaths(input: {
    paths: string[];
    rm?: (target: string, opts: { recursive: boolean; force: boolean }) => Promise<void>;
    logInfo?: (msg: string) => void;
    logError?: (msg: string) => void;
  }): Promise<void>;
  resolveAgentDataRoot(options?: { env?: NodeJS.ProcessEnv; homedir?: string }): string;
  writeDataRootMarker(input: {
    userDataPath: string;
    agentDataRoot: string;
    writeFile?: (file: string, data: string, encoding: string) => Promise<void>;
    mkdir?: (dir: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  }): Promise<void>;
};

// Win 上 path.resolve("/Users/demo") 会带盘符；期望值统一用 resolve，避免 join 与 resolve 不一致
const demoHome = path.resolve("/Users/demo");

it("默认业务根为 ~/.agentup", () => {
  expect(resolveAgentDataRoot({ env: {}, homedir: demoHome })).toBe(path.join(demoHome, ".agentup"));
});

it("AGENTUP_USER_DATA_ROOT 指向真实业务根", () => {
  const absData = path.resolve("/var/agentup-data");
  expect(
    resolveAgentDataRoot({
      env: { AGENTUP_USER_DATA_ROOT: absData },
      homedir: demoHome,
    }),
  ).toBe(absData);
  expect(
    resolveAgentDataRoot({
      env: { AGENTUP_USER_DATA_ROOT: "rel-data" },
      homedir: demoHome,
    }),
  ).toBe(path.resolve(demoHome, "rel-data"));
});

it("收集删除路径并合并子目录", () => {
  const agentRoot = path.join(demoHome, ".agentup");
  const userData = path.join(demoHome, "Library", "Application Support", "AgentUp");
  const logs = path.join(userData, "logs");
  expect(
    collectErasePaths({
      agentDataRoot: agentRoot,
      userDataPath: userData,
      logsPath: logs,
    }),
  ).toEqual([path.resolve(agentRoot), path.resolve(userData)]);

  const macLogs = path.join(demoHome, "Library", "Logs", "AgentUp");
  expect(
    collectErasePaths({
      agentDataRoot: agentRoot,
      userDataPath: userData,
      logsPath: macLogs,
    }),
  ).toEqual([path.resolve(agentRoot), path.resolve(userData), path.resolve(macLogs)]);
});

it("按序删除路径", async () => {
  const removed: string[] = [];
  await eraseLocalDataPaths({
    paths: ["/tmp/a", "/tmp/b"],
    rm: async (target) => {
      removed.push(target);
    },
  });
  expect(removed).toEqual(["/tmp/a", "/tmp/b"]);
});

it("写入 data-root 标记供卸载读取", async () => {
  const writes: Array<{ file: string; data: string }> = [];
  const mkdirs: string[] = [];
  await writeDataRootMarker({
    userDataPath: "/app-data",
    agentDataRoot: "/custom/root",
    mkdir: async (dir) => {
      mkdirs.push(dir);
      return dir;
    },
    writeFile: async (file, data) => {
      writes.push({ file, data });
    },
  });
  expect(mkdirs).toEqual(["/app-data"]);
  expect(writes).toEqual([{ file: dataRootMarkerPath("/app-data"), data: "/custom/root" }]);
});
