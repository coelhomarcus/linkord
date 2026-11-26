; overcord:// links (src/main/deepLink.ts). electron-builder's NSIS target does
; not write `protocols`, so the installer registers the scheme itself, per
; user like the install, the same key app.setAsDefaultProtocolClient writes.
; The app registers it again on every start: that takes it back after a
; development run with --register-protocol.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\overcord" "" "URL:Overcord"
  WriteRegStr HKCU "Software\Classes\overcord" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\overcord\DefaultIcon" "" "$appExe,0"
  WriteRegStr HKCU "Software\Classes\overcord\shell\open\command" "" '"$appExe" "%1"'
!macroend

; An update runs the old uninstaller first: the key stays for the new version
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\overcord"
  ${endIf}
!macroend
