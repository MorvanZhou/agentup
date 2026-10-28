<script setup lang="ts">
import { computed } from "vue";
import { CircleUserIcon } from "@lucide/vue";

const props = withDefaults(
  defineProps<{
    /** 成员头像格；群记录本身不存头像，由调用方从名片表注入。 */
    faces: ReadonlyArray<{ agentId: string; avatarUrl?: string }>;
    /** 当前用户头像；拼图首位。无 URL 时用占位图标。 */
    userAvatarUrl?: string;
    /** 是否把用户头像拼进格子；默认开。 */
    showUser?: boolean;
    size?: "sm" | "sidebar";
  }>(),
  { size: "sm", showUser: true },
);

const sizeClass = {
  sm: "size-8",
  sidebar: "size-12",
} as const;

const iconClass = {
  sm: "size-2.5",
  sidebar: "size-3.5",
} as const;

type Tile = { key: string; avatarUrl?: string; kind: "user" | "agent" };

/** 用户在前，最多 4 格（2×2），避免侧栏小格挤爆。 */
const tiles = computed<Tile[]>(() => {
  const agents: Tile[] = props.faces.map((member) => ({
    key: member.agentId,
    avatarUrl: member.avatarUrl?.trim() || undefined,
    kind: "agent",
  }));
  if (!props.showUser) return agents.slice(0, 4);
  const user: Tile = {
    key: "__user__",
    avatarUrl: props.userAvatarUrl?.trim() || undefined,
    kind: "user",
  };
  return [user, ...agents].slice(0, 4);
});
</script>

<template>
  <!-- 群聊头像：用户 + 成员拼成一格 -->
  <span
    class="grid shrink-0 gap-px overflow-hidden rounded-lg bg-rule"
    :class="[sizeClass[size], tiles.length > 1 ? 'grid-cols-2' : 'grid-cols-1']"
    aria-hidden="true"
  >
    <span
      v-for="tile in tiles"
      :key="tile.key"
      class="grid size-full min-h-0 min-w-0 place-items-center bg-muted text-muted-foreground"
    >
      <img
        v-if="tile.avatarUrl"
        :src="tile.avatarUrl"
        alt=""
        class="size-full object-cover"
      />
      <CircleUserIcon
        v-else-if="tile.kind === 'user'"
        :class="iconClass[size]"
        aria-hidden="true"
      />
    </span>
  </span>
</template>
