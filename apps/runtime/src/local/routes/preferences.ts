import type { Hono } from "hono";

import { getPreferences, putPreferences, type ThemeMode, type UiLocale } from "../../control/client.js";
import { bearer, json, LocalError, readJson, text, type LocalAppDeps, type LocalAppEnv } from "../http.js";

export function registerPreferencesRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config } = deps;

  app.get("/preferences", async (c) => {
    const prefs = await getPreferences(config.backendUrl, bearer(c));
    return json(c, 200, {
      theme_mode: prefs.themeMode,
      skip_edit_resend_confirm: prefs.skipEditResendConfirm,
      ui_locale: prefs.uiLocale,
    });
  });

  app.put("/preferences", async (c) => {
    const body = await readJson(c);
    const update: { themeMode?: ThemeMode; skipEditResendConfirm?: boolean; uiLocale?: UiLocale } = {};
    if ("theme_mode" in body) {
      const themeMode = text(body, "theme_mode");
      if (themeMode !== "system" && themeMode !== "light" && themeMode !== "dark") {
        throw new LocalError("theme_mode 无效", 400);
      }
      update.themeMode = themeMode;
    }
    if ("skip_edit_resend_confirm" in body) {
      if (typeof body.skip_edit_resend_confirm !== "boolean") {
        throw new LocalError("skip_edit_resend_confirm 无效", 400);
      }
      update.skipEditResendConfirm = body.skip_edit_resend_confirm;
    }
    if ("ui_locale" in body) {
      const uiLocale = text(body, "ui_locale");
      if (uiLocale !== "zh" && uiLocale !== "en") {
        throw new LocalError("ui_locale 无效", 400);
      }
      update.uiLocale = uiLocale;
    }
    if (
      update.themeMode === undefined &&
      update.skipEditResendConfirm === undefined &&
      update.uiLocale === undefined
    ) {
      throw new LocalError("至少提供一项偏好", 400);
    }
    const prefs = await putPreferences(config.backendUrl, bearer(c), update);
    return json(c, 200, {
      theme_mode: prefs.themeMode,
      skip_edit_resend_confirm: prefs.skipEditResendConfirm,
      ui_locale: prefs.uiLocale,
    });
  });
}
