#!/usr/bin/env node
/**
 * Windows x64 NSIS 打包（未签名）。
 * 清掉易导致 HTTPS EPROTO 的 HTTP(S)_PROXY，再交给 electron-builder。
 */
const { spawnSync } = require("node:child_process");

function unsetProxies(env) {
  for (const key of Object.keys(env)) {
    if (/^(https?|all|git_https?)_proxy$/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

async function main() {
  // 直接 pnpm pack:win 时也要有 build/npm，否则 afterPack 缺钉版 npm
  const { main: prepareBundledNpm } = require("./prepare-bundled-npm.cjs");
  await prepareBundledNpm();

  const env = unsetProxies({ ...process.env });
  const cli = require.resolve("electron-builder/cli.js");
  const result = spawnSync(process.execPath, [cli, "--win", "--x64"], {
    stdio: "inherit",
    env,
  });
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
