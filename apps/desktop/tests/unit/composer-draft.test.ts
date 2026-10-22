import { expect, it } from "vitest";

import {
  forgetComposerDraft,
  rememberComposerDraft,
  takeComposerDraft,
} from "../../src/pages/conversation/model/composer/composer-draft.js";

it("remembers and takes composer draft per agent", () => {
  rememberComposerDraft("weather", "上海天气");
  rememberComposerDraft("doctor", "咳嗽三天");
  expect(takeComposerDraft("weather")).toBe("上海天气");
  expect(takeComposerDraft("weather")).toBeUndefined();
  expect(takeComposerDraft("doctor")).toBe("咳嗽三天");
});

it("ignores empty agent id and forgets drafts", () => {
  rememberComposerDraft("", "should not store");
  expect(takeComposerDraft("")).toBeUndefined();
  rememberComposerDraft("weather", "草稿");
  forgetComposerDraft("weather");
  expect(takeComposerDraft("weather")).toBeUndefined();
});

it("can remember empty text to clear a prior draft on take", () => {
  rememberComposerDraft("weather", "旧内容");
  rememberComposerDraft("weather", "");
  expect(takeComposerDraft("weather")).toBe("");
});
