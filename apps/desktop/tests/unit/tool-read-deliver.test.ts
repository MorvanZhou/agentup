import { expect, it } from "vitest";

import { deliverArtifactView } from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/delegation/tool-deliver.js";
import {
  imagesFromToolResult,
  isImageReadPath,
  looksLikeBinaryText,
  readImageNote,
} from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/files/tool-read.js";

it("turns an image tool result into a data URL and ignores text results", () => {
  const png = "iVBORw0KGgo=";
  expect(
    imagesFromToolResult({
      text: "Read image file [image/png]",
      images: [{ mimeType: "image/png", data: png }],
    }),
  ).toEqual([{ mimeType: "image/png", src: `data:image/png;base64,${png}` }]);
  expect(readImageNote({ text: "Read image file [image/png]", images: [] })).toBe(
    "Read image file [image/png]",
  );
  expect(imagesFromToolResult("export const x = 1;\n")).toEqual([]);
  expect(imagesFromToolResult({ images: [{ mimeType: "text/plain", data: "nope" }] })).toEqual([]);
  expect(isImageReadPath("WORK/dark_check.png")).toBe(true);
  expect(isImageReadPath("WORK/note.ts")).toBe(false);
  expect(looksLikeBinaryText("const x = 1;\n")).toBe(false);
  expect(looksLikeBinaryText("PNG\u0000\u0001\u0002\u0003\u0004")).toBe(true);
});

it("lists confirmed artifact paths and treats an empty confirm as nothing to deliver", () => {
  expect(
    deliverArtifactView(
      { paths: ["shot.png"] },
      "Confirmed 1 file(s):\n- ARTIFACT/shot.png",
    ),
  ).toEqual({ paths: ["ARTIFACT/shot.png"], error: "", empty: false });
  expect(deliverArtifactView({ paths: [] }, "Confirmed: deliver no ARTIFACT files for this task.")).toEqual({
    paths: [],
    error: "",
    empty: true,
  });
  expect(deliverArtifactView({ paths: ["WORK/nope.png"] }, "Error: path must be under ARTIFACT/: WORK/nope.png")).toEqual({
    paths: ["WORK/nope.png"],
    error: "path must be under ARTIFACT/: WORK/nope.png",
    empty: false,
  });
  expect(deliverArtifactView({ paths: ["a.md"] }, "")).toEqual({
    paths: ["a.md"],
    error: "",
    empty: false,
  });
  expect(deliverArtifactView({}, "")).toEqual({ paths: [], error: "", empty: false });
});
