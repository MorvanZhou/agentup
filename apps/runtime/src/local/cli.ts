import { ConfigError, loadLocalConfig } from "../config/load.js";
import { startLocalServer } from "./server.js";

try {
  const server = await startLocalServer(loadLocalConfig());
  console.log(`listening ${server.url}`);

  // Desktop 退出时会 SIGTERM；未处理时部分环境下子进程会变成占端口的孤儿。
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`shutting down (${signal})`);
    try {
      await server.close();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
} catch (error) {
  const message = error instanceof ConfigError || error instanceof Error ? error.message : "本机 runtime 没有启动";
  console.error(message);
  process.exit(1);
}
