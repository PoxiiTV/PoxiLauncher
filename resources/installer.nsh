; Siempre «solo para mí» (por usuario, sin pedir administrador): sin la página de «¿Para quién se instalará?», ni al
; instalar ni al actualizar desde la app (así la actualización solo enseña el progreso y se vuelve a abrir sola)
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Página final del instalador: "Ejecutar PoxiLauncher" abre la app.
; Al actualizar desde la app, la página final ni se enseña: se ve el progreso y, al terminar,
; PoxiLauncher se vuelve a abrir solo (sin tener que pulsar "Terminar").
!macro customFinishPage
  Function PoxiStartApp
    ExecShell "open" "$launchLink"
  FunctionEnd

  Function PoxiFinishPre
    ${if} ${isUpdated}
      Call PoxiStartApp
      Abort
    ${endIf}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE PoxiFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "PoxiStartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

; Actualizar sin perder el anclado de la barra de tareas. Al actualizar, electron-builder aparta todos los
; archivos del programa antes de instalar la versión nueva: durante ese rato PoxiLauncher.exe no existe y Windows
; quita el anclado (apunta a un programa que ya no está). Es su mismo borrado (con su vuelta atrás si un archivo
; está en uso), pero al actualizar deja una copia del .exe en su sitio hasta que la versión nueva lo sustituye.
; Desinstalar de verdad sigue igual: se borra todo.
!macro customRemoveFiles
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      # Attempt to restore previous directory
      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  # Move out of $INSTDIR so it can be removed
  SetOutPath $TEMP
  # Remove all files (or remaining shallow directories from the block above)
  RMDir /r $INSTDIR

  ${if} ${isUpdated}
    CreateDirectory "$INSTDIR"
    CopyFiles /SILENT "$PLUGINSDIR\old-install\${APP_EXECUTABLE_FILENAME}" "$INSTDIR"
  ${endif}
!macroend

