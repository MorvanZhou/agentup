<script setup lang="ts">
import { XIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { useDesktop } from "../../../../app/desktop";
import { DesktopApi } from "../../../../shared/api/runtime";
import type {
  AgentApprovals,
  ApprovalChoice,
} from "../../../../shared/api/runtime/agents";
import { showToast } from "../../../../shared/model/toast";
import { t } from "../../../../shared/model/ui-locale";
import { injectThreadActions } from "../../model/thread/thread-actions";
import { injectThreadExtras } from "../../model/thread/thread-extras";

const props = defineProps<{
  token: string;
  userId: string;
  agentId: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const api = new DesktopApi();
const { conversations } = useDesktop();
const extras = injectThreadExtras();
const actions = injectThreadActions();

const loading = ref(false);
const saving = ref(false);
const remarkDraft = ref("");
const remarkSaving = ref(false);
const approvals = ref<AgentApprovals | null>(null);

const scopeOptions = computed(() => [
  { value: "once" as const, label: t("approvalScopeOnce") },
  { value: "session" as const, label: t("approvalScopeSession") },
  { value: "agent" as const, label: t("approvalScopeAgent") },
]);

const anyoneOptions = computed(() => [
  { value: "once" as const, label: t("approvalScopeOnce") },
  { value: "agent" as const, label: t("approvalScopeDelegationAgent") },
]);

const mcpServers = computed(() =>
  (approvals.value?.tools ?? []).filter((item) => item.kind === "mcp_server"),
);
const mcpTools = computed(() =>
  (approvals.value?.tools ?? []).filter((item) => item.kind === "mcp_tool"),
);

watch(
  () => [props.token, props.userId, props.agentId] as const,
  ([token, userId, agentId]) => {
    remarkDraft.value = extras.value.remark;
    if (!token || !userId || !agentId) {
      approvals.value = null;
      return;
    }
    void loadApprovals();
  },
  { immediate: true },
);

watch(
  () => extras.value.remark,
  (value) => {
    if (!remarkSaving.value) remarkDraft.value = value;
  },
);

async function loadApprovals(): Promise<void> {
  loading.value = true;
  try {
    approvals.value = await api.agentApprovals(props.token, props.agentId, props.userId);
  } catch (error) {
    approvals.value = null;
    showToast(
      error instanceof Error && error.message ? error.message : t("chatSettingsLoadFailed"),
      "error",
    );
  } finally {
    loading.value = false;
  }
}

async function saveRemark(): Promise<void> {
  if (!actions || remarkSaving.value) return;
  if (extras.value.personal) return;
  remarkSaving.value = true;
  try {
    await actions.value.setRemark(remarkDraft.value);
  } catch (error) {
    showToast(
      error instanceof Error && error.message ? error.message : t("threadRemarkFailed"),
      "error",
    );
  } finally {
    remarkSaving.value = false;
  }
}

async function patchApprovals(
  patch: Parameters<typeof api.saveAgentApprovals>[3],
): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    approvals.value = await api.saveAgentApprovals(
      props.token,
      props.agentId,
      props.userId,
      patch,
    );
  } catch (error) {
    showToast(
      error instanceof Error && error.message ? error.message : t("chatSettingsSaveFailed"),
      "error",
    );
    await loadApprovals();
  } finally {
    saving.value = false;
  }
}

function onCommandChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ApprovalChoice;
  void patchApprovals({ command: value });
}

function onToolChange(toolName: string, event: Event): void {
  const scope = (event.target as HTMLSelectElement).value as ApprovalChoice;
  void patchApprovals({ tools: [{ toolName, scope }] });
}

function onAnyoneChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value !== "once" && value !== "agent") return;
  void patchApprovals({ delegation: { anyone: value } });
}

function onTargetChange(agentId: string, event: Event): void {
  const scope = (event.target as HTMLSelectElement).value as ApprovalChoice;
  void patchApprovals({ delegation: { targets: [{ agentId, scope }] } });
}

function agentLabel(agentId: string): string {
  const card = conversations.value.find((item) => item.agentId === agentId);
  if (!card) return agentId;
  return (card.remark || card.name || agentId).trim() || agentId;
}

function toolKindLabel(kind: "mcp_server" | "mcp_tool"): string {
  if (kind === "mcp_server") return t("chatSettingsMcpServer");
  return t("chatSettingsMcpTool");
}
</script>

<template>
  <!-- 对话配置：备注 + 审批范围；复用右侧抽屉 -->
  <aside class="flex h-full min-h-0 w-full flex-col border-l border-border bg-paper">
    <header class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <div class="min-w-0 flex-1">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("chatSettingsKicker") }}</p>
        <h2 class="m-0 truncate text-sm font-semibold text-foreground">{{ t("chatSettingsTitle") }}</h2>
      </div>
      <button
        type="button"
        class="app-no-drag grid size-8 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="t('chatSettingsClose')"
        @click="emit('close')"
      >
        <XIcon class="size-4" aria-hidden="true" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <!-- 备注 -->
      <section v-if="!extras.personal" class="mb-5">
        <h3 class="m-0 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
          {{ t("threadRemarkLabel") }}
        </h3>
        <input
          v-model="remarkDraft"
          type="text"
          maxlength="40"
          class="min-h-8 w-full rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('threadRemarkPlaceholder')"
          :disabled="remarkSaving || extras.busy"
          @change="saveRemark"
          @keydown.enter.prevent="saveRemark"
        />
        <p class="mt-1 mb-0 text-xs text-muted-foreground">{{ t("threadRemarkBody") }}</p>
      </section>

      <p v-if="loading" class="m-0 text-sm text-muted-foreground">{{ t("assistLoading") }}</p>

      <template v-else-if="approvals">
        <!-- 命令 -->
        <section class="mb-5">
          <h3 class="m-0 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
            {{ t("chatSettingsCommand") }}
          </h3>
          <label class="grid gap-1 text-sm">
            <span class="text-foreground">{{ t("chatSettingsBash") }}</span>
            <select
              class="min-h-8 rounded-lg border border-rule bg-paper px-2 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
              :value="approvals.command"
              :disabled="saving"
              @change="onCommandChange"
            >
              <option v-for="option in scopeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </section>

        <!-- MCP -->
        <section class="mb-5">
          <h3 class="m-0 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
            {{ t("chatSettingsMcp") }}
          </h3>
          <p
            v-if="mcpServers.length === 0 && mcpTools.length === 0"
            class="m-0 mb-2 text-xs text-muted-foreground"
          >
            {{ t("chatSettingsMcpEmpty") }}
          </p>
          <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
            <li v-for="tool in mcpServers" :key="tool.toolName" class="grid gap-1 text-sm">
              <span class="flex min-w-0 items-baseline gap-1.5">
                <span class="truncate font-medium text-foreground">{{ tool.label }}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{{ toolKindLabel(tool.kind) }}</span>
              </span>
              <select
                class="min-h-8 rounded-lg border border-rule bg-paper px-2 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
                :value="tool.scope"
                :disabled="saving"
                @change="onToolChange(tool.toolName, $event)"
              >
                <option v-for="option in scopeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </li>
            <li v-for="tool in mcpTools" :key="tool.toolName" class="grid gap-1 text-sm">
              <span class="flex min-w-0 items-baseline gap-1.5">
                <span class="truncate font-mono text-xs text-foreground">{{ tool.label }}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{{ toolKindLabel(tool.kind) }}</span>
              </span>
              <select
                class="min-h-8 rounded-lg border border-rule bg-paper px-2 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
                :value="tool.scope"
                :disabled="saving"
                @change="onToolChange(tool.toolName, $event)"
              >
                <option v-for="option in scopeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </li>
          </ul>
        </section>

        <!-- 会诊 -->
        <section class="mb-2">
          <h3 class="m-0 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
            {{ t("chatSettingsDelegation") }}
          </h3>
          <label class="mb-3 grid gap-1 text-sm">
            <span class="text-foreground">{{ t("chatSettingsDelegationAnyone") }}</span>
            <select
              class="min-h-8 rounded-lg border border-rule bg-paper px-2 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
              :value="approvals.delegation.anyone"
              :disabled="saving"
              @change="onAnyoneChange"
            >
              <option v-for="option in anyoneOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <p
            v-if="approvals.delegation.targets.length === 0"
            class="m-0 text-xs text-muted-foreground"
          >
            {{ t("chatSettingsDelegationTargetsEmpty") }}
          </p>
          <ul
            v-else
            class="m-0 flex list-none flex-col gap-2.5 p-0"
          >
            <li
              v-for="target in approvals.delegation.targets"
              :key="target.agentId"
              class="grid gap-1 text-sm"
            >
              <span class="truncate text-foreground">{{ agentLabel(target.agentId) }}</span>
              <select
                class="min-h-8 rounded-lg border border-rule bg-paper px-2 text-sm outline-none transition duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15"
                :value="target.scope"
                :disabled="saving"
                @change="onTargetChange(target.agentId, $event)"
              >
                <option v-for="option in scopeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </aside>
</template>
