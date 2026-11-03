; Windows NSIS：安装期展开 runtime/node_modules.tgz；卸载可选全清本机数据
;
; 背景（详见 electron/pack-runtime-modules.cjs 文件头）
; - 松散 node_modules 上万小文件会让 NSIS 逐文件解压极慢 → 安装包内只放一个 .tgz
; - win 打包必须 follow=true（实体文件）：Windows tar 不能在目标未存在时建 symlink，
;   否则会出现大量 Cannot create symlink ... No such file or directory
; - .tgz 已是 gzip，须在 package.json build.nsis.preCompressedFileExtensions 中列入
;   ".tgz"，避免 NSIS 再压一遍（白费 CPU，安装也不更快）
; - 若 tar 仍失败，Desktop 首次启动 ensure-runtime-modules 会再试一次
;
; 覆盖更新关进程（customCheckAppRunning）：
; - 打包态 Desktop + runtime 都是 AgentUp.exe（runtime 用 ELECTRON_RUN_AS_NODE）
; - 安装器并不会「新开」这两个进程；任务管理器里看到的是旧实例（有窗 UI + 无窗 runtime）
; - electron-builder 默认软关 / Stop-Process 不带 /T，无窗 runtime 与孤儿子进程常关不掉
;   → 弹出「无法关闭，请手动关闭…」；这里 taskkill /F /T（目录匹配 + 镜像名兜底）
;
; 本机数据清理策略（与应用内 Erase All Local Data 无关）：
; - 安装 / 覆盖更新：从不提供清数据；更新卸旧版走 /S + --updated，一律保留
; - 手动卸载：欢迎页勾选「同时删除本机数据」，默认不勾 = 保留；勾选才清
; - 静默卸载（/S）：无 UI，默认保留
;
; 注意：customUn* 写进本版 Uninstall.exe；改动能在「本版被卸 / 被下一版更新」时才生效。
;
; Var / Function un.* 必须：
; 1) 包在 BUILD_UNINSTALLER（避免安装包编译 warning 6001/6020）
; 2) Var 声明在 Function 之前（勿放 customHeader：insert 太晚，Pop 会报
;    Usage: Pop $(user_var: output)）

!include "nsDialogs.nsh"

; 覆盖默认 CHECK_APP_RUNNING：强杀 AgentUp.exe 进程树（UI + runtime）
!macro customCheckAppRunning
  DetailPrint "Stopping ${PRODUCT_NAME} (UI + runtime)..."
  StrCpy $R1 0
  agentup_stop_loop:
    IntOp $R1 $R1 + 1
    ; 优先按安装目录（有 ExecutablePath 时），减少误伤其它路径同名程序
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [stringcomparison]::OrdinalIgnoreCase) } | ForEach-Object { & taskkill.exe /F /T /PID $$_.ProcessId 2>$$null | Out-Null }; exit 0"`
    Pop $R0
    ; 再按镜像名树杀：盖住 ExecutablePath 为空、PS 策略失败、无窗 runtime 孤儿
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $R0
    Sleep 1000
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R0
    ${if} $R0 == 0
      ${if} $R1 >= 3
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY agentup_stop_loop
        Quit
      ${else}
        Sleep 1500
        Goto agentup_stop_loop
      ${endIf}
    ${endIf}
!macroend

!ifdef BUILD_UNINSTALLER
  Var agentupDeleteDataCheckbox
  Var agentupDeleteData

  Function un.AgentupUnWelcomeShow
    ${NSD_CreateCheckbox} 120u -18u 100% 12u "Also delete all AgentUp local data"
    Pop $agentupDeleteDataCheckbox
    SetCtlColors $agentupDeleteDataCheckbox "" "${MUI_BGCOLOR}"
    ; 默认不勾选 = 保留聊天 / 密钥 / 登录态等
  FunctionEnd

  Function un.AgentupUnWelcomeLeave
    ${NSD_GetState} $agentupDeleteDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $agentupDeleteData "1"
    ${Else}
      StrCpy $agentupDeleteData "0"
    ${EndIf}
  FunctionEnd
!endif

!macro customUnInit
  ; 静默 / 未走过欢迎页 leave 时保持「不删」
  StrCpy $agentupDeleteData "0"
!macroend

; 卸载欢迎页底部勾选；默认不勾
!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.AgentupUnWelcomeShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.AgentupUnWelcomeLeave
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customInstall
  DetailPrint "Expanding runtime node_modules..."
  IfFileExists "$INSTDIR\resources\runtime\node_modules.tgz" 0 agentup_skip_runtime_tgz
    nsExec::ExecToLog 'tar.exe -xzf "$INSTDIR\resources\runtime\node_modules.tgz" -C "$INSTDIR\resources\runtime"'
    Pop $0
    StrCmp $0 "0" 0 agentup_tgz_fail
      Delete "$INSTDIR\resources\runtime\node_modules.tgz"
      DetailPrint "runtime node_modules expanded"
      Goto agentup_skip_runtime_tgz
    agentup_tgz_fail:
      DetailPrint "tar expand failed; app will expand on first launch"
  agentup_skip_runtime_tgz:
!macroend

!macro customUnInstall
  ; 更新链路（isUpdated）或未勾选：保留数据
  ${If} ${isUpdated}
    Goto agentup_keep_data
  ${EndIf}
  StrCmp $agentupDeleteData "1" 0 agentup_keep_data

    ClearErrors
    FileOpen $R0 "$APPDATA\AgentUp\data-root.path" r
    IfErrors agentup_wipe_default_root
      FileRead $R0 $R1
      FileClose $R0
      ; FileRead 可能带尾部 CR/LF；内联去掉
      agentup_trim_loop:
        StrCpy $R2 $R1 1 -1
        StrCmp $R2 "$\r" agentup_trim_cut
        StrCmp $R2 "$\n" agentup_trim_cut
        Goto agentup_trim_done
        agentup_trim_cut:
          StrCpy $R1 $R1 -1
          Goto agentup_trim_loop
      agentup_trim_done:
      StrCmp $R1 "" agentup_wipe_default_root 0
      DetailPrint "Removing agent data root $R1"
      RMDir /r "$R1"
      Goto agentup_wipe_userdata
    agentup_wipe_default_root:
      DetailPrint "Removing $PROFILE\.agentup"
      RMDir /r "$PROFILE\.agentup"
    agentup_wipe_userdata:
      DetailPrint "Removing $APPDATA\AgentUp"
      RMDir /r "$APPDATA\AgentUp"
  agentup_keep_data:
!macroend
