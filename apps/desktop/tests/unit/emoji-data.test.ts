import { beforeEach, describe, expect, it } from "vitest";

import {
  buildFrequentEmojis,
  DEFAULT_FREQUENT_EMOJIS,
  insertEmojiAt,
  loadRecentEmojis,
  rememberRecentEmoji,
  splitEmojiText,
} from "../../src/pages/conversation/model/emoji-data";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("insertEmojiAt", () => {
  it("inserts at cursor", () => {
    expect(insertEmojiAt("ab", 1, "😀")).toEqual({ text: "a😀b", cursor: 3 });
  });

  it("clamps cursor and appends", () => {
    expect(insertEmojiAt("hi", 99, "👍")).toEqual({ text: "hi👍", cursor: 4 });
  });

  it("handles empty text", () => {
    expect(insertEmojiAt("", 0, "😀")).toEqual({ text: "😀", cursor: "😀".length });
  });
});

describe("recent emojis", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
  });

  it("remembers newest first and dedupes", () => {
    rememberRecentEmoji("😀");
    rememberRecentEmoji("👍");
    rememberRecentEmoji("😀");
    expect(loadRecentEmojis()).toEqual(["😀", "👍"]);
  });

  it("builds frequent with recent first then defaults", () => {
    const list = buildFrequentEmojis(["🚀", "😀"]);
    expect(list[0]).toBe("🚀");
    expect(list[1]).toBe("😀");
    expect(list).toContain(DEFAULT_FREQUENT_EMOJIS[2]);
    expect(list.length).toBeLessThanOrEqual(24);
  });
});

describe("splitEmojiText", () => {
  it("keeps plain text", () => {
    expect(splitEmojiText("hello")).toEqual([{ type: "text", value: "hello" }]);
  });

  it("splits emoji from surrounding text", () => {
    expect(splitEmojiText("a😀b")).toEqual([
      { type: "text", value: "a" },
      { type: "emoji", value: "😀" },
      { type: "text", value: "b" },
    ]);
  });
});
