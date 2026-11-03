## 安装注意事项 / Install notes

当前桌面端尚未完成代码签名与公证，系统可能拦截安装或首次打开。请先确认安装包来自 [AgentUp 下载页](https://agentup.me/download) 或本 Release 附件。

AgentUp is not code-signed / notarized yet. Your OS may block install or first launch. Only continue if the file came from the [download page](https://agentup.me/download) or this Release.

### macOS

安装到「应用程序」后，请在终端执行：

```bash
xattr -cr /Applications/AgentUp.app
```

否则 Gatekeeper 可能提示存在风险，并建议移到废纸篓，应用无法正常打开。

After installing into Applications, run the command above in Terminal. Otherwise macOS may warn about an unidentified developer and offer to move the app to Trash.

### Windows

未签名安装包可能被 **智能应用控制（Smart App Control）** 或 **SmartScreen** 拦截。这通常不是病毒判定，而是「未验证发布者」。

Unsigned setup may be blocked by **Smart App Control** or **SmartScreen**. That usually means an unverified publisher, not a malware verdict by itself.

**「Windows 已保护你的电脑」**

1. 出现「Windows 已保护你的电脑」时，点「更多信息」。
2. 再点「仍要运行」。
3. 若没有「仍要运行」：右键安装包 → 属性 → 常规 → 勾选「解除锁定」→ 确定后重试。

**智能应用控制 / Smart App Control**

该功能通常**不能**给单个软件开例外。确认来自官网后：

1. 先关掉拦截弹窗。
2. 在任务栏搜索「智能应用控制」或打开 **Windows 安全中心** → **应用和浏览器控制** → **智能应用控制** 设置。
3. 选择「关闭 / Off」（部分系统关闭后不易再打开；Defender 等其它防护一般仍可用）。
4. 再双击 AgentUp 安装包。

图文步骤（中文）：https://agentup.me/zh/guide/windows-install-problem  
Illustrated steps (English)：https://agentup.me/guide/windows-install-problem

---

## Changes

<!-- softprops/action-gh-release 会在下方追加自动生成的提交说明 -->
