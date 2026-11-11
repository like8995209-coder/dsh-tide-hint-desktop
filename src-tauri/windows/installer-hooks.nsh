!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext current
  Delete "$DESKTOP\DSH Tide Hint.lnk"
  CreateShortCut "$DESKTOP\DSH 峰谷提示.lnk" "$INSTDIR\dsh-tide-hint-desktop.exe" "" "$INSTDIR\dsh-tide-hint-desktop.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  SetShellVarContext current
  Delete "$DESKTOP\DSH 峰谷提示.lnk"
  Delete "$DESKTOP\DSH Tide Hint.lnk"
!macroend
