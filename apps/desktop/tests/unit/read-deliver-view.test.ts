/** @vitest-environment happy-dom */
import { expect, it } from "vitest";

import DeliverArtifactList from "../../src/pages/conversation/components/agent-main/thread/assistant-ui/tools/delegation/DeliverArtifactList.vue";
import ReadImages from "../../src/pages/conversation/components/agent-main/thread/assistant-ui/tools/files/ReadImages.vue";
import { mountView } from "./mount-view.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("renders a read image and stays quiet when the image list is empty", () => {
  const full = mountView(ReadImages, {
    props: {
      images: [{ mimeType: "image/png", src: PNG }],
      note: "Read image file [image/png]",
    },
  });
  const img = full.querySelector("img");
  expect(img?.getAttribute("src")).toBe(PNG);
  expect(full.textContent).toContain("Read image file [image/png]");

  const empty = mountView(ReadImages, { props: { images: [] } });
  expect(empty.querySelector("img")).toBeNull();
});

it("renders delivered paths and an error without inventing files", () => {
  const full = mountView(DeliverArtifactList, {
    props: {
      paths: ["ARTIFACT/shot.png", "ARTIFACT/notes.md"],
      error: "",
    },
  });
  expect(full.textContent).toContain("ARTIFACT/shot.png");
  expect(full.textContent).toContain("ARTIFACT/notes.md");

  expect(full.querySelector("[role=alert]")).toBeNull();

  const missing = mountView(DeliverArtifactList, {
    props: { paths: [], error: "missing ARTIFACT file: ARTIFACT/gone.png" },
  });
  expect(missing.querySelector("[role=alert]")?.textContent).toContain(
    "Error: missing ARTIFACT file: ARTIFACT/gone.png",
  );
  expect(missing.querySelectorAll("li")).toHaveLength(0);
});
