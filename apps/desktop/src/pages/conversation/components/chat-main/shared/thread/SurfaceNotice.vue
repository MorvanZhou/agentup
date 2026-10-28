<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import { chatSurfaceKind, injectChatMessageFooter } from "../../../../model/thread/chat-surface";

const kind = useAuiState((s) => chatSurfaceKind(s.message.metadata));
const text = useAuiState((s) => {
  const parts = s.message.parts ?? [];
  return parts
    .filter((part) => part.type === "text" && "text" in part)
    .map((part) => part.text)
    .join("");
});
const footer = injectChatMessageFooter();
</script>

<template>
  <div>
    <p v-if="kind === 'system'" class="m-0 text-center text-xs text-muted-foreground">
      {{ text }}
    </p>
    <p v-else-if="kind === 'handback'" class="m-0 text-sm text-muted-foreground">
      {{ text }}
    </p>
    <component :is="footer" v-else-if="kind === 'queue' && footer" />
  </div>
</template>
