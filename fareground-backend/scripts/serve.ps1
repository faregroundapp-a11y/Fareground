# Runs the backend AND the public tunnel, and restarts either if it dies.
#
#   powershell -File scripts\serve.ps1
#
# WHY THIS EXISTS. During the first tester round the backend went down twice
# and the tunnel once, each time silently, each time taking every tester
# offline until somebody noticed. Nothing was watching either process.
#
# Leave this running in its own window while people are testing. Ctrl-C stops
# both. The live public URL is written to tunnel-url.txt.
#
# THIS IS A STOPGAP, NOT A DEPLOYMENT. A real host removes the tunnel, the
# supervision and the rebuild-on-new-URL problem in one go, and is required
# for Google Play anyway.

$ErrorActionPreference = 'Continue'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

$root = Split-Path -Parent $PSScriptRoot
$urlFile = Join-Path $root 'tunnel-url.txt'
$tunnelLog = Join-Path $env:TEMP 'fg-tunnel.log'
$apiLog = Join-Path $env:TEMP 'fg-backend.log'
$port = 3000

Write-Host ""
Write-Host "  Fareground: backend + tunnel, supervised" -ForegroundColor Green
Write-Host "  API log:    $apiLog"
Write-Host "  URL file:   $urlFile"
Write-Host "  Ctrl-C to stop both."
Write-Host ""

$api = $null
$tunnel = $null

function Start-Api {
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] starting backend..." -ForegroundColor DarkGray
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "npm run dev > `"$apiLog`" 2>&1" `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru
}

function Start-Tunnel {
    Remove-Item $tunnelLog -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath 'cloudflared' `
        -ArgumentList 'tunnel', '--url', "http://localhost:$port", '--logfile', $tunnelLog `
        -PassThru -WindowStyle Hidden

    # The hostname shows up in the log a few seconds after launch.
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 2
        $line = Get-Content $tunnelLog -ErrorAction SilentlyContinue |
                Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1
        if ($line) {
            $url = [regex]::Match($line.ToString(), 'https://[a-z0-9-]+\.trycloudflare\.com').Value
            Set-Content -Path $urlFile -Value $url -Encoding ascii
            Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] tunnel up: $url" -ForegroundColor Green
            Write-Host "            (a NEW url means the app needs rebuilding against it)" -ForegroundColor DarkGray
            break
        }
        if ($p.HasExited) { break }
    }
    return $p
}

try {
    $api = Start-Api
    # Give the API a moment before exposing it, so the first request is not a 502.
    Start-Sleep -Seconds 12
    $tunnel = Start-Tunnel

    while ($true) {
        Start-Sleep -Seconds 10

        # The API is started through cmd.exe, so the handle we hold exits
        # immediately - health is the only honest check.
        $alive = $false
        try {
            $r = Invoke-RestMethod -Uri "http://localhost:$port/health" -TimeoutSec 6
            $alive = ($r.status -eq 'ok')
        } catch { $alive = $false }

        if (-not $alive) {
            Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] backend not answering - restarting" -ForegroundColor Yellow
            $api = Start-Api
            Start-Sleep -Seconds 12
        }

        if ($tunnel -eq $null -or $tunnel.HasExited) {
            Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] tunnel exited - restarting" -ForegroundColor Yellow
            $tunnel = Start-Tunnel
        }
    }
} finally {
    Write-Host "`n  stopping..." -ForegroundColor DarkGray
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like '*tsx*' -or $_.CommandLine -like '*dist/index.js*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
