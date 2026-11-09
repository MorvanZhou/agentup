import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

import { createExternalTranslator } from "../src/session/external/events.js";

/** 取出所有 text/thinking delta，避免测试里写一堆类型窄化。 */
function deltas(events: AgentSessionEvent[], kind: "text_delta" | "thinking_delta"): string[] {
  return events.flatMap((event) =>
    event.type === "message_update" && event.assistantMessageEvent.type === kind
      ? [event.assistantMessageEvent.delta]
      : [],
  );
}

function toolStarts(events: AgentSessionEvent[]): Array<{ id: string; name: string; args: unknown }> {
  return events.flatMap((event) =>
    event.type === "tool_execution_start"
      ? [{ id: event.toolCallId, name: event.toolName, args: event.args }]
      : [],
  );
}

function toolEnds(events: AgentSessionEvent[]): Array<{ id: string; name: string; isError: boolean }> {
  return events.flatMap((event) =>
    event.type === "tool_execution_end"
      ? [{ id: event.toolCallId, name: event.toolName, isError: event.isError }]
      : [],
  );
}

it("init 消息只记元信息，不产生渲染事件", () => {
  const translator = createExternalTranslator();
  const events = translator.push({
    type: "system",
    subtype: "init",
    session_id: "s-1",
    tools: ["Read", "Bash"],
    model: "gpt-5",
  });

  expect(events).toEqual([]);
  expect(translator.sessionId).toBe("s-1");
  expect(translator.tools).toEqual(["Read", "Bash"]);
});

it("流式 text_delta 变成 message_update，并累计正文", () => {
  const translator = createExternalTranslator();
  const first = translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } },
  });
  const second = translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，世界" } },
  });

  expect(deltas([...first, ...second], "text_delta")).toEqual(["你好", "，世界"]);
  expect(translator.text).toBe("你好，世界");
});

it("thinking_delta 走推理通道，不混进正文", () => {
  const translator = createExternalTranslator();
  const events = translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先查天气" } },
  });

  expect(deltas(events, "thinking_delta")).toEqual(["先查天气"]);
  expect(deltas(events, "text_delta")).toEqual([]);
  expect(translator.text).toBe("");
});

it("工具参数流完后才发 tool_execution_start（参数已解析）", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} },
    },
  });
  translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"com' } },
  });
  translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'mand":"ls"}' } },
  });
  const events = translator.push({
    type: "stream_event",
    event: { type: "content_block_stop", index: 1 },
  });

  const starts = toolStarts(events);
  expect(starts).toEqual([{ id: "t1", name: "Bash", args: { command: "ls" } }]);
  expect(translator.toolDigest).toEqual([`Bash({"command":"ls"})`]);
});

it("DeferExecuteTool 解包为底层 mcp 名 + params；ToolSearch 不进时间线", () => {
  const translator = createExternalTranslator();
  expect(
    toolStarts(
      translator.push({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "ts",
              name: "ToolSearch",
              input: { tool_names: ["mcp__agentup__agent_search"] },
            },
          ],
        },
      }),
    ),
  ).toEqual([]);

  translator.push({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "tool_use",
        id: "t-seed",
        name: "DeferExecuteTool",
        input: { toolName: "mcp__agentup__agent_search", params: { query: "天气" } },
      },
    },
  });
  const events = translator.push({
    type: "stream_event",
    event: { type: "content_block_stop", index: 2 },
  });
  expect(toolStarts(events)).toEqual([
    {
      id: "t-seed",
      name: "mcp__agentup__agent_search",
      args: { query: "天气" },
    },
  ]);
  expect(translator.trail).toMatchObject([
    { kind: "tool", id: "t-seed", name: "mcp__agentup__agent_search", args: { query: "天气" } },
  ]);
});

it("user 消息 content 空时回落 tool_use_result", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t-empty",
          name: "Bash",
          input: { command: "echo" },
        },
      ],
    },
  });
  const events = translator.push({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t-empty", content: "" }],
    },
    tool_use_result: { tools: ["mcp__agentup__agent_search"] },
  });
  expect(toolEnds(events)).toEqual([{ id: "t-empty", name: "Bash", isError: false }]);
  const end = events.find((event) => event.type === "tool_execution_end");
  expect(end && end.type === "tool_execution_end" ? end.result : null).toEqual({
    tools: ["mcp__agentup__agent_search"],
  });
});

it("assistant 整包消息兜底发工具事件，且同一 tool_use 不重复发", () => {
  const translator = createExternalTranslator();
  const events = translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t2", name: "Write", input: { path: "a.txt" } }],
    },
  });
  const again = translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t2", name: "Write", input: { path: "a.txt" } }],
    },
  });

  expect(toolStarts(events)).toEqual([{ id: "t2", name: "Write", args: { path: "a.txt" } }]);
  expect(toolStarts(again)).toEqual([]);
});

it("user 消息里的 tool_result 变成 tool_execution_end（含 isError）", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "rm" } }],
    },
  });
  const events = translator.push({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t3", content: "permission denied", is_error: true },
      ],
    },
  });

  expect(toolEnds(events)).toEqual([{ id: "t3", name: "Bash", isError: true }]);
});

it("assistant 整包：跳过 stream 回放，仍放出工具之间的新旁白", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "先搜专家" } },
  });
  // 整包回放同一段：不重复推
  expect(
    deltas(
      translator.push({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "先搜专家" }] },
      }),
      "text_delta",
    ),
  ).toEqual([]);

  translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t-search", name: "ToolSearch", input: {} }],
    },
  });
  // 工具之后的新旁白：要推出来
  const after = translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "接下来委托 Weaty。" }],
    },
  });
  expect(deltas(after, "text_delta")).toEqual(["接下来委托 Weaty。"]);
  expect(translator.text).toContain("先搜专家");
  expect(translator.text).toContain("接下来委托 Weaty。");
});

it("工具后：stream 本段再 assistant 同段，不重复推（CodeBuddy 协作旁白）", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "先搜专家" } },
  });
  translator.push({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "先搜专家" }] },
  });
  translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t-search", name: "Bash", input: { command: "ls" } }],
    },
  });
  translator.push({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t-search", content: "ok" }],
    },
  });

  // 工具后 stream 只推「本段」；随后 assistant 整包也只有本段（不是全量累计）
  expect(
    deltas(
      translator.push({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "接下来委托 Weaty。" },
        },
      }),
      "text_delta",
    ),
  ).toEqual(["接下来委托 Weaty。"]);

  expect(
    deltas(
      translator.push({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "接下来委托 Weaty。" }],
        },
      }),
      "text_delta",
    ),
  ).toEqual([]);

  expect(translator.text).toBe("先搜专家接下来委托 Weaty。");
  const textTrail = translator.trail.filter((item) => item.kind === "text").map((item) => item.text);
  expect(textTrail.join("")).toBe("先搜专家接下来委托 Weaty。");
});

it("assistant 整包先到后 stream 同段回放，不重复推", () => {
  const translator = createExternalTranslator();
  expect(
    deltas(
      translator.push({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "已确认交给气象员 Weaty。" }],
        },
      }),
      "text_delta",
    ),
  ).toEqual(["已确认交给气象员 Weaty。"]);

  expect(
    deltas(
      translator.push({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "已确认交给气象员 Weaty。" },
        },
      }),
      "text_delta",
    ),
  ).toEqual([]);

  expect(translator.text).toBe("已确认交给气象员 Weaty。");
});

it("thinking 占 index 后，assistant 整包去掉 thinking 导致 text 下标错位，不重复推", () => {
  const translator = createExternalTranslator();
  const body =
    "Let me extract the full sound catalog (ids/names/categories) from the manifest.";
  const all: AgentSessionEvent[] = [];

  // stream：index0=thinking，index1=text，index2=tool
  all.push(
    ...translator.push({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "need catalog ids" },
      },
    }),
  );
  all.push(
    ...translator.push({
      type: "stream_event",
      event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: body } },
    }),
  );
  translator.push({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "tool_use",
        id: "toolu_read_manifest",
        name: "Read",
        input: { file_path: "ARTIFACT/sounds.json" },
      },
    },
  });
  all.push(
    ...translator.push({
      type: "stream_event",
      event: { type: "content_block_stop", index: 2 },
    }),
  );

  // assistant 终包常去掉 thinking：text 落到 index 0，tool 到 index 1
  all.push(
    ...translator.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: body },
          {
            type: "tool_use",
            id: "toolu_read_manifest",
            name: "Read",
            input: { file_path: "ARTIFACT/sounds.json" },
          },
        ],
      },
    }),
  );

  expect(deltas(all, "text_delta")).toEqual([body]);
  expect(deltas(all, "thinking_delta")).toEqual(["need catalog ids"]);
  expect(toolStarts(all)).toHaveLength(1);
  expect(translator.text).toBe(body);
  expect(translator.trail.filter((item) => item.kind === "text")).toHaveLength(1);
});

it("stream 累计快照 text_delta（每包是全文）只推增量，不叠字", () => {
  const translator = createExternalTranslator();
  const events = [
    ...translator.push({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Found" } },
    }),
    ...translator.push({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Found the brief" },
      },
    }),
    ...translator.push({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Found the brief in ARTIFACT/. Let me read it and check prior work.",
        },
      },
    }),
  ];
  expect(deltas(events, "text_delta")).toEqual([
    "Found",
    " the brief",
    " in ARTIFACT/. Let me read it and check prior work.",
  ]);
  expect(translator.text).toBe(
    "Found the brief in ARTIFACT/. Let me read it and check prior work.",
  );
});

it("同一世代：stream 文本+工具后 assistant 整包回放，正文与工具都不重复（截图根因）", () => {
  const translator = createExternalTranslator();
  const body = "Found the brief in ARTIFACT/. Let me read it and check prior work.";
  const all: AgentSessionEvent[] = [];

  all.push(
    ...translator.push({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: body } },
    }),
  );
  translator.push({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "toolu_read_1",
        name: "Read",
        input: { file_path: "ARTIFACT/brief-incredibox-like-game.md" },
      },
    },
  });
  all.push(
    ...translator.push({
      type: "stream_event",
      event: { type: "content_block_stop", index: 1 },
    }),
  );

  // 工具切开后，SDK 仍可能按 token 回放同一 text block（旧 segment 清空会误当成新旁白）
  for (const token of ["Found", " the brief", " in ARTIFACT/. Let me read it and check prior work."]) {
    all.push(
      ...translator.push({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: token } },
      }),
    );
  }

  all.push(
    ...translator.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: body },
          {
            type: "tool_use",
            id: "toolu_read_1",
            name: "Read",
            input: { file_path: "ARTIFACT/brief-incredibox-like-game.md" },
          },
        ],
      },
    }),
  );

  expect(deltas(all, "text_delta")).toEqual([body]);
  expect(toolStarts(all)).toEqual([
    {
      id: "toolu_read_1",
      name: "Read",
      args: { file_path: "ARTIFACT/brief-incredibox-like-game.md" },
    },
  ]);
  expect(translator.text).toBe(body);
  expect(translator.trail.filter((item) => item.kind === "text")).toHaveLength(1);
  expect(translator.trail.filter((item) => item.kind === "tool")).toHaveLength(1);
});

it("tool_result 后新世代旁白仍要推出（块状态按世代复位）", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "先搜专家" } },
  });
  translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "先搜专家" },
        { type: "tool_use", id: "t-search", name: "Bash", input: { command: "ls" } },
      ],
    },
  });
  translator.push({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t-search", content: "ok" }],
    },
  });

  expect(
    deltas(
      translator.push({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "接下来委托 Weaty。" },
        },
      }),
      "text_delta",
    ),
  ).toEqual(["接下来委托 Weaty。"]);
  expect(
    deltas(
      translator.push({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "接下来委托 Weaty。" }],
        },
      }),
      "text_delta",
    ),
  ).toEqual([]);
  expect(translator.text).toBe("先搜专家接下来委托 Weaty。");
});

it("completeTool 写入结果后，finishOpenTools 不再覆盖", () => {
  const translator = createExternalTranslator();
  translator.push({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "ask-1", name: "AskUserQuestion", input: {} }],
    },
  });
  const done = translator.completeTool("ask-1", "User answered:\n1. 谁来办？ → Weaty", false);
  expect(toolEnds(done)).toEqual([{ id: "ask-1", name: "AskUserQuestion", isError: false }]);
  expect(translator.finishOpenTools("占位", false)).toEqual([]);
});

it("不认识的消息不抛错、不产生事件", () => {
  const translator = createExternalTranslator();
  expect(translator.push("nonsense")).toEqual([]);
  expect(translator.push({ type: "result", subtype: "success", result: "done" })).toEqual([]);
  expect(translator.push({ type: "user", message: { role: "user", content: "插话" } })).toEqual([]);
});
