@echo off
rem ============================================================================
rem  MiniBrowser portable baslatici
rem  - Kurulum veya yonetici yetkisi gerektirmez (runas / reg / setx KULLANILMAZ).
rem  - Tum veriler (config.json + profil) bu klasordeki MiniBrowserData altinda.
rem  Kullanim:  MiniBrowser.bat [--data-dir=YOL]
rem  Ortam degiskeni: MINIBROWSER_DATA_DIR ile veri klasoru degistirilebilir.
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul 2>&1

set "APP_DIR=%~dp0"
set "DATA_DIR=%APP_DIR%MiniBrowserData"
if defined MINIBROWSER_DATA_DIR set "DATA_DIR=%MINIBROWSER_DATA_DIR%"

if /i "%~1"=="--help" goto :usage
if /i "%~1"=="/?" goto :usage

rem --- ZIP icinden calistirma kontrolu ---------------------------------------
echo "%APP_DIR%" | findstr /i /c:".zip\\" >nul
if not errorlevel 1 (
  echo [HATA] MiniBrowser ZIP arsivinin icinden calistirilamaz.
  echo        Lutfen once arsivi bir klasore cikartin.
  goto :fail
)

rem --- Calistirilabilir dosyayi bul ------------------------------------------
set "EXE="
set "APP_ARG="
if exist "%APP_DIR%MiniBrowser.exe" set "EXE=%APP_DIR%MiniBrowser.exe"
if not defined EXE for %%F in ("%APP_DIR%MiniBrowser-*-portable.exe") do set "EXE=%%~fF"
if not defined EXE if exist "%APP_DIR%node_modules\electron\dist\electron.exe" (
  set "EXE=%APP_DIR%node_modules\electron\dist\electron.exe"
  set "APP_ARG=%APP_DIR%."
)
if not defined EXE (
  echo [HATA] MiniBrowser.exe bulunamadi: "%APP_DIR%"
  echo        Bu dosyayi MiniBrowser.exe ile ayni klasorde tutun.
  echo        Gelistirme modu icin once "npm install" calistirin.
  goto :fail
)

rem --- Veri klasoru yazilabilir mi? ------------------------------------------
if not exist "%DATA_DIR%\" mkdir "%DATA_DIR%" 2>nul
if not exist "%DATA_DIR%\" (
  echo [HATA] Veri klasoru olusturulamadi: "%DATA_DIR%"
  echo        MiniBrowser'i yazma izniniz olan bir klasore tasiyin.
  goto :fail
)
set "PROBE=%DATA_DIR%\.write-test-%RANDOM%"
(echo ok) > "%PROBE%" 2>nul
if not exist "%PROBE%" (
  echo [HATA] Veri klasorune yazilamiyor: "%DATA_DIR%"
  echo        Klasor salt okunur olabilir. Belgeler veya USB bellek gibi bir yere tasiyin.
  goto :fail
)
del /q "%PROBE%" >nul 2>&1

rem --- Baslat ----------------------------------------------------------------
if defined APP_ARG (
  start "" "%EXE%" "%APP_ARG%" --data-dir="%DATA_DIR%" %*
) else (
  start "" "%EXE%" --data-dir="%DATA_DIR%" %*
)
if errorlevel 1 (
  echo [HATA] MiniBrowser baslatilamadi: "%EXE%"
  goto :fail
)
endlocal
exit /b 0

:usage
echo MiniBrowser portable baslatici
echo   MiniBrowser.bat                     Varsayilan veri klasoruyle baslatir
echo   MiniBrowser.bat --data-dir=YOL      Baska bir veri/profil klasoru kullanir
echo   set MINIBROWSER_DATA_DIR=YOL        Ayni islemi ortam degiskeniyle yapar
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
