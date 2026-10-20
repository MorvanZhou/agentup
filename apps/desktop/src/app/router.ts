import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";

import AgentsPage from "../pages/agents/AgentsPage.vue";
import ConversationPage from "../pages/conversation/ConversationPage.vue";
import LoginPage from "../pages/login/LoginPage.vue";
import PublishEditorPage from "../pages/publish/PublishEditorPage.vue";
import SettingsPage from "../pages/settings/SettingsPage.vue";
import { isAccountSession } from "../shared/model/session";
import AppLayout from "./AppLayout.vue";
import { isAuthGateReady, runWithAccount } from "./auth-gate";
import { ensureGuestSession, readSession } from "./session-store";

const ownedAgents = { name: "agents" as const, query: { tab: "owned" } };

// 打包后 loadFile 走 file://，history 模式无法匹配路由；生产用 hash。
export const router = createRouter({
  history: import.meta.env.PROD ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginPage },
    {
      path: "/",
      component: AppLayout,
      children: [
        { path: "", name: "conversation", component: ConversationPage },
        { path: "agents", name: "agents", component: AgentsPage },
        { path: "publish", name: "publish", redirect: ownedAgents },
        {
          path: "publish/new",
          name: "publish-new",
          component: PublishEditorPage,
          meta: { requiresAccount: true },
        },
        {
          path: "publish/:agentId",
          name: "publish-edit",
          component: PublishEditorPage,
          meta: { requiresAccount: true },
        },
        { path: "settings", name: "settings", component: SettingsPage },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const current = readSession();
  if (to.name === "login") {
    if (isAccountSession(current)) {
      const redirect = to.query.redirect;
      if (typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("/login")) {
        return redirect;
      }
      return { name: "conversation" };
    }
    return true;
  }
  if (!current) await ensureGuestSession();
  if (to.matched.some((record) => record.meta.requiresAccount) && !isAccountSession(readSession())) {
    const target = to.fullPath;
    // App 挂载前闸门尚未 bind：退回登录页；挂载后留页叠层并打开浏览器。
    if (!isAuthGateReady()) {
      return { name: "login", query: { redirect: target } };
    }
    void runWithAccount("agent.publish", async () => {
      if (!isAccountSession(readSession())) return;
      await router.push(target);
    });
    return false;
  }
  return true;
});
