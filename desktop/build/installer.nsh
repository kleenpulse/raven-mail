; Picked up by electron-builder's NSIS target (buildResources/installer.nsh).

; Uninstalling removes what Raven wrote for links (main.ts): raven:// and,
; if the user asked for it, its listing as an email app. An update runs the
; old uninstaller too, and must keep them, or a Raven the user chose for
; email links would drop out of Windows' list.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\raven"
    DeleteRegKey HKCU "Software\Classes\Raven.mailto"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Raven"
    DeleteRegKey HKCU "Software\Raven\Capabilities"
    DeleteRegKey /ifempty HKCU "Software\Raven"
  ${endIf}
!macroend
