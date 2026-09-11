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

if not exist "package.json" (
  echo package.json bulunamadi.
  pause
  exit /b 1
)

if not exist ".git" (
  echo.
  echo Bu klasor ZIP'ten kurulmus. Ilk GitHub baglantisi kuruluyor...
  echo Uyari: Proje dosyalari V4 ile esitlenecek.
  echo .env ve data klasoru korunacak.
  echo.

  git init
  if errorlevel 1 (
    echo Git deposu baslatilamadi.
    pause
    exit /b 1
  )

  git remote add origin https://github.com/hamzasar00/logbot.git
  if errorlevel 1 (
    echo GitHub uzak deposu eklenemedi.
    pause
    exit /b 1
  )

  echo V4 dosyalari aliniyor...
  git fetch origin V4
  if errorlevel 1 (
    echo GitHub'dan V4 branch'i alinamadi.
    pause
    exit /b 1
  )

  git checkout -B V4 origin/V4 --force
  if errorlevel 1 (
    echo V4 branch'i etkinlestirilemedi.
    pause
    exit /b 1
  )

  if not exist "node_modules" (
    echo Ilk bagimlilik kurulumu yapiliyor...
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
      echo Bagimlilik kurulumu basarisiz oldu.
      pause
      exit /b 1
    )
  )

  echo Ilk GitHub baglantisi tamamlandi.
)

for /f "delims=" %%A in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%A"
if /I not "%CURRENT_BRANCH%"=="V4" (
  echo Bu guncelleme dosyasi V4 branch'i icin hazirlandi.
  echo Mevcut branch: %CURRENT_BRANCH%
  pause
  exit /b 1
)

for /f "delims=" %%A in ('git rev-parse HEAD 2^>nul') do set "OLD_COMMIT=%%A"
if not defined OLD_COMMIT (
  echo Mevcut commit bilgisi okunamadi.
  pause
  exit /b 1
)

echo GitHub'dan sadece yeni degisiklikler aliniyor...
git pull --ff-only origin V4
if errorlevel 1 (
  echo.
  echo Guncelleme yapilamadi. Yerel degisiklik veya Git uyusmazligi olabilir.
  echo Yerel degisiklikleri kontrol edip tekrar deneyin.
  pause
  exit /b 1
)

for /f "delims=" %%A in ('git rev-parse HEAD 2^>nul') do set "NEW_COMMIT=%%A"
if /I "%OLD_COMMIT%"=="%NEW_COMMIT%" (
  echo Zaten guncel. Yeni degisiklik yok.
  goto :done
)

git diff --name-only "%OLD_COMMIT%" "%NEW_COMMIT%" | findstr /I /R /C:"^package.json$" /C:"^package-lock.json$" >nul
if errorlevel 1 (
  echo Kod guncellendi. Paketlerde degisiklik yok; npm kurulumu atlandi.
  goto :done
)

echo package.json veya package-lock.json degisti.
echo Sadece gerekli paketler guncelleniyor...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Paket guncellemesi basarisiz oldu.
  pause
  exit /b 1
)

:done
echo.
echo Guncelleme tamamlandi.
echo Bot calisiyorsa degisikliklerin uygulanmasi icin kapatip baslat.bat dosyasini calistirin.
pause
exit /b 0
