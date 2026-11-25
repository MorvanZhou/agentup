/**
 * Playwright / Pi MCP：一行一条 JSON-RPC（NDJSON）。
 */

export function writeMessage(stream, message) {
  if (!stream || stream.destroyed) return;
  stream.write(`${JSON.stringify(message)}\n`);
}

export function parseMessages(buffer) {
  const messages = [];
  let rest = buffer;
  while (true) {
    const newline = rest.indexOf(0x0a);
    if (newline < 0) break;
    const line = rest.subarray(0, newline).toString("utf8").replace(/\r$/, "");
    rest = rest.subarray(newline + 1);
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      // skip bad line
    }
  }
  return { messages, rest };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isToolError(result) {
  if (!result || typeof result !== "object") return true;
  if (result.isError === true) return true;
  const content = result.content;
  if (!Array.isArray(content)) return false;
  const text = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return /^### Result\s*\nError:/m.test(text) || /^Error:\s*/m.test(text);
}

function extractImages(result) {
  if (!result || typeof result !== "object") return [];
  const content = result.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part) =>
      part &&
      part.type === "image" &&
      typeof part.data === "string" &&
      part.data &&
      typeof part.mimeType === "string",
  );
}

/** 把动作前截图并入工具结果，供气泡回放。 */
export function mergeScreenshot(actionResult, shotResult) {
  const images = extractImages(shotResult);
  if (images.length === 0) return actionResult;
  const base =
    actionResult && typeof actionResult === "object"
      ? { ...actionResult }
      : { content: [{ type: "text", text: String(actionResult ?? "") }] };
  const content = Array.isArray(base.content) ? [...base.content] : [];
  const withoutImages = content.filter((part) => !part || part.type !== "image");
  base.content = [...withoutImages, ...images];
  return base;
}
