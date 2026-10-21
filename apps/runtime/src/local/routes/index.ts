import type { Hono } from "hono";

import type { LocalAppDeps, LocalAppEnv } from "../http.js";
import { registerAgentsRoutes } from "./agents.js";
import { registerAuthRoutes } from "./auth.js";
import { registerHealthRoutes } from "./health.js";
import { registerHitlRoutes } from "./hitl.js";
import { registerLocalAgentsRoutes } from "./local-agents.js";
import { registerPersonalAssistantRoutes } from "./personal-assistant.js";
import { registerPreferencesRoutes } from "./preferences.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerStateRoutes } from "./state.js";
import { registerWorkspaceRoutes } from "./workspace.js";

export function registerLocalRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  registerHealthRoutes(app);
  registerAuthRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerPreferencesRoutes(app, deps);
  registerStateRoutes(app, deps);
  registerHitlRoutes(app, deps);
  registerPersonalAssistantRoutes(app, deps);
  registerLocalAgentsRoutes(app, deps);
  registerAgentsRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);
}
