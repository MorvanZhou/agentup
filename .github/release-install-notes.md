## 安装注意事项

桌面端尚未代码签名，系统可能拦截安装。请确认安装包来自 [下载页](https://agentup.me/download) 或本 Release。

### macOS

装到「应用程序」后在终端执行：

```bash
xattr -cr /Applications/AgentUp.app
```

### Windows

未签名包可能被 SmartScreen / 智能应用控制拦截。

- 「Windows 已保护你的电脑」→「更多信息」→「仍要运行」；若无该按钮：右键安装包 → 属性 → 勾选「解除锁定」
- 智能应用控制无法单开例外：确认来自官网后，在 Windows 安全中心关闭该功能再重试

图文步骤：https://agentup.me/zh/guide/windows-install-problem

---

## Changes

<!-- softprops/action-gh-release 会在下方追加自动生成的提交说明 -->
