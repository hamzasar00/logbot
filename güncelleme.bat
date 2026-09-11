@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Discord Log Bot - Guncelleme

echo.
echo Discord Log Bot guncellemesi basliyor...
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo Git bulunamadi. Git kurulumunu kontrol edin.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm bulunamadi. Node.js 22 veya 24 LTS kurulumunu kontrol edin.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Bu klasor bir Git deposu degil.
  echo Guncelleme icin projeyi GitHub'dan clone etmeniz gerekir.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo package.json bulunamadi.
  pause
  exit /b 1
)

echo GitHub'dan son degisiklikler aliniyor...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Guncelleme yapilamadi. Yerel degisiklik veya Git uyusmazligi olabilir.
  echo Yerel degisiklikleri kontrol edip tekrar deneyin.
  pause
  exit /b 1
)

echo.
echo Bagimliliklar guncelleniyor...
call npm install
if errorlevel 1 (
  echo.
  echo npm install basarisiz oldu.
  pause
  exit /b 1
)

echo.
echo Guncelleme tamamlandi.
echo Botu baslatmak icin baslat.bat dosyasini calistirin.
pause
