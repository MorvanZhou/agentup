import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";

import AgentsPage from "../pages/agents/AgentsPage.vue";
import LocalAgentCreatePage from "../pages/agents/LocalAgentCreatePage.vue";
import LocalAgentEditPage from "../pages/agents/LocalAgentEditPage.vue";
import MarketPage from "../pages/agents/MarketPage.vue";
import PublishEditorPage from "../pages/agents/PublishEditorPage.vue";
import ConversationPage from "../pages/conversation/ConversationPage.vue";
import SettingsPage from "../pages/settings/SettingsPage.vue";
import { isAccountSession } from "../shared/model/session/session";
import { isAuthGateReady, runWithAccount, whenAuthGateReady } from "./auth/auth-gate";
import { ensureGuestSession, readSession } from "./session/session-store";
import AppLayout from "./shell/AppLayout.vue";

// 打包后 loadFile 走 file://，history 模式无法匹配路由；生产用 hash。
export const router = createRouter({
  history: import.meta.env.PROD ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: "/login", redirect: { name: "conversation" } },
    {
      path: "/",
      component: AppLayout,
      children: [
        { path: "", name: "conversation", component: ConversationPage },
        { path: "groups", redirect: { name: "conversation" } },
        { path: "market", name: "market", component: MarketPage },
        { path: "agents", redirect: { name: "agents-local" } },
        {
          path: "agents/assistant",
          name: "agents-assistant",
          component: AgentsPage,
        },
        {
          path: "agents/local",
          name: "agents-local",
          component: AgentsPage,
        },
        {
          path: "agents/local/new",
          name: "agents-local-new",
          component: LocalAgentCreatePage,
        },
        {
          path: "agents/local/:agentId/edit",
          name: "agents-local-edit",
          component: LocalAgentEditPage,
        },
        {
          path: "agents/recruited",
          name: "agents-recruited",
          component: AgentsPage,
        },
        {
          path: "agents/owned",
          name: "agents-owned",
          component: AgentsPage,
        },
        {
          path: "agents/owned/new",
          name: "agents-owned-new",
          component: PublishEditorPage,
          meta: { requiresAccount: true },
        },
        {
          path: "agents/owned/:agentId",
          name: "agents-owned-edit",
          component: PublishEditorPage,
          meta: { requiresAccount: true },
        },
        { path: "settings", name: "settings", component: SettingsPage },
      ],
    },
  ],
});

router.beforeEach(async (to, from) => {
  const current = readSession();
  if (!current) await ensureGuestSession();
  if (to.matched.some((record) => record.meta.requiresAccount) && !isAccountSession(readSession())) {
    const target = to.fullPath;
    if (!isAuthGateReady()) await whenAuthGateReady();
    if (isAuthGateReady() && !isAccountSession(readSession())) {
      void runWithAccount("agent.publish", async () => {
        if (!isAccountSession(readSession())) return;
        await router.push(target);
      });
    }
    // 冷启动没有上一页：回到会话，叠层盖在主界面上。已在应用内则留在当前页。
    if (from.matched.length === 0) return { name: "conversation" };
    return false;
  }
  return true;
});
