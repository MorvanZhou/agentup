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
; 覆盖更新（行业常见：整目录挪走 → 干净安装 → 后台删旧）
; - 旧 Uninstall.exe 默认 atomicRMDir：对已展开的 node_modules 逐文件 Rename，极慢；
;   任一文件被占用就 Abort，新安装器重试后弹出误导性的「无法关闭」
; - 卸载器本身不会 StartApp；任务管理器里的 AgentUp 是旧实例/runtime，或杀进程失败残留
; - 本脚本：强杀 → 把整个 $INSTDIR 一次 Rename 到旁路 $INSTDIR.__agentup_old__
;   → 空目录装新版 → customInstall 里 start /b rmdir 后台删旧树
; - customUnInstallCheck 置空：旧 Uninstall 因目录已挪走而找不到文件时，不中止新安装
; - customRemoveFiles：本版 Uninstall 被下一版调用时，同样整目录挪走，不再走 atomicRMDir
;
; 完成页「运行」默认不勾（MUI_FINISHPAGE_RUN_NOTCHECKED；勿用 $mui.FinishPage.Run，CI warning→error）
;
; 本机数据清理策略（与应用内 Erase All Local Data 无关）：
; - 安装 / 覆盖更新：从不提供清数据；更新卸旧版走 /S + --updated，一律保留
; - 手动卸载：欢迎页勾选「同时删除本机数据」，默认不勾 = 保留；勾选才清
; - 静默卸载（/S）：无 UI，默认保留
;
; 注意：customUn* / customRemoveFiles 写进本版 Uninstall.exe；
;       「新安装器侧」整目录挪走在 customCheckAppRunning，对从任意旧版升级立即生效。

!include "nsDialogs.nsh"

!define AGENTUP_OLD_SUFFIX ".__agentup_old__"

; 强杀 UI + runtime（同名 AgentUp.exe 进程树）
!macro agentupKillAppProcesses
  DetailPrint "Stopping ${PRODUCT_NAME} processes (UI + runtime)..."
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and ($$_.ExecutablePath.StartsWith('$INSTDIR', [stringcomparison]::OrdinalIgnoreCase) -or $$_.ExecutablePath.StartsWith('$INSTDIR${AGENTUP_OLD_SUFFIX}', [stringcomparison]::OrdinalIgnoreCase)) } | ForEach-Object { & taskkill.exe /F /T /PID $$_.ProcessId 2>$$null | Out-Null }; exit 0"`
  Pop $R0
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R0
!macroend

!macro agentupAppStillRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop $R0
!macroend

; 整目录挪到旁路（同卷一次 Rename ≈ O(1)），供更新卸载 / 新安装器预清理共用
!macro agentupMoveInstallAside
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    DetailPrint "Moving old install aside (fast upgrade)..."
    IfFileExists "$INSTDIR${AGENTUP_OLD_SUFFIX}" 0 agentup_move_aside
      ; 上次残留：先尽量清掉，避免 Rename 撞名
      nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rmdir /S /Q "$INSTDIR${AGENTUP_OLD_SUFFIX}"`
      Pop $R0
    agentup_move_aside:
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR${AGENTUP_OLD_SUFFIX}"
      IfErrors agentup_move_aside_fail
        CreateDirectory "$INSTDIR"
        DetailPrint "Old install at $INSTDIR${AGENTUP_OLD_SUFFIX}"
        Goto agentup_move_aside_done
      agentup_move_aside_fail:
        DetailPrint "Could not move old install; fallback to uninstaller remove"
    agentup_move_aside_done:
  ${endif}
!macroend

!macro agentupDeleteStaleInBackground
  IfFileExists "$INSTDIR${AGENTUP_OLD_SUFFIX}" 0 agentup_no_stale
    DetailPrint "Deleting previous install in background..."
    ; start /b：不阻塞完成页；旧树再大也不拖住「安装完成」
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C start "" /b rmdir /S /Q "$INSTDIR${AGENTUP_OLD_SUFFIX}"`
    Pop $R0
  agentup_no_stale:
!macroend

; 覆盖默认 CHECK_APP_RUNNING：强杀 + 整目录挪走（不等旧 Uninstall 逐文件）
!macro customCheckAppRunning
  StrCpy $R1 0
  agentup_stop_loop:
    IntOp $R1 $R1 + 1
    !insertmacro agentupKillAppProcesses
    Sleep 2500
    !insertmacro agentupAppStillRunning
    ${if} $R0 == 0
      ${if} $R1 >= 4
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY agentup_stop_loop
        Quit
      ${else}
        Sleep 2000
        Goto agentup_stop_loop
      ${endIf}
    ${endIf}

  !insertmacro agentupMoveInstallAside
!macroend

; 旧目录已挪走时，旧 Uninstall 常找不到文件 / 返回非 0——不要弹失败中止
!macro customUnInstallCheck
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  ClearErrors
!macroend

; 本版 Uninstall 被下一版调用时：整目录挪走，禁止默认 atomicRMDir
!macro customRemoveFiles
  DetailPrint "Removing application files..."
  SetOutPath $TEMP
  ${if} ${isUpdated}
    !insertmacro agentupMoveInstallAside
    ; 旁路目录留给新安装器 customInstall 后台删；此处不再 RMDir /r 堵卸载
  ${else}
    RMDir /r "$INSTDIR"
  ${endif}
!macroend

; 完成页「运行」默认不勾
!macro customFinishPage
  Function AgentupStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "AgentupStartApp"
    !define MUI_FINISHPAGE_RUN_NOTCHECKED
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifdef BUILD_UNINSTALLER
  Var agentupDeleteDataCheckbox
  Var agentupDeleteData

  Function un.AgentupUnWelcomeShow
    ; 欢迎页底部：可选删除本机数据（默认不勾）
    ; 勿 SetCtlColors … ${MUI_BGCOLOR}：未定义/空背景时整行涂成黑条，文案看不见
    ${NSD_CreateCheckbox} 120u -18u 100% 12u "Also delete all AgentUp local data"
    Pop $agentupDeleteDataCheckbox
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
  StrCpy $agentupDeleteData "0"
!macroend

!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.AgentupUnWelcomeShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.AgentupUnWelcomeLeave
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customInstall
  !insertmacro agentupKillAppProcesses
  Sleep 1000

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

  !insertmacro agentupDeleteStaleInBackground
!macroend

!macro customUnInstall
  ${If} ${isUpdated}
    Goto agentup_keep_data
  ${EndIf}
  StrCmp $agentupDeleteData "1" 0 agentup_keep_data

    ClearErrors
    FileOpen $R0 "$APPDATA\AgentUp\data-root.path" r
    IfErrors agentup_wipe_default_root
      FileRead $R0 $R1
      FileClose $R0
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
