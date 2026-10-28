/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";

import MentionPicker from "../../src/pages/conversation/components/chat-main/shared/thread/composer/chips/MentionPicker.vue";
import { mountView } from "./mount-view";

describe("mention picker", () => {
  it("shows the member name and role", () => {
    mountView(MentionPicker, {
      props: {
        highlight: 0,
        members: [{ id: "pm", name: "产品经理", role: "产品" }],
      },
    });
    expect(document.body.textContent).toContain("@产品经理");
    expect(document.body.textContent).toContain("产品");
  });

  it("renders a member that has no role", () => {
    mountView(MentionPicker, {
      props: {
        highlight: 0,
        members: [{ id: "design", name: "设计师" }],
      },
    });
    expect(document.body.textContent).toContain("@设计师");
  });
});
