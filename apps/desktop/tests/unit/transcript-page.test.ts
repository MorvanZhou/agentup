import { expect, it } from "vitest";

import { mergeNewestPage } from "../../src/pages/conversation/model/thread/transcript-page.js";

it("keeps already loaded earlier messages when a newer page arrives", () => {
  const loaded = [
    { id: "old" },
    { id: "a" },
    { id: "b" },
  ];
  expect(mergeNewestPage(loaded, [{ id: "b" }, { id: "c" }])).toEqual([
    { id: "old" },
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ]);
});

it("replaces the transcript when the newest page does not overlap", () => {
  expect(mergeNewestPage([{ id: "old" }], [{ id: "fresh" }])).toEqual([{ id: "fresh" }]);
  expect(mergeNewestPage([{ id: "old" }], [])).toEqual([]);
});
