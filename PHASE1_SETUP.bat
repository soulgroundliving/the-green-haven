@echo off
REM ============================================================
REM SlipOK Security Migration - Phase 1 Setup Script
REM Run this in PowerShell or Command Prompt from project root
REM ============================================================

echo.
echo 🔐 SlipOK Security Migration - Phase 1 Setup
echo ============================================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo ✓ Node.js is installed
node --version

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: npm is not installed or not in PATH
    pause
    exit /b 1
)

echo ✓ npm is installed
npm --version
echo.

REM Install Firebase CLI globally (if not already installed)
echo 📦 Checking Firebase CLI...
firebase --version >nul 2>&1
if errorlevel 1 (
    echo Installing Firebase CLI globally...
    call npm install -g firebase-tools
    echo ✓ Firebase CLI installed
) else (
    echo ✓ Firebase CLI already installed
    firebase --version
)
echo.

REM Step 1: Install dependencies in functions directory
echo Step 1/3: Installing dependencies in functions/ directory...
cd functions
call npm install
if errorlevel 1 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)
echo ✓ Dependencies installed
cd ..
echo.

REM Step 2: Login to Firebase
echo Step 2/3: Firebase Login (if needed)
echo If you're already logged in, press Enter. Otherwise, sign in with your Google account.
pause
firebase login
echo.

REM Step 3: Set environment variables
echo Step 3/3: Setting SlipOK environment variables in Firebase...
echo.
echo ⚠️  IMPORTANT: Make sure you have these values from your SlipOK account:
echo    - API Key: SLIPOK8P4B99Z (or your new key)
echo    - API URL: https://api.slipok.com/api/line/apikey/62328 (or your URL)
echo.

set /p API_KEY="Enter SlipOK API Key (press Enter to use default): "
if "%API_KEY%"=="" set API_KEY=SLIPOK8P4B99Z

set /p API_URL="Enter SlipOK API URL (press Enter to use default): "
if "%API_URL%"=="" set API_URL=https://api.slipok.com/api/line/apikey/62328

echo.
echo Setting environment variables...
call firebase functions:config:set slipok.api_key="%API_KEY%"
call firebase functions:config:set slipok.api_url="%API_URL%"

echo.
echo ✓ Environment variables set. Verifying:
call firebase functions:config:get
echo.

REM Step 4: Deploy Cloud Function
echo Step 4/4: Deploying Cloud Function to Firebase...
echo.
echo This may take 1-2 minutes...
call firebase deploy --only functions:verifySlip,functions:cleanupRateLimits

if errorlevel 1 (
    echo ❌ Deployment failed. Check the error above.
    pause
    exit /b 1
)

echo.
echo ✅ PHASE 1 COMPLETE!
echo.
echo 📝 NEXT STEPS:
echo    1. Copy your Cloud Function URL from above (looks like: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip)
echo    2. Update SLIPOK_CLOUD_FUNCTION_URL in shared/slipok-secure-client.js
echo    3. Run PHASE2_UPDATE_HTML.bat
echo.
pause
