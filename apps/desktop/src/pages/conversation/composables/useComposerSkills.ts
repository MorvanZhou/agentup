import { computed, ref, watch, type Ref } from "vue";

import { DesktopApi } from "../../../shared/api/runtime";
import type { InvocableSkill } from "../../../shared/model/runtime/runtime";
import {
  filterSkillsByQuery,
  insertSkillReference,
  slashQueryAtCursor,
} from "../model/composer/skill-text";

export function useComposerSkills(options: {
  agentId: Ref<string>;
  token: Ref<string>;
  userId: Ref<string>;
  composerText: Ref<string>;
  /** 当前光标（用于任意位置 `/` 与插入）。 */
  cursor: Ref<number>;
  setText: (text: string, cursor?: number) => void;
  api?: DesktopApi;
}) {
  const api = options.api ?? new DesktopApi();
  const skills = ref<InvocableSkill[]>([]);
  const loadedFor = ref("");
  const highlight = ref(0);
  const forcedOpen = ref(false);
  /** 用户主动关闭后，在 slash 未变化前不再弹出。 */
  const dismissed = ref(false);
  /** 工具栏打开选择器时，记住插入点。 */
  const insertRange = ref<{ start: number; end: number } | null>(null);

  const slash = computed(() =>
    slashQueryAtCursor(options.composerText.value, options.cursor.value),
  );
  const open = computed(
    () => !dismissed.value && (forcedOpen.value || slash.value !== null),
  );
  const filtered = computed(() =>
    filterSkillsByQuery(skills.value, slash.value?.query ?? ""),
  );
  const knownNames = computed(() => new Set(skills.value.map((skill) => skill.name)));

  watch(slash, (value, prev) => {
    if (value) {
      insertRange.value = { start: value.start, end: value.end };
      // 新的 `/` 或查询变化时重新展示；仅失焦关闭时保持 dismissed
      if (!prev || prev.start !== value.start || prev.query !== value.query) {
        dismissed.value = false;
      }
    } else if (!forcedOpen.value) {
      insertRange.value = null;
      dismissed.value = false;
    }
  });

  watch(
    filtered,
    (list) => {
      if (highlight.value >= list.length) highlight.value = Math.max(0, list.length - 1);
    },
    { flush: "sync" },
  );

  watch(
    [() => options.agentId.value, () => options.token.value, () => options.userId.value],
    ([agentId, token, userId]) => {
      if (!agentId || !token || !userId) return;
      const key = `${userId}/${agentId}`;
      if (loadedFor.value === key) return;
      void api
        .invocableSkills(token, agentId, userId)
        .then((list) => {
          if (`${options.userId.value}/${options.agentId.value}` !== key) return;
          skills.value = list;
          loadedFor.value = key;
        })
        .catch(() => {
          if (`${options.userId.value}/${options.agentId.value}` !== key) return;
          skills.value = [];
          loadedFor.value = key;
        });
    },
    { immediate: true },
  );

  // 打开选择器时也拉一次（冷启动先点工具栏）。
  watch(open, (isOpen) => {
    if (!isOpen) return;
    const agentId = options.agentId.value;
    const token = options.token.value;
    const userId = options.userId.value;
    if (!agentId || !token || !userId) return;
    const key = `${userId}/${agentId}`;
    if (loadedFor.value === key) return;
    void api.invocableSkills(token, agentId, userId).then((list) => {
      skills.value = list;
      loadedFor.value = key;
    }).catch(() => {
      skills.value = [];
      loadedFor.value = key;
    });
  });

  watch(
    () => options.agentId.value,
    () => {
      skills.value = [];
      loadedFor.value = "";
      forcedOpen.value = false;
      dismissed.value = false;
      highlight.value = 0;
      insertRange.value = null;
    },
  );

  function openPicker(): void {
    const cursor = options.cursor.value;
    insertRange.value = { start: cursor, end: cursor };
    dismissed.value = false;
    forcedOpen.value = true;
  }

  function closePicker(): void {
    forcedOpen.value = false;
    dismissed.value = true;
    if (!slash.value) insertRange.value = null;
  }

  function selectSkill(name: string): void {
    const text = options.composerText.value;
    const range =
      slash.value ??
      insertRange.value ?? { start: options.cursor.value, end: options.cursor.value };
    const next = insertSkillReference(text, range.start, range.end, name);
    options.setText(next.text, next.cursor);
    forcedOpen.value = false;
    dismissed.value = false;
    insertRange.value = null;
    highlight.value = 0;
  }

  function moveHighlight(delta: number): void {
    const len = filtered.value.length;
    if (len === 0) return;
    highlight.value = (highlight.value + delta + len) % len;
  }

  function onPickerKeydown(event: KeyboardEvent): boolean {
    if (!open.value) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      const skill = filtered.value[highlight.value];
      if (skill) {
        event.preventDefault();
        selectSkill(skill.name);
        return true;
      }
    }
    if (event.key === "Tab") {
      const skill = filtered.value[highlight.value];
      if (skill) {
        event.preventDefault();
        selectSkill(skill.name);
        return true;
      }
    }
    return false;
  }

  return {
    open,
    filtered,
    highlight,
    knownNames,
    openPicker,
    closePicker,
    selectSkill,
    onPickerKeydown,
  };
}
