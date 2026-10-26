import { ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/ui/toast";

export const MCP_PLACEHOLDER = `{
  "example": {
    "url": "http://127.0.0.1:9001/mcp"
  }
}
`;

export function useUserMcp(api = new DesktopApi()) {
  const { session } = useDesktop();
  const text = ref("");
  const serverCount = ref(0);
  const loading = ref(false);
  const saving = ref(false);
  let loaded = false;
  let snapshot = "";
  let saveAgain = false;

  async function load(): Promise<void> {
    if (!session.value || loaded || loading.value) return;
    loading.value = true;
    try {
      apply(await api.userMcp(session.value.token, session.value.userId));
      snapshot = text.value;
      loaded = true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      loading.value = false;
    }
  }

  async function commitField(): Promise<void> {
    await saveIfChanged();
  }

  async function saveIfChanged(): Promise<void> {
    if (!session.value || !loaded || loading.value) return;
    if (text.value === snapshot) return;

    const parsed = parseMcpServers(text.value);
    if (!parsed) return;

    if (saving.value) {
      saveAgain = true;
      return;
    }

    saving.value = true;
    try {
      do {
        saveAgain = false;
        const submitted = text.value;
        const servers = parseMcpServers(submitted);
        if (!servers) return;
        const saved = await api.saveUserMcp(
          session.value.token,
          session.value.userId,
          servers,
        );
        const formatted = formatServers(saved);
        if (text.value === submitted) apply(saved);
        else {
          serverCount.value = Object.keys(saved).length;
        }
        snapshot = formatted;
      } while (saveAgain || text.value !== snapshot);
      showToast("外部工具配置已保存", "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      saving.value = false;
    }
  }

  function apply(servers: Record<string, unknown>): void {
    serverCount.value = Object.keys(servers).length;
    text.value = formatServers(servers);
  }

  return { text, serverCount, loading, saving, load, commitField };
}

function formatServers(servers: Record<string, unknown>): string {
  return Object.keys(servers).length ? `${JSON.stringify(servers, null, 2)}\n` : "";
}

function parseMcpServers(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim() || "{}");
  } catch {
    showToast("JSON 无效", "error");
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    showToast("服务配置必须是 JSON 对象", "error");
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "外部工具配置失败";
}
