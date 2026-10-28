import { computed, ref, watch, type Ref } from "vue";

import {
  insertMention,
  mentionQueryAtCursor,
  type ComposerMention,
} from "../model/composer/mention-text";

export type ComposerMentionMember = ComposerMention & {
  role?: string;
  avatarUrl?: string;
};

/**
 * Composer / 编辑气泡共用的群成员 @ 选择器状态。
 * 行为对齐 useComposerSkills：工具栏强制打开、Esc/选完后 dismiss，查询变化再弹出。
 */
export function useComposerMentions(options: {
  members: Ref<ReadonlyArray<ComposerMentionMember>>;
  composerText: Ref<string>;
  cursor: Ref<number>;
  setText: (text: string, cursor?: number) => void;
}) {
  const forcedOpen = ref(false);
  /** 选完 / Esc 后，在 @ 查询未变化前不再弹出。 */
  const dismissed = ref(false);
  const highlight = ref(0);

  const knownNames = computed(
    () => new Set(options.members.value.map((member) => member.name).filter(Boolean)),
  );
  const query = computed(() =>
    mentionQueryAtCursor(options.composerText.value, options.cursor.value, knownNames.value),
  );
  const open = computed(
    () =>
      options.members.value.length > 0 &&
      !dismissed.value &&
      (forcedOpen.value || query.value !== null),
  );
  const filtered = computed(() => {
    const q = query.value?.query.trim().toLowerCase() ?? "";
    return options.members.value.filter(
      (member) =>
        !q ||
        member.name.toLowerCase().includes(q) ||
        member.id.toLowerCase().includes(q) ||
        (member.role ?? "").toLowerCase().includes(q),
    );
  });

  watch(filtered, (items) => {
    if (highlight.value >= items.length) {
      highlight.value = Math.max(0, items.length - 1);
    }
  });
  watch(query, (next, prev) => {
    if (next) {
      forcedOpen.value = false;
      if (!prev || prev.start !== next.start || prev.query !== next.query) {
        dismissed.value = false;
      }
    } else if (!forcedOpen.value) {
      dismissed.value = false;
    }
  });

  function openPicker(): void {
    if (!options.members.value.length) return;
    dismissed.value = false;
    forcedOpen.value = true;
    highlight.value = 0;
  }

  function closePicker(): void {
    forcedOpen.value = false;
    dismissed.value = true;
  }

  function selectMention(member: ComposerMention): void {
    const range =
      query.value ??
      ({ start: options.cursor.value, end: options.cursor.value } as {
        start: number;
        end: number;
      });
    const next = insertMention(options.composerText.value, range.start, range.end, member);
    options.setText(next.text, next.cursor);
    forcedOpen.value = false;
    dismissed.value = true;
    highlight.value = 0;
  }

  function moveHighlight(delta: number): void {
    const len = filtered.value.length;
    if (len === 0) return;
    highlight.value = (highlight.value + delta + len) % len;
  }

  /** 选择器打开时消费键盘；返回 true 表示已处理。 */
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
      const member = filtered.value[highlight.value];
      if (member) {
        event.preventDefault();
        selectMention(member);
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
    selectMention,
    onPickerKeydown,
  };
}
