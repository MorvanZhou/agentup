const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let logFilePath = "";
let ready = false;

function defaultLogDir() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Logs", "AgentUp");
  if (process.platform === "win32") return path.join(os.homedir(), "AppData", "Roaming", "AgentUp", "logs");
  return path.join(os.homedir(), ".config", "AgentUp", "logs");
}

function initLogger(logsDir = defaultLogDir()) {
  fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, "main.log");
  ready = true;
  append("info", `log file ${logFilePath}`);
  return logFilePath;
}

function append(level, message) {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  try {
    if (!ready) initLogger();
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch {
    // 日志失败不拖垮应用
  }
  if (level === "error") console.error(message);
  else console.log(message);
}

function logInfo(message) {
  append("info", message);
}

function logError(message) {
  append("error", message);
}

function logPath() {
  if (!ready) initLogger();
  return logFilePath;
}

module.exports = { initLogger, logInfo, logError, logPath, defaultLogDir };
