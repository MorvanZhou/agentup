import { describe, expect, it } from "vitest";

import {
  readAgentUpReplyModel,
  replyModelDisplayName,
  replyModelFromMessages,
} from "../../src/pages/conversation/model/message/message-reply-model";

describe("readAgentUpReplyModel", () => {
  it("reads from metadata.custom", () => {
    expect(
      readAgentUpReplyModel({
        custom: {
          agentUpReplyModel: {
            templateId: "openai",
            modelId: "gpt-4o",
            vendorId: "openai",
            modelLabel: "GPT-4o",
          },
        },
      }),
    ).toEqual({
      templateId: "openai",
      modelId: "gpt-4o",
      vendorId: "openai",
      modelLabel: "GPT-4o",
    });
  });

  it("rejects incomplete payloads", () => {
    expect(readAgentUpReplyModel(null)).toBeNull();
    expect(readAgentUpReplyModel({ custom: { agentUpReplyModel: { modelId: "x" } } })).toBeNull();
  });
});

describe("replyModelDisplayName", () => {
  it("uses modelLabel only", () => {
    expect(
      replyModelDisplayName({
        templateId: "openai",
        modelId: "gpt-4o",
        vendorId: "openai",
        modelLabel: "GPT-4o",
      }),
    ).toBe("GPT-4o");
  });

  it("does not fall back to modelId", () => {
    expect(
      replyModelDisplayName({
        templateId: "openai",
        modelId: "gpt-4o",
        vendorId: "openai",
      }),
    ).toBe("");
  });
});

describe("replyModelFromMessages", () => {
  it("reads the latest assistant snapshot", () => {
    expect(
      replyModelFromMessages([
        { role: "user", metadata: {} },
        {
          role: "assistant",
          metadata: {
            custom: {
              agentUpReplyModel: {
                templateId: "anthropic",
                modelId: "claude-sonnet",
                vendorId: "anthropic",
                modelLabel: "Claude Sonnet",
              },
            },
          },
        },
      ]),
    ).toEqual({
      templateId: "anthropic",
      modelId: "claude-sonnet",
      vendorId: "anthropic",
      modelLabel: "Claude Sonnet",
    });
  });
});
