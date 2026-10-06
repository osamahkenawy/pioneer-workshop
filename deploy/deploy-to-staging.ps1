# ============================================================
#  deploy-to-staging.ps1
#  Deploys car-workshop to staging server via SSH key
#
#  Usage:
#    .\deploy-to-staging.ps1 -KeyFile "C:\path\to\key.ppk"   (PuTTY key)
#    .\deploy-to-staging.ps1 -KeyFile "C:\path\to\key.pem"   (OpenSSH key)
#    .\deploy-to-staging.ps1   (will prompt for key path)
# ============================================================
param(
    [string]$KeyFile = ""
)

$SERVER_IP  = "130.61.83.110"
$SSH_USER   = "ubuntu"
$DEPLOY_DIR = "C:\Users\osamah.kenawy\Desktop\pioneer\car-workshp\deploy"

# ── Prompt for key if not supplied ───────────────────────────
if (-not $KeyFile) {
    $KeyFile = Read-Host "Enter full path to SSH key file (.ppk or .pem)"
}
if (-not (Test-Path $KeyFile)) {
    Write-Error "Key file not found: $KeyFile"
    exit 1
}
Write-Host "Using key: $KeyFile" -ForegroundColor Cyan

$isPpk = $KeyFile -match '\.ppk$'

if ($isPpk) {
    # ── PuTTY mode (plink / pscp) ─────────────────────────────
    $plink = (Get-Command plink -ErrorAction SilentlyContinue)?.Source
    if (-not $plink) { $plink = "C:\Program Files\PuTTY\plink.exe" }
    if (-not (Test-Path $plink)) { $plink = "C:\Program Files (x86)\PuTTY\plink.exe" }
    $pscp = (Get-Command pscp -ErrorAction SilentlyContinue)?.Source
    if (-not $pscp) { $pscp = "C:\Program Files\PuTTY\pscp.exe" }
    if (-not (Test-Path $pscp)) { $pscp = "C:\Program Files (x86)\PuTTY\pscp.exe" }
    if (-not (Test-Path $plink)) {
        Write-Error "plink.exe not found. Install PuTTY from https://www.putty.org/"
        exit 1
    }
    function SSH($cmd) {
        & $plink -i $KeyFile -batch "${SSH_USER}@${SERVER_IP}" $cmd
        if ($LASTEXITCODE -ne 0) { Write-Warning "SSH exited $LASTEXITCODE" }
    }
    function SCP($localFile, $remotePath) {
        & $pscp -i $KeyFile -batch $localFile "${SSH_USER}@${SERVER_IP}:${remotePath}"
    }
} else {
    # ── OpenSSH mode (Windows built-in ssh.exe / scp.exe) ────
    $sshExe = (Get-Command ssh -ErrorAction SilentlyContinue)?.Source
    $scpExe = (Get-Command scp -ErrorAction SilentlyContinue)?.Source
    if (-not $sshExe) {
        Write-Error "ssh.exe not found. Enable 'OpenSSH Client' in Windows Optional Features."
        exit 1
    }
    function SSH($cmd) {
        & $sshExe -i $KeyFile -o StrictHostKeyChecking=accept-new "${SSH_USER}@${SERVER_IP}" $cmd
        if ($LASTEXITCODE -ne 0) { Write-Warning "SSH exited $LASTEXITCODE" }
    }
    function SCP($localFile, $remotePath) {
        & $scpExe -i $KeyFile -o StrictHostKeyChecking=accept-new $localFile "${SSH_USER}@${SERVER_IP}:${remotePath}"
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Deploying to staging: $SERVER_IP" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ── Step 1: Test connection ───────────────────────────────────
Write-Host "`n[1/5] Testing SSH connection to $SERVER_IP as $SSH_USER..." -ForegroundColor Yellow
SSH "echo 'SSH connection OK'"

# ── Step 2: Upload files ──────────────────────────────────────
Write-Host "`n[2/5] Uploading config files to server..." -ForegroundColor Yellow
SCP "$DEPLOY_DIR\server-setup.sh"          "/tmp/server-setup.sh"
SCP "$DEPLOY_DIR\deploy.sh"               "/tmp/deploy.sh"
SCP "$DEPLOY_DIR\car-workshop-nginx.conf"  "/tmp/car-workshop-nginx.conf"
SCP "$DEPLOY_DIR\backend.staging.env"      "/tmp/backend.env"
Write-Host "  Files uploaded." -ForegroundColor Green

# ── Step 3: One-time server setup (skipped if already done) ──
Write-Host "`n[3/5] Checking if server is already set up..." -ForegroundColor Yellow
$nodeInstalled = SSH "command -v node && echo YES || echo NO" | Select-String "YES"
if (-not $nodeInstalled) {
    Write-Host "  Running server-setup.sh (this takes a few minutes)..." -ForegroundColor Yellow
    SSH "chmod +x /tmp/server-setup.sh && bash /tmp/server-setup.sh"
} else {
    Write-Host "  Server already set up (Node found). Skipping." -ForegroundColor Green
}

# ── Step 4: Run deployment ────────────────────────────────────
Write-Host "`n[4/5] Running deploy.sh on server..." -ForegroundColor Yellow
SSH "chmod +x /tmp/deploy.sh && bash /tmp/deploy.sh"

# ── Step 5: Done ──────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  ✅ Deployment complete!" -ForegroundColor Green
Write-Host "  Frontend: http://workshop.pioneeruae.com" -ForegroundColor Green
Write-Host "  Backend:  http://workshop.pioneeruae.com/api" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
