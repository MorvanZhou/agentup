import { createApp } from "vue";

import App from "./app/App.vue";
import { router } from "./app/router";
import { ensureGuestSession, restoreSession } from "./app/session-store";
import { bootstrapTheme } from "./app/theme";
import { i18n } from "./shared/i18n";
import { applyUiLocale, readDeviceLocale } from "./shared/model/ui-locale";
import "./styles/main.css";

let session = await restoreSession();
if (!session) session = await ensureGuestSession();
bootstrapTheme(session.userId);
await applyUiLocale(readDeviceLocale());
createApp(App).use(i18n).use(router).mount("#app");
