import { ref } from "vue";

/**
 * 设备级 AI 服务配置变更代数。
 * Settings 增删连接 / 启停模型后 bump；会话 Composer 与其它页的 providerSettings 监听后重拉。
 */
export const providerConfigEpoch = ref(0);

export function bumpProviderConfig(): void {
  providerConfigEpoch.value += 1;
}
