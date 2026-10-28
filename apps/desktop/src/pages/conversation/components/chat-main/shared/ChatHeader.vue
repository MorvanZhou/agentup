<template>
  <!-- 会话顶栏：Electron 可拖拽；按钮放 actions，自带 app-no-drag -->
  <header class="app-drag shrink-0 border-b border-border bg-paper-deep px-1 py-2">
    <div class="flex h-12 items-center gap-2 px-4">
      <slot name="leading" />
      <div class="min-w-0 flex-1">
        <slot name="title" />
        <slot name="subtitle" />
      </div>
      <slot name="actions" />
    </div>
  </header>
</template>
