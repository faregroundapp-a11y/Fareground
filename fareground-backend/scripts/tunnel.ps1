# Keeps a public URL pointing at the local backend, and restarts it when it
# dies. Writes the current URL to tunnel-url.txt so it is always findable.
#
#   powershell -File scripts\tunnel.ps1
#
# WHY THIS EXISTS. The first tunnel was an unsupervised cloudflared quick
# tunnel. It died a few hours in - "no more connections active and exiting" -
# and took every tester offline with no warning and nothing watching.
#
# WHAT THIS DOES AND DOES NOT FIX. cloudflared holds its hostname for as long
# as the PROCESS lives, and reconnects through ordinary network drops by
# itself. So this supervisor covers the common case: a wobble that kills the
# process gets a restart within seconds. It does NOT keep the same URL across
# a process restart - a quick tunnel's hostname is random - so if you see a
# new URL in tunnel-url.txt, the app needs rebuilding against it.
#
# localtunnel was tried for its fixed subdomain and its public service
# returned 503 for every request. Not worth a second attempt.
#
# THE REAL FIX IS A HOST. ~£10-20/month buys a fixed URL that does not need
# any of this, and is required for Google Play anyway.

$ErrorActionPreference = 'Continue'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

$port = 3000
$root = Split-Path -Parent $PSScriptRoot
$urlFile = Join-Path $root 'tunnel-url.txt'
$logFile = Join-Path $env:TEMP 'fg-tunnel.log'

Write-Host ""
Write-Host "  Tunnel supervisor. Ctrl-C to stop." -ForegroundColor Green
Write-Host "  Current URL is written to: $urlFile"
Write-Host ""

$attempt = 0
while ($true) {
    $attempt++
    Remove-Item $logFile -ErrorAction SilentlyContinue

    $proc = Start-Process -FilePath 'cloudflared' `
        -ArgumentList 'tunnel', '--url', "http://localhost:$port", '--logfile', $logFile `
        -PassThru -WindowStyle Hidden

    # The hostname appears in the log a few seconds after launch.
    $url = $null
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 2
        $line = Get-Content $logFile -ErrorAction SilentlyContinue |
                Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' |
                Select-Object -Last 1
        if ($line) {
            $url = [regex]::Match($line.ToString(), 'https://[a-z0-9-]+\.trycloudflare\.com').Value
            break
        }
        if ($proc.HasExited) { break }
    }

    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    if ($url) {
        Set-Content -Path $urlFile -Value $url -Encoding ascii
        Write-Host "[$stamp] up: $url" -ForegroundColor Green
    } else {
        Write-Host "[$stamp] could not read a URL from the log (attempt $attempt)" -ForegroundColor Yellow
    }

    $proc.WaitForExit()
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$stamp] tunnel exited - restarting in 3s (the URL WILL change)" -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
