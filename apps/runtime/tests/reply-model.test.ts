import { describe, expect, it } from "vitest";

import {
  parseReplyModelEntryData,
  replyModelFromConfig,
} from "../src/session/history/reply-model.js";
import { projectHistory } from "../src/session/history/history.js";
import { PiUIMessageProjector } from "../src/session/history/frames.js";
import { AGENTUP_REPLY_MODEL_CUSTOM_TYPE } from "../src/session/history/reply-model.js";
import type { ModelConfig } from "../src/config/load.js";

function model(partial: Partial<ModelConfig> & Pick<ModelConfig, "templateId" | "modelId">): ModelConfig {
  return {
    providerId: partial.providerId ?? partial.templateId,
    templateId: partial.templateId,
    modelId: partial.modelId,
    apiKey: partial.apiKey ?? "test",
    kind: partial.kind ?? "pi-native",
    ...(partial.baseUrl ? { baseUrl: partial.baseUrl } : {}),
  };
}

describe("replyModelFromConfig", () => {
  it("snapshots templateId / modelId / vendorId / modelLabel without secrets", () => {
    const snap = replyModelFromConfig(
      model({ templateId: "openai", modelId: "gpt-4o", providerId: "openai" }),
    );
    expect(snap).toMatchObject({
      templateId: "openai",
      modelId: "gpt-4o",
      vendorId: "openai",
      modelLabel: expect.any(String),
    });
    expect(snap.modelLabel.length).toBeGreaterThan(0);
    expect(snap).not.toHaveProperty("apiKey");
  });

  it("tolerates empty ModelConfig stubs without throwing", () => {
    expect(() => replyModelFromConfig({} as ModelConfig)).not.toThrow();
    expect(replyModelFromConfig({} as ModelConfig)).toMatchObject({
      templateId: "",
      modelId: "",
      vendorId: "",
      modelLabel: "",
    });
  });
});

describe("parseReplyModelEntryData", () => {
  it("rejects incomplete payloads", () => {
    expect(parseReplyModelEntryData(null)).toBeUndefined();
    expect(parseReplyModelEntryData({ templateId: "openai" })).toBeUndefined();
    expect(parseReplyModelEntryData({ modelId: "gpt-4o" })).toBeUndefined();
  });

  it("falls vendorId back to templateId and modelLabel to modelId", () => {
    expect(
      parseReplyModelEntryData({ templateId: "openai", modelId: "gpt-4o" }),
    ).toEqual({
      templateId: "openai",
      modelId: "gpt-4o",
      vendorId: "openai",
      modelLabel: "gpt-4o",
    });
  });
});

describe("projectHistory reply model", () => {
  it("attaches agentUpReplyModel from __agentUpReplyModel", () => {
    const messages = projectHistory([
      { role: "user", content: "hi", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "答" }],
        timestamp: 2,
        __agentUpReplyModel: {
          templateId: "anthropic",
          modelId: "claude-sonnet-4",
          vendorId: "anthropic",
        },
      },
    ]);
    expect(messages[1]?.metadata).toMatchObject({
      custom: {
        agentUpReplyModel: {
          templateId: "anthropic",
          modelId: "claude-sonnet-4",
          vendorId: "anthropic",
        },
      },
    });
  });
});

describe("PiUIMessageProjector reply model", () => {
  it("writes agentUpReplyModel into start metadata", () => {
    const projector = new PiUIMessageProjector({
      replyModel: {
        templateId: "openai",
        modelId: "gpt-4o",
        vendorId: "openai",
        modelLabel: "GPT-4o",
      },
    });
    const chunks = projector.project({
      type: "message_start",
      message: { role: "assistant" },
    } as never);
    expect(chunks).toMatchObject([
      {
        type: "start",
        messageMetadata: {
          custom: {
            agentUpCreatedAt: expect.any(String),
            agentUpReplyModel: {
              templateId: "openai",
              modelId: "gpt-4o",
              vendorId: "openai",
              modelLabel: "GPT-4o",
            },
          },
        },
      },
      { type: "start-step" },
    ]);
  });

  it("emits reply-model from custom entry when start had none", () => {
    const projector = new PiUIMessageProjector();
    projector.project({
      type: "message_start",
      message: { role: "assistant" },
    } as never);
    projector.project({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    } as never);
    const meta = projector.project({
      type: "entry_appended",
      entry: {
        type: "custom",
        customType: AGENTUP_REPLY_MODEL_CUSTOM_TYPE,
        data: {
          templateId: "cursor",
          modelId: "default",
          vendorId: "cursor",
          modelLabel: "Auto",
        },
      },
    } as never);
    expect(meta).toMatchObject([
      {
        type: "message-metadata",
        messageMetadata: {
          custom: {
            agentUpReplyModel: {
              templateId: "cursor",
              modelId: "default",
              vendorId: "cursor",
              modelLabel: "Auto",
            },
          },
        },
      },
    ]);
  });
});
