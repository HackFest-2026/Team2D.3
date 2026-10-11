# ============================================================
#  SentinelAI - One-Click Full Stack Launcher
#  Run this script from PowerShell.
#  It opens 4 windows and the browser automatically.
# ============================================================

$ROOT      = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND   = Join-Path $ROOT "backend"
$AGENT     = Join-Path $ROOT "agent"
$DASHBOARD = Join-Path $ROOT "dashboard"
$TOKEN     = "hackfest-super-secret-token"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   SentinelAI - Starting All Services         " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Backend
Write-Host "[1/4] Starting Backend (port 8000)..." -ForegroundColor Yellow
$backendCmd = "`$env:AGENT_TOKEN='$TOKEN'; Set-Location '$BACKEND'; python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal
Start-Sleep -Seconds 5

# 2. Agent
Write-Host "[2/4] Starting Agent (file monitor)..." -ForegroundColor Yellow
$agentCmd = "`$env:AGENT_TOKEN='$TOKEN'; Set-Location '$AGENT'; python main.py"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd -WindowStyle Normal
Start-Sleep -Seconds 3

# 3. Dashboard
Write-Host "[3/4] Starting Dashboard (port 5173)..." -ForegroundColor Yellow
$dashboardCmd = "Set-Location '$DASHBOARD'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $dashboardCmd -WindowStyle Normal
Start-Sleep -Seconds 4

# 4. Auto-Demo
Write-Host "[4/4] Starting Auto-Demo (real-time attack loop)..." -ForegroundColor Yellow
$demoCmd = "Set-Location '$ROOT'; python auto_demo.py"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $demoCmd -WindowStyle Normal
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "   All services launched successfully!        " -ForegroundColor Green
Write-Host "   Dashboard: http://localhost:5173           " -ForegroundColor Green
Write-Host "   Backend:   http://localhost:8000           " -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:5173"
