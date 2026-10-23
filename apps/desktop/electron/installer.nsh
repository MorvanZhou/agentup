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
; 卸载：默认保留数据。用户选 Yes 时删除真实业务根（优先读 userData\data-root.path）
; 与 Electron userData（含登录态、日志）。
;
; 勿在本文件顶层定义 Function un.*：打包 installer 时会触发 warning 6020
; （Uninstaller script code found but WriteUninstaller never used），且 electron-builder
; 将 warning 当错误。去换行逻辑内联在 customUnInstall 内。

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
  ; 默认 No：保留本机数据，便于重装恢复
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete all AgentUp local data?$\r$\n$\r$\nThis permanently removes chat history, local agents, every agent's work files and outputs, saved API keys, sign-in state, and logs. This cannot be undone." \
    IDNO agentup_keep_data
    ClearErrors
    FileOpen $R0 "$APPDATA\AgentUp\data-root.path" r
    IfErrors agentup_wipe_default_root
      FileRead $R0 $R1
      FileClose $R0
      ; FileRead 可能带尾部 CR/LF；内联去掉（勿用顶层 un.Function）
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
