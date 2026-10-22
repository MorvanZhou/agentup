/**
 * UIMessage → ThreadMessage 转换。
 * assistant-ui 的 AISDKMessageConverter 未从包入口导出，经 Vite alias 引用官方实现，避免自维护一套。
 */
export { AISDKMessageConverter } from "@agentup/aisdk-message-converter";
