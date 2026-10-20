import { requestJson } from "./http.js";
import { preferences } from "./parse.js";
import type { PreferencesUpdate, UserPreferences } from "./types.js";

export async function getPreferences(
  backendUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserPreferences> {
  const payload = await requestJson(fetchImpl, backendUrl, "GET", "/v1/me/preferences", undefined, token);
  return preferences(payload);
}

export async function putPreferences(
  backendUrl: string,
  token: string,
  update: PreferencesUpdate,
  fetchImpl: typeof fetch = fetch,
): Promise<UserPreferences> {
  const body: Record<string, unknown> = {};
  if (update.themeMode !== undefined) body.theme_mode = update.themeMode;
  if (update.skipEditResendConfirm !== undefined) {
    body.skip_edit_resend_confirm = update.skipEditResendConfirm;
  }
  if (update.uiLocale !== undefined) body.ui_locale = update.uiLocale;
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "PUT",
    "/v1/me/preferences",
    body,
    token,
  );
  return preferences(payload);
}
