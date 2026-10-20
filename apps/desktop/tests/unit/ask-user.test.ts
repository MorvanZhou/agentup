import { expect, it, vi } from "vitest";

import { useAgentChat } from "../../src/pages/conversation/composables/useAgentChat.js";
import { DesktopApi } from "../../src/shared/api/runtime/index.js";
import { isAgentUpAskUser } from "../../src/shared/model/chat.js";

it("accepts valid ask_user stream payloads", () => {
  expect(
    isAgentUpAskUser({
      id: "ask-1",
      toolCallId: "call-1",
      questions: [
        {
          question: "用哪个数据库？",
          options: [{ title: "Postgres" }],
          allowMultiple: false,
        },
      ],
    }),
  ).toBe(true);
  expect(
    isAgentUpAskUser({
      id: "ask-1",
      toolCallId: "call-1",
      question: "旧单题形状",
      options: [],
      allowMultiple: false,
    }),
  ).toBe(false);
  expect(
    isAgentUpAskUser({
      id: "ask-1",
      toolCallId: "call-1",
      questions: [{ question: "无选项", options: [], allowMultiple: false }],
    }),
  ).toBe(false);
});

it("answerAsk posts to /ask-user and clears pending state", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(Response.json({ answered: true }));
  const chat = useAgentChat(new DesktopApi("http://runtime", fetchImpl));
  chat.setAskUser("weather", {
    id: "ask-weather",
    toolCallId: "call-1",
    questions: [
      {
        question: "继续吗？",
        options: [{ title: "是" }, { title: "否" }],
        allowMultiple: false,
      },
    ],
  });
  expect(chat.askUsers.value.weather?.id).toBe("ask-weather");

  await chat.answerAsk("weather", "token", {
    kind: "answers",
    items: [{ kind: "freeform", text: "继续" }],
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "http://runtime/ask-user/ask-weather",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        answer: { kind: "answers", items: [{ kind: "freeform", text: "继续" }] },
      }),
    }),
  );
  expect(chat.askUsers.value.weather).toBeUndefined();
});
