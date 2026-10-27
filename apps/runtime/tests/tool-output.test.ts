import { expect, it } from "vitest";

import { projectToolOutput, projectToolText } from "../src/session/history/tool-output.js";

it("keeps text tool results as a string", () => {
  expect(projectToolOutput("病历")).toBe("病历");
  expect(projectToolOutput({ content: [{ type: "text", text: "病历" }] })).toBe("病历");
  expect(projectToolOutput([{ type: "text", text: "ok" }])).toBe("ok");
});

it("keeps image blocks beside the note", () => {
  const png = "iVBORw0KGgo=";
  expect(
    projectToolOutput({
      content: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
    }),
  ).toEqual({
    text: "Read image file [image/png]",
    images: [{ mimeType: "image/png", data: png }],
  });
});

it("drops image bytes from error text", () => {
  expect(
    projectToolText({
      content: [
        { type: "text", text: "failed" },
        { type: "image", data: "aaaa", mimeType: "image/png" },
      ],
    }),
  ).toBe("failed");
});
