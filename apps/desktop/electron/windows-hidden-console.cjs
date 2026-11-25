/**
 * Windows：判断主进程是否已有可继承控制台。
 *
 * - 开发态从终端拉起：stdout/stderr 常为 TTY → 返回 true，runtime/bash 勿再
 *   CREATE_NO_WINDOW，否则孙子 cmd/git 会闪 conhost（pi#8846）。
 * - 打包 GUI：通常无 TTY → 返回 false，调用方对 runtime 用 windowsHide。
 *
 * 未引入 FFI：打包态暂不 AllocConsole；隐性执行靠各 spawn 的 windowsHide，
 * 以及禁止 npx.cmd / shell:true。
 */

/**
 * @returns {boolean}
 */
function ensureHiddenConsole() {
  if (process.platform !== "win32") return false;
  return Boolean(process.stdout?.isTTY || process.stderr?.isTTY);
}

module.exports = { ensureHiddenConsole };
