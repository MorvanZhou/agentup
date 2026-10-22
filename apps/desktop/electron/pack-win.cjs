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

const env = unsetProxies({ ...process.env });
const cli = require.resolve("electron-builder/cli.js");
const result = spawnSync(process.execPath, [cli, "--win", "--x64"], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
