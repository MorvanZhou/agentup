import { expect, it } from "vitest";

import { shellHangDecideView } from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/shell/shell-hang-decide-view.js";

it("reads hang_id and action from args while result is pending", () => {
  const view = shellHangDecideView(
    { hang_id: "hang-1", action: "kill" },
    "",
    false,
  );
  expect(view).toEqual({
    hangId: "hang-1",
    action: "kill",
    outcome: "pending",
    resultText: "",
  });
});

it("maps kill / bg result text to outcomes", () => {
  expect(
    shellHangDecideView(
      { hang_id: "h", action: "kill" },
      "Stopped hung shell process.\nOutput tail:\nok",
      true,
    ).outcome,
  ).toBe("kill");
  expect(
    shellHangDecideView(
      { hang_id: "h", action: "bg" },
      "Left process running in the background (pid 42).",
      true,
    ).outcome,
  ).toBe("bg");
});

it("maps wait result variants", () => {
  expect(
    shellHangDecideView(
      { hang_id: "h", action: "wait" },
      "Process exited with code 0.\nok",
      true,
    ).outcome,
  ).toBe("wait_exited");
  expect(
    shellHangDecideView(
      { hang_id: "h", action: "wait" },
      "[shell_hang] Process still running after idle.\nhang_id: h",
      true,
    ).outcome,
  ).toBe("wait_idle");
  expect(
    shellHangDecideView(
      { hang_id: "h", action: "wait" },
      "Wait aborted.\n(no output)",
      true,
    ).outcome,
  ).toBe("wait_aborted");
});

it("treats Error results as error even when action is present", () => {
  const view = shellHangDecideView(
    { hang_id: "missing", action: "kill" },
    "Error: hang_id not found or not owned: missing",
    true,
  );
  expect(view.outcome).toBe("error");
  expect(view.action).toBe("kill");
});

it("tolerates missing args and empty fields", () => {
  expect(shellHangDecideView(undefined, "", false)).toEqual({
    hangId: "",
    action: "",
    outcome: "pending",
    resultText: "",
  });
  expect(shellHangDecideView({ hang_id: 1, action: "nope" }, "ok", true).action).toBe("");
});
