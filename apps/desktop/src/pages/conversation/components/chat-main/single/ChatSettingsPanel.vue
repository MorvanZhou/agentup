<script setup lang="ts">
import { PuzzleIcon, TerminalIcon, UsersIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { useDesktop } from "../../../../../app/desktop";
import { DesktopApi } from "../../../../../shared/api/runtime";
import type {
  AgentApprovals,
  ApprovalChoice,
} from "../../../../../shared/api/runtime/agents";
import UiSkeleton from "../../../../../shared/components/UiSkeleton.vue";
import { showToast } from "../../../../../shared/model/ui/toast";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { injectThreadActions } from "../../../model/thread/thread-actions";
import { injectThreadExtras } from "../../../model/thread/thread-extras";
import ApprovalScopePicker from "../shared/settings/ApprovalScopePicker.vue";
import SettingsDrawerFrame from "../shared/settings/SettingsDrawerFrame.vue";

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

function onCommandChange(value: ApprovalChoice): void {
  void patchApprovals({ command: value });
}

function onToolChange(toolName: string, value: ApprovalChoice): void {
  void patchApprovals({ tools: [{ toolName, scope: value }] });
}

function onAnyoneChange(value: ApprovalChoice): void {
  if (value !== "once" && value !== "agent") return;
  void patchApprovals({ delegation: { anyone: value } });
}

function onTargetChange(agentId: string, value: ApprovalChoice): void {
  void patchApprovals({ delegation: { targets: [{ agentId, scope: value }] } });
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
  <SettingsDrawerFrame :lead="t('chatSettingsLead')" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <!-- 备注 -->
      <section
        v-if="!extras.personal"
        class="rounded-xl border border-rule bg-paper p-3.5 animate-rise motion-reduce:animate-none"
      >
        <label class="grid gap-2" for="chat-settings-remark">
          <span class="text-xs font-semibold tracking-wide text-foreground">
            {{ t("threadRemarkLabel") }}
          </span>
          <input
            id="chat-settings-remark"
            v-model="remarkDraft"
            type="text"
            maxlength="40"
            class="min-h-8 w-full rounded-lg border border-rule bg-background px-3 text-sm outline-none transition duration-200 placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
            :placeholder="t('threadRemarkPlaceholder')"
            :disabled="remarkSaving || extras.busy"
            @change="saveRemark"
            @keydown.enter.prevent="saveRemark"
          />
        </label>
        <p class="mt-2 mb-0 text-xs leading-snug text-muted-foreground">
          {{ t("threadRemarkBody") }}
        </p>
      </section>

      <!-- 加载骨架：对齐分区卡片，勿纯文案 -->
      <div
        v-if="loading"
        class="flex flex-col gap-3"
        role="status"
        aria-busy="true"
        :aria-label="t('assistLoading')"
      >
        <span class="sr-only">{{ t("assistLoading") }}</span>
        <div
          v-for="index in 3"
          :key="index"
          class="rounded-xl border border-rule bg-paper p-3.5"
        >
          <div class="mb-3 flex items-center gap-2.5">
            <UiSkeleton class="size-8" rounded="lg" />
            <div class="grid flex-1 gap-1.5">
              <UiSkeleton class="h-3 w-20" />
              <UiSkeleton class="h-2.5 w-36" />
            </div>
          </div>
          <UiSkeleton class="h-8 w-full" rounded="lg" />
        </div>
      </div>

      <template v-else-if="approvals">
        <!-- 命令审批 -->
        <section
          class="rounded-xl border border-rule bg-paper p-3.5 animate-rise motion-reduce:animate-none [animation-delay:40ms]"
        >
          <header class="mb-3 flex items-start gap-2.5">
            <span
              class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
              aria-hidden="true"
            >
              <TerminalIcon class="size-3.5" />
            </span>
            <div class="min-w-0 pt-0.5">
              <h3
                id="chat-settings-command"
                class="m-0 text-xs font-semibold tracking-wide text-foreground"
              >
                {{ t("chatSettingsCommand") }}
              </h3>
              <p class="mb-0 mt-0.5 text-xs leading-snug text-muted-foreground">
                {{ t("chatSettingsCommandHint") }}
              </p>
            </div>
          </header>
          <div class="grid gap-1.5">
            <span class="text-xs text-muted-foreground">{{ t("chatSettingsBash") }}</span>
            <ApprovalScopePicker
              :value="approvals.command"
              :options="scopeOptions"
              :disabled="saving"
              labelled-by="chat-settings-command"
              @change="onCommandChange"
            />
          </div>
        </section>

        <!-- MCP -->
        <section
          class="rounded-xl border border-rule bg-paper p-3.5 animate-rise motion-reduce:animate-none [animation-delay:80ms]"
        >
          <header class="mb-3 flex items-start gap-2.5">
            <span
              class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
              aria-hidden="true"
            >
              <PuzzleIcon class="size-3.5" />
            </span>
            <div class="min-w-0 pt-0.5">
              <h3 class="m-0 text-xs font-semibold tracking-wide text-foreground">
                {{ t("chatSettingsMcp") }}
              </h3>
              <p class="mb-0 mt-0.5 text-xs leading-snug text-muted-foreground">
                {{ t("chatSettingsMcpHint") }}
              </p>
            </div>
          </header>

          <p
            v-if="mcpServers.length === 0 && mcpTools.length === 0"
            class="m-0 rounded-lg border border-dashed border-rule bg-background px-3 py-4 text-center text-xs text-muted-foreground"
          >
            {{ t("chatSettingsMcpEmpty") }}
          </p>

          <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
            <li
              v-for="tool in mcpServers"
              :key="tool.toolName"
              class="grid gap-1.5"
            >
              <div class="flex min-w-0 items-baseline justify-between gap-2">
                <span class="truncate text-sm font-medium text-foreground">{{ tool.label }}</span>
                <span
                  class="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
                >
                  {{ toolKindLabel(tool.kind) }}
                </span>
              </div>
              <ApprovalScopePicker
                :value="tool.scope"
                :options="scopeOptions"
                :disabled="saving"
                @change="onToolChange(tool.toolName, $event)"
              />
            </li>
            <li
              v-for="tool in mcpTools"
              :key="tool.toolName"
              class="grid gap-1.5"
            >
              <div class="flex min-w-0 items-baseline justify-between gap-2">
                <span class="truncate font-mono text-xs text-foreground">{{ tool.label }}</span>
                <span
                  class="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
                >
                  {{ toolKindLabel(tool.kind) }}
                </span>
              </div>
              <ApprovalScopePicker
                :value="tool.scope"
                :options="scopeOptions"
                :disabled="saving"
                @change="onToolChange(tool.toolName, $event)"
              />
            </li>
          </ul>
        </section>

        <!-- 会诊委托 -->
        <section
          class="rounded-xl border border-rule bg-paper p-3.5 animate-rise motion-reduce:animate-none [animation-delay:120ms]"
        >
          <header class="mb-3 flex items-start gap-2.5">
            <span
              class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
              aria-hidden="true"
            >
              <UsersIcon class="size-3.5" />
            </span>
            <div class="min-w-0 pt-0.5">
              <h3
                id="chat-settings-delegation"
                class="m-0 text-xs font-semibold tracking-wide text-foreground"
              >
                {{ t("chatSettingsDelegation") }}
              </h3>
              <p class="mb-0 mt-0.5 text-xs leading-snug text-muted-foreground">
                {{ t("chatSettingsDelegationHint") }}
              </p>
            </div>
          </header>

          <div class="mb-3 grid gap-1.5">
            <span class="text-xs text-muted-foreground">
              {{ t("chatSettingsDelegationAnyone") }}
            </span>
            <ApprovalScopePicker
              :value="approvals.delegation.anyone"
              :options="anyoneOptions"
              :disabled="saving"
              labelled-by="chat-settings-delegation"
              @change="onAnyoneChange"
            />
          </div>

          <div class="border-t border-rule pt-3">
            <p class="m-0 mb-2 text-xs font-medium text-foreground">
              {{ t("chatSettingsDelegationTargets") }}
            </p>
            <p
              v-if="approvals.delegation.targets.length === 0"
              class="m-0 text-xs leading-snug text-muted-foreground"
            >
              {{ t("chatSettingsDelegationTargetsEmpty") }}
            </p>
            <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
              <li
                v-for="target in approvals.delegation.targets"
                :key="target.agentId"
                class="grid gap-1.5"
              >
                <span class="truncate text-sm text-foreground">
                  {{ agentLabel(target.agentId) }}
                </span>
                <ApprovalScopePicker
                  :value="target.scope"
                  :options="scopeOptions"
                  :disabled="saving"
                  @change="onTargetChange(target.agentId, $event)"
                />
              </li>
            </ul>
          </div>
        </section>
      </template>
    </div>
  </SettingsDrawerFrame>
</template>
