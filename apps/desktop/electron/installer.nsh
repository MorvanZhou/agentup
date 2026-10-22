; Windows NSIS：安装期展开 runtime/node_modules.tgz
;
; 背景（详见 electron/pack-runtime-modules.cjs 文件头）
; - 松散 node_modules 上万小文件会让 NSIS 逐文件解压极慢 → 安装包内只放一个 .tgz
; - win 打包必须 follow=true（实体文件）：Windows tar 不能在目标未存在时建 symlink，
;   否则会出现大量 Cannot create symlink ... No such file or directory
; - .tgz 已是 gzip，须在 package.json build.nsis.preCompressedFileExtensions 中列入
;   ".tgz"，避免 NSIS 再压一遍（白费 CPU，安装也不更快）
; - 若 tar 仍失败，Desktop 首次启动 ensure-runtime-modules 会再试一次

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
