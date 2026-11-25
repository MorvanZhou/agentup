/** @vitest-environment happy-dom */
import { beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";

import { mountView } from "./mount-view";

const preferences = vi.fn();
const savePreferences = vi.fn();
const browserUseSettings = vi.fn();
const saveBrowserUseSettings = vi.fn();

const themeMode = ref<"system" | "light" | "dark">("system");
const chatFontSize = ref<"sm" | "md" | "lg">("md");
const uiLocale = ref<"zh" | "en">("en");
const session = ref({
  token: "tok",
  userId: "u1",
  kind: "account" as const,
  email: "a@b.c",
  nickname: "n",
});

vi.mock("../../src/shared/api/runtime", () => ({
  DesktopApi: class {
    preferences = preferences;
    savePreferences = savePreferences;
    browserUseSettings = browserUseSettings;
    saveBrowserUseSettings = saveBrowserUseSettings;
  },
  DesktopApiError: class extends Error {},
}));

vi.mock("../../src/app/desktop", () => ({
  useDesktop: () => ({
    session,
    themeMode,
    chatFontSize,
    uiLocale,
    skipEditResendConfirm: ref(false),
    menuBarAvailable: ref(false),
    menuBarVisible: ref(false),
    setMenuBarVisible: vi.fn(),
    setChatFontSize: async (next: "sm" | "md" | "lg") => {
      chatFontSize.value = next;
      await savePreferences("tok", { chatFontSize: next });
      return true;
    },
    setUiLocale: async (next: "zh" | "en") => {
      uiLocale.value = next;
      await savePreferences("tok", { uiLocale: next });
      return true;
    },
  }),
}));

vi.mock("../../src/shared/model/ui/toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("../../src/shared/model/ui/ui-locale", async () => {
  const actual = await vi.importActual<typeof import("../../src/shared/model/ui/ui-locale")>(
    "../../src/shared/model/ui/ui-locale",
  );
  return {
    ...actual,
    t: (key: string) => key,
    applyUiLocale: vi.fn(async (locale: "zh" | "en") => {
      uiLocale.value = locale;
    }),
  };
});

vi.mock("../../src/app/theme/theme", () => ({
  applyTheme: vi.fn(),
  readThemeMirror: vi.fn(),
  writeThemeMirror: vi.fn(),
}));

vi.mock("../../src/app/theme/chat-font", () => ({
  applyChatFontSize: vi.fn(),
  readChatFontMirror: vi.fn(),
  writeChatFontMirror: vi.fn(),
}));

beforeEach(() => {
  themeMode.value = "system";
  chatFontSize.value = "md";
  uiLocale.value = "en";
  preferences.mockReset();
  savePreferences.mockReset();
  browserUseSettings.mockReset();
  saveBrowserUseSettings.mockReset();
  preferences.mockResolvedValue({
    themeMode: "system",
    chatFontSize: "md",
    uiLocale: "en",
    skipEditResendConfirm: false,
  });
  savePreferences.mockImplementation(async (_token: string, update: Record<string, unknown>) => ({
    themeMode: (update.themeMode as typeof themeMode.value) ?? themeMode.value,
    chatFontSize: (update.chatFontSize as typeof chatFontSize.value) ?? chatFontSize.value,
    uiLocale: (update.uiLocale as typeof uiLocale.value) ?? uiLocale.value,
    skipEditResendConfirm: false,
  }));
  browserUseSettings.mockResolvedValue({ mode: "profile" });
  saveBrowserUseSettings.mockResolvedValue({ mode: "extension" });
});

it("preferences 200 之后点未选项会发 savePreferences（不被 load busy 锁死）", async () => {
  const { useGeneralSettings } = await import(
    "../../src/pages/settings/composables/useGeneralSettings"
  );

  let api: ReturnType<typeof useGeneralSettings> | null = null;
  const Host = defineComponent({
    setup() {
      api = useGeneralSettings();
      return () => h("div");
    },
  });
  mountView(Host);
  await nextTick();
  // onMounted load
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();

  expect(preferences).toHaveBeenCalled();
  expect(api).toBeTruthy();
  expect(api!.busy.value).toBe(false);

  await api!.selectLocale("zh");
  expect(savePreferences).toHaveBeenCalledWith("tok", { uiLocale: "zh" });

  await api!.select("light");
  expect(savePreferences).toHaveBeenCalledWith("tok", { themeMode: "light" });

  await api!.selectFont("lg");
  expect(savePreferences).toHaveBeenCalledWith(
    "tok",
    expect.objectContaining({ chatFontSize: "lg" }),
  );
});
