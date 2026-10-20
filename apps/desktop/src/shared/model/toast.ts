import { reactive, readonly } from "vue";

export type ToastTone = "success" | "error";

const state = reactive({
  open: false,
  message: "",
  tone: "success" as ToastTone,
  duration: 4000,
});

/** 供 App 绑定 AppToast；调用方请用 showToast / setToastOpen。 */
export const toastState = readonly(state);

export function showToast(message: string, tone: ToastTone = "error", duration = 4000): void {
  const text = message.trim();
  if (!text) return;
  state.message = text;
  state.tone = tone;
  state.duration = duration;
  state.open = true;
}

export function setToastOpen(open: boolean): void {
  state.open = open;
}
