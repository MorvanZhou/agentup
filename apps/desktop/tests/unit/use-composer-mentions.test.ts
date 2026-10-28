import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";

import { useComposerMentions } from "../../src/pages/conversation/composables/useComposerMentions";

const members = [
  { id: "pm", name: "产品经理", role: "产品" },
  { id: "design", name: "设计师" },
];

function keyEvent(key: string): KeyboardEvent {
  return {
    key,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    preventDefault() {},
  } as KeyboardEvent;
}

describe("useComposerMentions", () => {
  it("opens from an @ query and inserts the highlighted member", async () => {
    const composerText = ref("请 @设");
    const cursor = ref(4);
    const setText = (text: string, nextCursor?: number) => {
      composerText.value = text;
      if (typeof nextCursor === "number") cursor.value = nextCursor;
    };
    const mentions = useComposerMentions({
      members: ref(members),
      composerText,
      cursor,
      setText,
    });

    await nextTick();
    expect(mentions.open.value).toBe(true);
    expect(mentions.filtered.value.map((m) => m.id)).toEqual(["design"]);

    mentions.selectMention(mentions.filtered.value[0]!);
    // 「请 @设计师 」：行末补空格后光标落在文末
    expect(composerText.value).toBe("请 @设计师 ");
    expect(cursor.value).toBe(composerText.value.length);
    expect(mentions.open.value).toBe(false);
  });

  it("opens from the toolbar and closes on Escape", async () => {
    const composerText = ref("");
    const cursor = ref(0);
    const mentions = useComposerMentions({
      members: ref(members),
      composerText,
      cursor,
      setText: (text, nextCursor) => {
        composerText.value = text;
        if (typeof nextCursor === "number") cursor.value = nextCursor;
      },
    });

    mentions.openPicker();
    await nextTick();
    expect(mentions.open.value).toBe(true);
    expect(mentions.filtered.value).toHaveLength(2);

    expect(mentions.onPickerKeydown(keyEvent("Escape"))).toBe(true);
    expect(mentions.open.value).toBe(false);
  });

  it("stays closed when there are no members", () => {
    const mentions = useComposerMentions({
      members: ref([]),
      composerText: ref("@"),
      cursor: ref(1),
      setText: () => undefined,
    });
    mentions.openPicker();
    expect(mentions.open.value).toBe(false);
  });
});
