import { describe, expect, it } from "vitest";
import { ref } from "vue";

import {
  createThreadInsertCueApi,
  lastUserMessageMatchingText,
  matchesInsertCue,
  type ThreadInsertCue,
} from "../../src/pages/conversation/model/thread/thread-insert-cue";

describe("thread-insert-cue", () => {
  it("id 优先于正文匹配", () => {
    expect(
      matchesInsertCue(
        { token: 1, messageId: "m1", text: "别的" },
        { messageId: "m1", text: "实际正文" },
      ),
    ).toBe(true);
    expect(
      matchesInsertCue(
        { token: 1, messageId: "m1" },
        { messageId: "m2", text: "实际正文" },
      ),
    ).toBe(false);
  });

  it("正文匹配跳过 priorUserIds 里的旧气泡，只认插话后最新用户气泡", () => {
    const cue: ThreadInsertCue = {
      token: 2,
      text: "改成 A*",
      priorUserIds: ["old-a", "old-b"],
    };
    const threadUserIds = ["old-a", "old-b", "new-a"];
    expect(
      matchesInsertCue(cue, {
        messageId: "old-a",
        text: "改成 A*",
        threadUserIds,
      }),
    ).toBe(false);
    expect(
      matchesInsertCue(cue, {
        messageId: "new-a",
        text: "改成 A*",
        threadUserIds,
      }),
    ).toBe(true);
    // 新气泡还没进线程
    expect(
      matchesInsertCue(cue, {
        messageId: "old-a",
        text: "改成 A*",
        threadUserIds: ["old-a", "old-b"],
      }),
    ).toBe(false);
  });

  it("插话后若出现多条新用户气泡，只命中最后一条", () => {
    const cue: ThreadInsertCue = { token: 3, text: "重复", priorUserIds: ["u0"] };
    const threadUserIds = ["u0", "u1", "u2"];
    expect(matchesInsertCue(cue, { messageId: "u1", text: "重复", threadUserIds })).toBe(false);
    expect(matchesInsertCue(cue, { messageId: "u2", text: "重复", threadUserIds })).toBe(true);
  });

  it("lastUserMessageMatchingText 取同文最后一条，并可排除旧 id", () => {
    const list = [
      { id: "a", role: "user" as const, text: "你好" },
      { id: "b", role: "assistant" as const, text: "嗯" },
      { id: "c", role: "user" as const, text: "你好" },
    ];
    expect(lastUserMessageMatchingText(list, "你好", (m) => m.text)?.id).toBe("c");
    expect(lastUserMessageMatchingText(list, "没有", (m) => m.text)).toBeUndefined();
    expect(lastUserMessageMatchingText(list, "你好", (m) => m.text, ["a", "c"])).toBeUndefined();
    expect(lastUserMessageMatchingText(list, "你好", (m) => m.text, ["a"])?.id).toBe("c");
  });

  it("flashByText / flashById 递增 token，consume 只清当前次", () => {
    const cue = ref<ThreadInsertCue | null>(null);
    const api = createThreadInsertCueApi(cue);
    api.flashByText("第一句", ["u0"]);
    expect(cue.value).toEqual({ token: 1, text: "第一句", priorUserIds: ["u0"] });
    api.flashById("msg-2");
    expect(cue.value).toEqual({ token: 2, messageId: "msg-2" });
    api.consume(1);
    expect(cue.value?.token).toBe(2);
    api.consume(2);
    expect(cue.value).toBeNull();
  });
});
