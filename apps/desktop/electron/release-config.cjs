/** 解析当前环境配置；构建后改域名只需改 env-profiles.cjs 再打一次包。 */
const profiles = require("./env-profiles.cjs");

function resolveEnvName() {
  const fromEnv = process.env.AGENTUP_DESKTOP_ENV?.trim();
  if (fromEnv) return fromEnv;
  try {
    // build-mac 写入并打进 asar；打完后本机文件会删掉，避免污染日常 start
    return require("./release-target.generated.cjs");
  } catch {
    return "dev";
  }
}

const env = resolveEnvName();
const profile = profiles[env];
if (!profile) {
  throw new Error(
    `未知 AGENTUP_DESKTOP_ENV="${env}"（可选: ${Object.keys(profiles).join(", ")}）`,
  );
}

module.exports = {
  env,
  backendUrl: profile.backendUrl,
  webUrl: profile.webUrl,
};
