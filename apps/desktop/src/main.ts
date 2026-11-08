import { createApp } from "vue";

import App from "./app/App.vue";
import { router } from "./app/router";
import { ensureGuestSession, restoreSession } from "./app/session/session-store";
import { bootstrapChatFontSize } from "./app/theme/chat-font";
import { bootstrapTheme } from "./app/theme/theme";
import { i18n } from "./shared/i18n";
import { applyUiLocale, readDeviceLocale } from "./shared/model/ui/ui-locale";
import "./styles/main.css";

let session = await restoreSession();
if (!session) session = await ensureGuestSession();
bootstrapTheme(session.userId);
bootstrapChatFontSize(session.userId);
await applyUiLocale(readDeviceLocale());
createApp(App).use(i18n).use(router).mount("#app");
