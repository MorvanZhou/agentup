import type { Hono } from "hono";

import {
  forgotPassword,
  login,
  oauthAuthorizeUrl,
  oauthExchange,
  registerAccount,
  resendVerification,
  resetPassword,
  turnstilePublic,
  updateProfile,
  verifyEmail,
} from "../../control/client.js";
import { MigrateUserError, migrateUserData } from "../migrate-user.js";
import { bearer, json, LocalError, readJson, text, type LocalAppDeps, type LocalAppEnv } from "../http.js";
import { session } from "../serialize.js";

function optionalText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export function registerAuthRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { config } = deps;

  app.post("/register", async (c) => {
    const body = await readJson(c);
    const pending = await registerAccount(
      config.backendUrl,
      text(body, "email"),
      text(body, "password"),
      optionalText(body, "turnstile_token"),
    );
    return json(c, 200, pending);
  });

  app.post("/login", async (c) => {
    const body = await readJson(c);
    return json(c, 200, session(await login(config.backendUrl, text(body, "email"), text(body, "password"))));
  });

  app.post("/auth/resend-verification", async (c) => {
    const body = await readJson(c);
    await resendVerification(
      config.backendUrl,
      text(body, "email"),
      text(body, "password"),
      optionalText(body, "turnstile_token"),
    );
    return json(c, 200, { ok: true });
  });

  app.post("/auth/verify-email", async (c) => {
    const body = await readJson(c);
    return json(
      c,
      200,
      session(await verifyEmail(config.backendUrl, text(body, "email"), text(body, "code"))),
    );
  });

  app.post("/auth/forgot-password", async (c) => {
    const body = await readJson(c);
    await forgotPassword(config.backendUrl, text(body, "email"), optionalText(body, "turnstile_token"));
    return json(c, 200, { ok: true });
  });

  app.post("/auth/reset-password", async (c) => {
    const body = await readJson(c);
    return json(
      c,
      200,
      session(
        await resetPassword(
          config.backendUrl,
          text(body, "email"),
          text(body, "code"),
          text(body, "password"),
        ),
      ),
    );
  });

  app.post("/auth/oauth/:provider/authorize-url", async (c) => {
    const provider = c.req.param("provider");
    if (provider !== "github" && provider !== "google") {
      throw new LocalError("未知 OAuth 提供商", 400);
    }
    const body = await readJson(c);
    const url = await oauthAuthorizeUrl(config.backendUrl, provider, text(body, "loopback_uri"));
    return json(c, 200, { url });
  });

  app.post("/auth/oauth/exchange", async (c) => {
    const body = await readJson(c);
    return json(c, 200, session(await oauthExchange(config.backendUrl, text(body, "code"))));
  });

  app.get("/auth/turnstile", async (c) => {
    const info = await turnstilePublic(config.backendUrl);
    return json(c, 200, { site_key: info.siteKey, required: info.required });
  });

  app.put("/me", async (c) => {
    const body = await readJson(c);
    const avatarRaw = body.avatar;
    const avatarBase64 = typeof avatarRaw === "string" && avatarRaw.trim() ? avatarRaw.trim() : undefined;
    return json(
      c,
      200,
      session(
        await updateProfile(config.backendUrl, bearer(c), text(body, "nickname"), {
          ...(avatarBase64 ? { avatarBase64 } : {}),
        }),
      ),
    );
  });

  app.post("/local/migrate-user", async (c) => {
    bearer(c);
    const body = await readJson(c);
    try {
      migrateUserData(config.userDataRoot, text(body, "from_user_id"), text(body, "to_user_id"));
    } catch (error) {
      if (error instanceof MigrateUserError) throw new LocalError(error.message, error.status);
      throw error;
    }
    return json(c, 200, { migrated: true });
  });
}
