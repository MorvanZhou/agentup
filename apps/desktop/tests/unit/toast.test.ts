import { afterEach, expect, it } from "vitest";

import { setToastOpen, showToast, toastState } from "../../src/shared/model/toast.js";

afterEach(() => {
  setToastOpen(false);
});

it("showToast opens an error toast", () => {
  showToast("没有这个接口", "error");
  expect(toastState).toMatchObject({
    open: true,
    message: "没有这个接口",
    tone: "error",
  });
});

it("showToast can present a success toast", () => {
  showToast("本地模型配置已保存", "success");
  expect(toastState).toMatchObject({
    open: true,
    message: "本地模型配置已保存",
    tone: "success",
  });
});

it("showToast ignores blank messages", () => {
  showToast("保留", "error");
  showToast("   ", "error");
  expect(toastState).toMatchObject({
    open: true,
    message: "保留",
  });
});
