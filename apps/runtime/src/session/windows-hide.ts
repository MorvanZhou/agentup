/**
 * Windows 子进程是否应带 windowsHide（→ CREATE_NO_WINDOW）。
 *
 * - GUI / 无控制台宿主：必须 hide，否则 bash/powershell/cmd 会弹黑框。
 * - 已有可继承控制台（TTY，或 Desktop 挂了隐藏控制台）：不要 hide，
 *   否则孙子 console 进程（npm.cmd→cmd、git）会各自新开 conhost 闪窗
 *   （对齐 earendil-works/pi#8846）。
 */
export function shouldWindowsHideChild(options?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean | undefined;
}): boolean {
  const platform = options?.platform ?? process.platform;
  if (platform !== "win32") return false;
  const env = options?.env ?? process.env;
  if (env.AGENTUP_HIDDEN_CONSOLE === "1") return false;
  const isTTY = options?.stdoutIsTTY ?? Boolean(process.stdout?.isTTY);
  if (isTTY) return false;
  return true;
}
