@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
    echo Error: npm is not in your PATH. Install Node.js 20 or newer from https://nodejs.org/
    pause
    exit /b 1
)

if not exist ".env" (
    echo Error: .env not found.
    echo Copy .env.example to .env and fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
    pause
    exit /b 1
)

findstr /c:"your-google-oauth-client-id" .env >nul
if not errorlevel 1 (
    echo Error: .env still contains placeholder values.
    echo Edit .env and replace GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET with real values from Google Cloud Console.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo Starting Safe Photo Browser at http://localhost:5173
echo Press Ctrl+C to stop.
echo.

start "" /b cmd /c "ping 127.0.0.1 -n 6 >nul && start http://localhost:5173"

call npm run dev

endlocal
