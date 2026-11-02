/** 本机 OAuth loopback（oauth-loopback.cjs）的类型；实现仍在 CommonJS。 */
export function createOAuthLoopback(options?: { onOpenApp?: () => void }): {
  start(locale?: "zh" | "en"): Promise<{ loopbackUri: string; port: number }>;
  waitForCode(timeoutMs?: number): Promise<{ code: string }>;
  takePending(): { code: string } | null;
  peekPending(): { code: string } | null;
  cancelWait(): void;
  stop(options?: { clearPending?: boolean }): Promise<void>;
};
