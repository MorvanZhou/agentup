#!/usr/bin/env node
/**
 * 假上游 MCP（NDJSON）：用于测 mcp-bridge 在上游退出后是否自动重拉。
 * EXIT_AFTER_TOOLS_CALL=1 时，在第一次 tools/call 响应后退出。
 */
import fs from "node:fs";
import process from "node:process";

/** @type {Buffer} */
let buf = Buffer.alloc(0);
let callCount = 0;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseMessages(buffer) {
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
      // skip
    }
  }
  return { messages, rest };
}

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  const parsed = parseMessages(buf);
  buf = parsed.rest;
  for (const message of parsed.messages) {
    if (!message || typeof message !== "object") continue;
    if (message.method === "initialize") {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-upstream", version: "0.0.0" },
        },
      });
      continue;
    }
    if (message.method === "notifications/initialized") continue;
    if (message.method === "tools/list") {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "browser_navigate",
              description: "Navigate to a URL",
              inputSchema: { type: "object", properties: { url: { type: "string" } } },
            },
          ],
        },
      });
      continue;
    }
    if (message.method === "tools/call") {
      callCount += 1;
      const name = message.params?.name;
      if (process.env.ORDER_LOG) {
        fs.appendFileSync(process.env.ORDER_LOG, `${name}\n`);
      }
      if (name === "browser_take_screenshot") {
        writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [
              {
                type: "image",
                mimeType: "image/png",
                // 可辨识的「动作前」页标记（非真实 png，仅测合并）
                data: Buffer.from(`pre-action-shot-${callCount}`).toString("base64"),
              },
            ],
          },
        });
        continue;
      }
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: `mock-ok generation=${process.env.MOCK_GENERATION || "1"} call=${callCount} tool=${name}`,
            },
          ],
        },
      });
      if (process.env.EXIT_AFTER_TOOLS_CALL === "1") {
        setTimeout(() => process.exit(0), 20);
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {},
      });
    }
  }
});
