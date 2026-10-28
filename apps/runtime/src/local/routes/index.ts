import type { Hono } from "hono";

import type { LocalAppDeps, LocalAppEnv } from "../http.js";
import { registerAgentsRoutes } from "./agents.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCommunitySkillsRoutes } from "./community-skills.js";
import { registerDesktopPulseRoutes } from "./desktop-pulse.js";
import { registerGroupRoutes } from "./groups.js";
import { registerHealthRoutes } from "./health.js";
import { registerHitlRoutes } from "./hitl.js";
import { registerLocalAgentsRoutes } from "./local-agents.js";
import { registerPersonalAssistantRoutes } from "./personal-assistant.js";
import { registerPreferencesRoutes } from "./preferences.js";
import { registerProjectRootsRoutes } from "./project-roots.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerStateRoutes } from "./state.js";
import { registerWorkspaceRoutes } from "./workspace.js";

export function registerLocalRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  registerHealthRoutes(app);
  registerGroupRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerCommunitySkillsRoutes(app, deps);
  registerPreferencesRoutes(app, deps);
  registerStateRoutes(app, deps);
  registerHitlRoutes(app, deps);
  registerDesktopPulseRoutes(app, deps);
  registerPersonalAssistantRoutes(app, deps);
  registerLocalAgentsRoutes(app, deps);
  registerAgentsRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);
  registerProjectRootsRoutes(app, deps);
}
