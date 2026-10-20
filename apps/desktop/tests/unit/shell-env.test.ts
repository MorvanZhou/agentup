import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";

const {
  shouldResolveShellEnv,
  mergeShellEnv,
  parseMarkedEnv,
  resolveUserShellEnv,
  resetShellEnvCache,
} = createRequire(import.meta.url)("../../electron/shell-env.cjs") as {
  shouldResolveShellEnv: (env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform) => boolean;
  mergeShellEnv: (base: NodeJS.ProcessEnv, shell: Record<string, string>) => NodeJS.ProcessEnv;
  parseMarkedEnv: (raw: string, mark: string) => Record<string, string>;
  resolveUserShellEnv: (options?: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    execPath?: string;
    timeoutMs?: number;
    spawnFn?: (...args: unknown[]) => EventEmitter;
    logInfo?: (msg: string) => void;
    logError?: (msg: string) => void;
  }) => Promise<Record<string, string>>;
  resetShellEnvCache: () => void;
};

afterEach(() => {
  resetShellEnvCache();
});

it("skips Windows, CLI launch, and force-disable", () => {
  expect(shouldResolveShellEnv({}, "win32")).toBe(false);
  expect(shouldResolveShellEnv({ AGENTUP_CLI: "1" }, "darwin")).toBe(false);
  expect(shouldResolveShellEnv({ AGENTUP_FORCE_DISABLE_USER_ENV: "1" }, "darwin")).toBe(false);
  expect(shouldResolveShellEnv({ AGENTUP_CLI: "1", AGENTUP_FORCE_USER_ENV: "1" }, "darwin")).toBe(true);
  expect(shouldResolveShellEnv({}, "darwin")).toBe(true);
});

it("mergeShellEnv prefers shell PATH but keeps base AGENTUP_/ELECTRON_", () => {
  const merged = mergeShellEnv(
    {
      PATH: "/usr/bin",
      AGENTUP_BACKEND_URL: "http://backend",
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/old",
    },
    {
      PATH: "/Users/me/.nvm/versions/node/v22/bin:/usr/bin",
      AGENTUP_BACKEND_URL: "http://from-shell",
      ELECTRON_RUN_AS_NODE: "0",
      HOME: "/Users/me",
      NVM_DIR: "/Users/me/.nvm",
      XDG_RUNTIME_DIR: "/tmp/xdg",
    },
  );
  expect(merged.PATH).toContain(".nvm");
  expect(merged.HOME).toBe("/Users/me");
  expect(merged.NVM_DIR).toBe("/Users/me/.nvm");
  expect(merged.AGENTUP_BACKEND_URL).toBe("http://backend");
  expect(merged.ELECTRON_RUN_AS_NODE).toBe("1");
  expect(merged.XDG_RUNTIME_DIR).toBeUndefined();
});

it("parseMarkedEnv extracts JSON between marks and ignores banner noise", () => {
  const mark = "abc123def456";
  const raw = `Welcome\n${mark}${JSON.stringify({ PATH: "/opt/homebrew/bin:/bin", FOO: "bar" })}${mark}\n`;
  expect(parseMarkedEnv(raw, mark)).toEqual({ PATH: "/opt/homebrew/bin:/bin", FOO: "bar" });
  expect(parseMarkedEnv("no marks", mark)).toEqual({});
});

it("resolveUserShellEnv returns {} when skipped", async () => {
  const env = await resolveUserShellEnv({
    env: { AGENTUP_CLI: "1" },
    platform: "darwin",
  });
  expect(env).toEqual({});
});

it("resolveUserShellEnv spawns login shell once and caches", async () => {
  let spawnCount = 0;
  let capturedCommand = "";

  const spawnWithCapture = (...args: unknown[]) => {
    spawnCount += 1;
    const argv = args[1] as string[];
    capturedCommand = argv[argv.length - 1] ?? "";

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;

    queueMicrotask(() => {
      const mark = /"([a-f0-9]{12})" \+ JSON\.stringify/.exec(capturedCommand)?.[1];
      expect(mark).toBeTruthy();
      const payload = {
        PATH: "/Users/me/.nvm/versions/node/v22.23.0/bin:/usr/bin:/bin",
        NVM_DIR: "/Users/me/.nvm",
        ELECTRON_RUN_AS_NODE: "1",
        AGENTUP_RESOLVING_ENVIRONMENT: "1",
      };
      child.stdout.emit("data", Buffer.from(`${mark}${JSON.stringify(payload)}${mark}`));
      child.emit("close", 0, null);
    });
    return child;
  };

  const first = await resolveUserShellEnv({
    env: { SHELL: "/bin/zsh" },
    platform: "darwin",
    execPath: "/fake/Electron",
    spawnFn: spawnWithCapture as never,
  });
  expect(first.PATH).toContain(".nvm");
  expect(first.NVM_DIR).toBe("/Users/me/.nvm");
  expect(first.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(first.AGENTUP_RESOLVING_ENVIRONMENT).toBeUndefined();

  const second = await resolveUserShellEnv({
    env: { SHELL: "/bin/zsh" },
    platform: "darwin",
    spawnFn: spawnWithCapture as never,
  });
  expect(second).toBe(first);
  expect(spawnCount).toBe(1);
});

it("resolveUserShellEnv soft-fails on timeout", async () => {
  const spawnFn = () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    return child;
  };

  const env = await resolveUserShellEnv({
    env: { SHELL: "/bin/zsh" },
    platform: "darwin",
    timeoutMs: 30,
    spawnFn: spawnFn as never,
  });
  expect(env).toEqual({});
});
