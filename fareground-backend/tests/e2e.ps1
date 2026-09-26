# ===========================================================================
#  Fareground end-to-end API tests.
#
#  Start the server first (npm run dev), then in another terminal:
#      npm run test:api
#
#  These hit the real HTTP API and the real database. A few tests reach into
#  PostgreSQL directly - to rewind a player's clock, or to grant Walk Points
#  without walking thousands of steps. That is test setup, not the thing under test.
# ===========================================================================
$ErrorActionPreference = 'Stop'

# PowerShell pools only TWO connections per host by default, and this suite
# makes many hundreds of requests; without this it eventually cannot open one
# and reports "Unable to connect" even though the server is fine.
[System.Net.ServicePointManager]::DefaultConnectionLimit = 64
[System.Net.ServicePointManager]::MaxServicePointIdleTime = 2000
$base = 'http://localhost:3000'
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$env:PGPASSWORD = 'postgres'
$pass = 0
$fail = 0

# A unique id per run, so fixtures never measure their own history. The
# device-sharing check counts accounts per device: with a fixed deviceId the
# suite accumulated 54 "owners" of 'pixel-xyz' over many runs and started
# flagging its own honest-walker fixture.
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)

# ---------------------------------------------------------------------------
#  THE ECONOMY NUMBERS THIS SUITE ASSERTS ON.
#
#  These mirror src/game/rules.ts. PowerShell cannot import it, so they are
#  written down once here instead of being scattered through 900 lines of
#  assertions - which is how they came to be a whole rebalance out of date,
#  failing thirteen tests that were really one stale figure repeated.
#
#  WHEN A RATE CHANGES, EDIT THIS BLOCK, NOT THE ASSERTIONS BELOW.
# ---------------------------------------------------------------------------
$RULES = @{
    ParcelBasePrice   = 50      # PARCEL_BASE_PRICE_WP
    AdWalkPoints      = 5       # AD_WALK_POINTS
    MaxWpAdsPerDay    = 20      # MAX_WP_ADS_PER_DAY
    ParcelPriceStep   = 1       # PARCEL_PRICE_STEP_WP - rising again since 2026-09-26
    BoostMultiplier   = 20      # BOOST_MULTIPLIER
    BoostSecondsPerAd = 1200    # BOOST_SECONDS_PER_AD      (20 min)
    BoostBankSeconds  = 14400   # BOOST_MAX_BANKED_SECONDS  (4 h)
    # sustainablePace(60) x 60. NOT 60 x MAX_STEPS_PER_MINUTE: the pace
    # ceiling falls off with duration, so an hour is 200/min rather than the
    # 250/min a human can sprint for one minute.
    HourWindowSteps   = 12000
    UpgradeCostL1     = 25      # PARCEL_UPGRADE_COSTS_WP
    UpgradeCostL2     = 50
    CoinsPerHour      = @{ ROCKY = 1; COAL = 2; AMETHYST = 5; SAPPHIRE = 12; RUBY = 100 }
}

# The welcome bonus is SIGNUP_BONUS_WP = PARCEL_BASE_PRICE_WP in rules.ts -
# derived, so it always buys exactly one parcel. Mirror that here.
$BONUS = $RULES.ParcelBasePrice

# What parcel number n costs (1-based): base + step x parcels already owned.
function Parcel-Price([int]$n) { $RULES.ParcelBasePrice + $RULES.ParcelPriceStep * ($n - 1) }

# One HttpClient for the whole run, so the suite reuses a handful of sockets
# instead of opening one per request. With Invoke-WebRequest (a fresh
# connection each time) this suite eventually ran the machine out of ephemeral
# ports and failed with "Unable to connect" even though the server was fine.
Add-Type -AssemblyName System.Net.Http
$script:http = New-Object System.Net.Http.HttpClient
$script:http.Timeout = [TimeSpan]::FromSeconds(30)

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body, [string]$Token, [hashtable]$ExtraHeaders)

    # HttpMethod has no PATCH constant in .NET Framework, so build it by name.
    $verb = New-Object System.Net.Http.HttpMethod ($Method.ToUpperInvariant())
    $req = New-Object System.Net.Http.HttpRequestMessage ($verb, "$base$Path")
    if ($Token) { $req.Headers.Add('Authorization', "Bearer $Token") }
    if ($ExtraHeaders) { foreach ($k in $ExtraHeaders.Keys) { $req.Headers.Add($k, $ExtraHeaders[$k]) } }
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Compress -Depth 5
        $req.Content = New-Object System.Net.Http.StringContent ($json, [System.Text.Encoding]::UTF8, 'application/json')
    }

    $resp = $script:http.SendAsync($req).GetAwaiter().GetResult()
    $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $parsed = $null
    if ($text) { try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null } }

    # Header names only - that is all the suite checks them for.
    $headerNames = @()
    foreach ($h in $resp.Headers) { $headerNames += $h.Key }
    $status = [int]$resp.StatusCode
    $req.Dispose()
    $resp.Dispose()
    return @{ status = $status; body = $parsed; headers = @{ Keys = $headerNames } }
}

function Sql {
    param([string]$Query)
    & $psql -U postgres -d walkscape -At -c $Query
}

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail)
    if ($Condition) {
        Write-Host "  PASS  $Name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $Name  -> $Detail" -ForegroundColor Red
        $script:fail++
    }
}

# Fresh player. -Wp grants Walk Points directly (test setup, not via the API).
# -AgeHours backdates the account so the plausibility allowance is not the
# thing under test.
function New-Player {
    param([int]$Wp = 0, [double]$AgeHours = 0)
    $s = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() + (Get-Random -Maximum 9999)
    $email = "t$s@example.com"
    $r = Invoke-Api POST '/auth/register' @{ username = "t$s"; email = $email; password = 'walk1000steps' }
    if ($Wp -gt 0) {
        Sql "UPDATE users SET walk_points_balance = $Wp WHERE email = '$email';" | Out-Null
    }
    if ($AgeHours -gt 0) {
        Sql "UPDATE users SET created_at = NOW() - INTERVAL '$AgeHours hours' WHERE email = '$email';" | Out-Null
    }
    return @{ email = $email; token = $r.body.token }
}

# A fresh, almost certainly unclaimed spot on Earth. Parcels are globally
# unique and persist between runs, so tests must never reuse a location.
# Random six-decimal coordinates across a wide band make a clash vanishingly
# unlikely.
function New-Spot {
    param([double]$Accuracy = 5)
    $lat = [Math]::Round((Get-Random -Minimum -5500000 -Maximum 6000000) / 100000.0, 6)
    $lng = [Math]::Round((Get-Random -Minimum -17000000 -Maximum 17000000) / 100000.0, 6)
    return @{ lat = $lat; lng = $lng; accuracyM = $Accuracy }
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$email = "ada$stamp@example.com"
$user  = "ada$stamp"

Write-Host "`n=== 1. Registration ===" -ForegroundColor Cyan
$r = Invoke-Api POST '/auth/register' @{ username = $user; email = $email; password = 'walk1000steps' }
Check '201 Created' ($r.status -eq 201) "got $($r.status)"
Check 'returns a token' ([bool]$r.body.token) 'no token'
Check 'never returns password_hash' ($null -eq $r.body.user.password_hash) 'LEAKED PASSWORD HASH'
Check "starts with the $BONUS WP welcome bonus" ($r.body.user.walkPoints -eq $BONUS) "got $($r.body.user.walkPoints)"
$token = $r.body.token
# Backdate so the burst allowance is not what we are testing in sections 5-6.
Sql "UPDATE users SET created_at = NOW() - INTERVAL '4 hours' WHERE email = '$email';" | Out-Null

Write-Host "`n=== 2. Registration edge cases ===" -ForegroundColor Cyan
$r = Invoke-Api POST '/auth/register' @{ username = $user; email = $email; password = 'walk1000steps' }
Check 'duplicate email -> 409' ($r.status -eq 409) "got $($r.status)"
$r = Invoke-Api POST '/auth/register' @{ username = 'x'; email = 'not-an-email'; password = '123' }
Check 'bad input -> 400' ($r.status -eq 400) "got $($r.status)"
Check 'lists all 3 field errors' ($r.body.details.Count -eq 3) "got $($r.body.details.Count)"

Write-Host "`n=== 3. Login ===" -ForegroundColor Cyan
$r = Invoke-Api POST '/auth/login' @{ email = $email; password = 'walk1000steps' }
Check 'correct password -> 200' ($r.status -eq 200) "got $($r.status)"
$r = Invoke-Api POST '/auth/login' @{ email = $email; password = 'wrong-password' }
Check 'wrong password -> 401' ($r.status -eq 401) "got $($r.status)"
$r = Invoke-Api POST '/auth/login' @{ email = "nobody$stamp@example.com"; password = 'whatever' }
Check 'unknown email -> 401 (no user enumeration)' ($r.status -eq 401) "got $($r.status)"

Write-Host "`n=== 4. Auth guard ===" -ForegroundColor Cyan
$r = Invoke-Api GET '/user/balance'
Check 'no token -> 401' ($r.status -eq 401) "got $($r.status)"
$r = Invoke-Api GET '/user/balance' -Token 'garbage.token.here'
Check 'invalid token -> 401' ($r.status -eq 401) "got $($r.status)"
$r = Invoke-Api POST '/attest/challenge'
Check 'challenge needs auth -> 401' ($r.status -eq 401) "got $($r.status)"

Write-Host "`n=== 5. Step sync: the remainder must not be lost ===" -ForegroundColor Cyan
$r = Invoke-Api POST '/steps/sync' @{ steps = 60 } -Token $token
Check '60 steps -> 0 WP' ($r.body.wpEarned -eq 0) "got $($r.body.wpEarned)"
Check 'all 60 accepted' ($r.body.stepsAccepted -eq 60) "got $($r.body.stepsAccepted)"
Check '40 steps until next WP' ($r.body.stepsUntilNextWalkPoint -eq 40) "got $($r.body.stepsUntilNextWalkPoint)"
Check 'reports 100 steps per WP' ($r.body.stepsPerWalkPoint -eq 100) "got $($r.body.stepsPerWalkPoint)"
$r = Invoke-Api POST '/steps/sync' @{ steps = 60 } -Token $token
Check 'another 60 -> 1 WP (remainder banked!)' ($r.body.wpEarned -eq 1) "got $($r.body.wpEarned)"
Check 'lifetime steps = 120' ($r.body.lifetimeSteps -eq 120) "got $($r.body.lifetimeSteps)"
Check "balance = $($BONUS + 1) WP ($BONUS bonus + 1)" ($r.body.walkPointsBalance -eq ($BONUS + 1)) "got $($r.body.walkPointsBalance)"
Check 'not flagged as a replay' ($r.body.replayed -eq $false) "got $($r.body.replayed)"

Write-Host "`n=== 6. Step sync validation ===" -ForegroundColor Cyan
$r = Invoke-Api POST '/steps/sync' @{ steps = -500 } -Token $token
Check 'negative steps -> 400' ($r.status -eq 400) "got $($r.status)"
$r = Invoke-Api POST '/steps/sync' @{ steps = 1500.5 } -Token $token
Check 'fractional steps -> 400' ($r.status -eq 400) "got $($r.status)"
$r = Invoke-Api POST '/steps/sync' @{ steps = 5000000 } -Token $token
Check 'absurd step count -> 400' ($r.status -eq 400) "got $($r.status)"
$r = Invoke-Api POST '/steps/sync' @{ steps = 100; platform = 'WINDOWS_PHONE'; deviceId = 'x' } -Token $token
Check 'unknown platform -> 400' ($r.status -eq 400) "got $($r.status)"

Write-Host "`n=== 7. Idempotency: a retried sync must not pay twice ===" -ForegroundColor Cyan
$p = New-Player -AgeHours 4
$key = [guid]::NewGuid().ToString()
$first = Invoke-Api POST '/steps/sync' @{ steps = 300 } -Token $p.token -ExtraHeaders @{ 'Idempotency-Key' = $key }
Check 'first call earns 3 WP' ($first.body.wpEarned -eq 3) "got $($first.body.wpEarned)"
Check 'first call is not a replay' ($first.body.replayed -eq $false) "got $($first.body.replayed)"
$retry = Invoke-Api POST '/steps/sync' @{ steps = 300 } -Token $p.token -ExtraHeaders @{ 'Idempotency-Key' = $key }
Check 'retry is recognised as a replay' ($retry.body.replayed -eq $true) "got $($retry.body.replayed)"
Check 'retry does NOT add more steps' ($retry.body.lifetimeSteps -eq 300) "got $($retry.body.lifetimeSteps)"
Check "balance still $($BONUS + 3) WP, not $($BONUS + 6)" ($retry.body.walkPointsBalance -eq ($BONUS + 3)) "got $($retry.body.walkPointsBalance)"
# A different key on the same payload IS a new batch of steps.
$fresh = Invoke-Api POST '/steps/sync' @{ steps = 100 } -Token $p.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
Check 'a new key is treated as new steps' ($fresh.body.walkPointsBalance -eq ($BONUS + 4)) "got $($fresh.body.walkPointsBalance)"
$dbRows = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');")
Check 'only 2 step_logs rows written (not 3)' ($dbRows -eq 2) "got $dbRows"

Write-Host "`n=== 8. Plausibility: the sliding window ===" -ForegroundColor Cyan
$p = New-Player   # brand-new account: one hour of allowance
$win = $RULES.HourWindowSteps
$r = Invoke-Api POST '/steps/sync' @{ steps = 50000 } -Token $p.token
Check 'claim of 50,000 steps is truncated' ($r.body.stepsAccepted -lt 50000) "got $($r.body.stepsAccepted)"
Check "accepts one window of $win" ($r.body.stepsAccepted -eq $win) "got $($r.body.stepsAccepted)"
Check "rejects the other $(50000 - $win)" ($r.body.stepsRejected -eq (50000 - $win)) "got $($r.body.stepsRejected)"
Check 'reports RATE_LIMIT' ($r.body.limit -eq 'RATE_LIMIT') "got $($r.body.limit)"
$logged = [int](Sql "SELECT rejected_steps FROM step_logs WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');")
Check 'the refusal is recorded as evidence' ($logged -eq (50000 - $win)) "got $logged"
# The window is already spent, so an immediate retry gets nothing.
$r = Invoke-Api POST '/steps/sync' @{ steps = 1000 } -Token $p.token
Check 'window spent -> 0 accepted' ($r.body.stepsAccepted -eq 0) "got $($r.body.stepsAccepted)"

Write-Host "`n=== 9. Plausibility: an honest offline day is NOT punished ===" -ForegroundColor Cyan
$p = New-Player -AgeHours 10
$r = Invoke-Api POST '/steps/sync' @{ steps = 12000 } -Token $p.token
Check '12,000 steps after 10h offline all accepted' ($r.body.stepsAccepted -eq 12000) "got $($r.body.stepsAccepted)"
Check 'nothing rejected' ($r.body.stepsRejected -eq 0) "got $($r.body.stepsRejected)"
Check 'earns the full 120 WP' ($r.body.wpEarned -eq 120) "got $($r.body.wpEarned)"

Write-Host "`n=== 10. Plausibility: daily cap ===" -ForegroundColor Cyan
# A full day away stretches the window, so one big catch-up sync is allowed.
$p = New-Player -AgeHours 24
$r = Invoke-Api POST '/steps/sync' @{ steps = 59000 } -Token $p.token
Check '59,000 accepted after a day away' ($r.body.stepsAccepted -eq 59000) "got $($r.body.stepsAccepted)"
Check 'nothing rejected' ($r.body.stepsRejected -eq 0) "got $($r.body.stepsRejected)"
# Backdate that sync two hours so the HOURLY window is clear and only the
# 24-hour cap can bind - otherwise we would just be retesting section 8.
Sql "UPDATE step_logs SET logged_at = NOW() - INTERVAL '2 hours' WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');" | Out-Null
$r = Invoke-Api POST '/steps/sync' @{ steps = 10000 } -Token $p.token
Check 'capped to the 1,000 left in the daily budget' ($r.body.stepsAccepted -eq 1000) "got $($r.body.stepsAccepted)"
Check 'reports DAILY_LIMIT' ($r.body.limit -eq 'DAILY_LIMIT') "got $($r.body.limit)"
Sql "UPDATE step_logs SET logged_at = NOW() - INTERVAL '2 hours' WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');" | Out-Null
$r = Invoke-Api POST '/steps/sync' @{ steps = 5000 } -Token $p.token
Check 'daily budget spent -> 0 accepted' ($r.body.stepsAccepted -eq 0) "got $($r.body.stepsAccepted)"
Check 'reports DAILY_LIMIT' ($r.body.limit -eq 'DAILY_LIMIT') "got $($r.body.limit)"
Check 'total never exceeds 60,000' ($r.body.lifetimeSteps -eq 60000) "got $($r.body.lifetimeSteps)"

Write-Host "`n=== 11. Device recording (iOS + Android) ===" -ForegroundColor Cyan
$p = New-Player -AgeHours 4
Invoke-Api POST '/steps/sync' @{ steps = 100; platform = 'IOS'; deviceId = 'iphone-abc' } -Token $p.token | Out-Null
Invoke-Api POST '/steps/sync' @{ steps = 100; platform = 'ANDROID'; deviceId = 'pixel-xyz' } -Token $p.token | Out-Null
Invoke-Api POST '/steps/sync' @{ steps = 100; platform = 'IOS'; deviceId = 'iphone-abc' } -Token $p.token | Out-Null
$devices = [int](Sql "SELECT COUNT(*) FROM devices WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');")
Check 'two devices recorded, not three' ($devices -eq 2) "got $devices"
$platforms = Sql "SELECT string_agg(DISTINCT platform::text, ',' ORDER BY platform::text) FROM devices WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');"
Check 'both IOS and ANDROID stored' ($platforms -eq 'ANDROID,IOS') "got $platforms"

Write-Host "`n=== 12. Attestation challenges are single-use ===" -ForegroundColor Cyan
$p = New-Player -AgeHours 4
$c1 = Invoke-Api POST '/attest/challenge' -Token $p.token
Check 'challenge issued -> 201' ($c1.status -eq 201) "got $($c1.status)"
Check 'nonce is 64 hex chars (32 bytes)' ($c1.body.nonce.Length -eq 64) "got $($c1.body.nonce.Length)"
Check 'has an expiry' ([bool]$c1.body.expiresAt) 'no expiresAt'
$c2 = Invoke-Api POST '/attest/challenge' -Token $p.token
Check 'each challenge is different' ($c1.body.nonce -ne $c2.body.nonce) 'nonce repeated!'
# Spending it: ATTESTATION_MODE=off means the verifier is skipped, but the
# nonce is still consumed first, so the SECOND use must be refused.
$body = @{ steps = 100; platform = 'IOS'; deviceId = 'iphone-1'; attestation = @{ token = 'stub'; nonce = $c1.body.nonce } }
$a1 = Invoke-Api POST '/steps/sync' $body -Token $p.token
Check 'first use of the nonce is accepted' ($a1.status -eq 200) "got $($a1.status) $($a1.body.error)"
$a2 = Invoke-Api POST '/steps/sync' $body -Token $p.token
Check 'replaying the same nonce -> 401' ($a2.status -eq 401) "got $($a2.status)"
Check 'error says the challenge is spent' ($a2.body.error -match 'used|expired|unknown') "got: $($a2.body.error)"
# Another user's nonce must not work either.
$other = New-Player -AgeHours 4
$stolen = @{ steps = 100; platform = 'IOS'; deviceId = 'iphone-2'; attestation = @{ token = 'stub'; nonce = $c2.body.nonce } }
$a3 = Invoke-Api POST '/steps/sync' $stolen -Token $other.token
Check "another user's nonce is rejected" ($a3.status -eq 401) "got $($a3.status)"

Write-Host "`n=== 13. Claiming parcels ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)
$r = Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token
Check 'claim -> 201' ($r.status -eq 201) "got $($r.status)"
Check "first parcel costs $(Parcel-Price 1) WP" ($r.body.walkPointsSpent -eq (Parcel-Price 1)) "got $($r.body.walkPointsSpent)"
Check 'WP deducted to 0' ($r.body.walkPointsBalance -eq 0) "got $($r.body.walkPointsBalance)"
Check "the next one will cost $(Parcel-Price 2) WP" ($r.body.nextParcelPrice -eq (Parcel-Price 2)) "got $($r.body.nextParcelPrice)"
$rarity = $r.body.parcel.rarity
$cph = $r.body.parcel.coinsPerHour
Check "mineral is valid (got $rarity)" (@('ROCKY','COAL','AMETHYST','SAPPHIRE','RUBY') -contains $rarity) "got $rarity"
$expected = $RULES.CoinsPerHour[$rarity]
Check "coinsPerHour matches the mineral ($cph)" ($cph -eq $expected) "expected $expected got $cph"
$dbOk = [int](Sql "SELECT COUNT(*) FROM parcels WHERE rarity::text = '$rarity' AND coins_per_hour = $expected AND owner_id = (SELECT id FROM users WHERE email = '$($p.email)');")
Check 'database stored the matching pair' ($dbOk -eq 1) "got $dbOk"
$r = Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token
Check 'second claim with 0 WP -> 400' ($r.status -eq 400) "got $($r.status)"
Check 'the error names the price' ($r.body.error -match "$(Parcel-Price 2) WP") "got: $($r.body.error)"

Write-Host "`n=== 14. Balance / lazy evaluation ===" -ForegroundColor Cyan
$r = Invoke-Api GET '/user/balance' -Token $p.token
Check 'balance -> 200' ($r.status -eq 200) "got $($r.status)"
Check 'totalParcels = 1' ($r.body.totalParcels -eq 1) "got $($r.body.totalParcels)"
Check 'coinsPerHour matches the parcel' ($r.body.coinsPerHour -eq $cph) "got $($r.body.coinsPerHour)"
Check 'coins is a number, not a string' ($r.body.coins -is [int] -or $r.body.coins -is [long]) "type: $($r.body.coins.GetType().Name)"
Check 'balance reports the next parcel price' ($r.body.parcelPrice -eq (Parcel-Price 2)) "got $($r.body.parcelPrice)"
Check 'balance reports 100 steps per WP' ($r.body.stepsPerWalkPoint -eq 100) "got $($r.body.stepsPerWalkPoint)"
Start-Sleep -Milliseconds 1500
for ($i = 0; $i -lt 5; $i++) { $r = Invoke-Api GET '/user/balance' -Token $p.token }
$frac = [long](Sql "SELECT coin_remainder_micro FROM users WHERE email = '$($p.email)';")
Check 'rapid polling banks the part-coin instead of losing it' ($frac -gt 0) "remainder $frac"
Check 'no whole coins yet (correct, <1hr)' ($r.body.coins -eq 0) "got $($r.body.coins)"

Write-Host "`n=== 15. Passive income actually accrues ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)
$buy = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token).body
$rate = $buy.parcel.coinsPerHour
Sql "UPDATE users SET last_coin_claim_at = NOW() - INTERVAL '3.5 hours', coin_remainder_micro = 0 WHERE email = '$($p.email)';" | Out-Null
$r = Invoke-Api GET '/user/balance' -Token $p.token
$expectedCoins = [Math]::Floor(3.5 * $rate)
Check "3.5h at $rate/hr pays $expectedCoins coins" ($r.body.coins -eq $expectedCoins) "got $($r.body.coins)"
$unpaid = 3.5 * $rate - $expectedCoins
$actualUnpaid = [double](Sql "SELECT coin_remainder_micro / 1000000.0 FROM users WHERE email = '$($p.email)';")
Check "banks the part-coin (~$([Math]::Round($unpaid,3)) coins)" ([Math]::Abs($actualUnpaid - $unpaid) -lt 0.05) "got $([Math]::Round($actualUnpaid,4))"
$r2 = Invoke-Api GET '/user/balance' -Token $p.token
Check 'second call pays nothing extra' ($r2.body.coins -eq $expectedCoins) "got $($r2.body.coins)"

Write-Host "`n=== 15b. Every coin is traceable to a ledger row ===" -ForegroundColor Cyan
# Coins are redeemable for money, so the cached balance must never be the only
# record. These checks are the audit trail working.
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
$ledgerSum = [int](Sql "SELECT COALESCE(SUM(amount),0) FROM coin_ledger WHERE user_id = '$uid';")
$cached = [int](Sql "SELECT coin_balance FROM users WHERE id = '$uid';")
Check 'ledger sum equals the cached balance' ($ledgerSum -eq $cached) "ledger $ledgerSum vs balance $cached"
Check 'ledger is non-empty after earning' ($ledgerSum -gt 0) "got $ledgerSum"
$entry = Sql "SELECT entry_type || '|' || amount || '|' || balance_after || '|' || coins_per_hour FROM coin_ledger WHERE user_id = '$uid' ORDER BY created_at DESC LIMIT 1;"
$parts = $entry -split '\|'
Check 'recorded as an ACCRUAL' ($parts[0] -eq 'ACCRUAL') "got $($parts[0])"
Check 'amount matches what was paid' ([int]$parts[1] -eq $expectedCoins) "got $($parts[1])"
Check 'balance_after matches the balance' ([int]$parts[2] -eq $cached) "got $($parts[2])"
Check 'records the rate it was earned at' ([int]$parts[3] -eq $rate) "got $($parts[3])"
$window = [double](Sql "SELECT EXTRACT(EPOCH FROM (earned_to - earned_from))/3600.0 FROM coin_ledger WHERE user_id = '$uid' ORDER BY created_at DESC LIMIT 1;")
Check 'records the window it covers (3.5h)' ([Math]::Abs($window - 3.5) -lt 0.01) "got $([Math]::Round($window,3))h"
# Asking again earns nothing, so it must not write a row.
$before = [int](Sql "SELECT COUNT(*) FROM coin_ledger WHERE user_id = '$uid';")
Invoke-Api GET '/user/balance' -Token $p.token | Out-Null
$after = [int](Sql "SELECT COUNT(*) FROM coin_ledger WHERE user_id = '$uid';")
Check 'a zero-coin settlement writes no row' ($after -eq $before) "went from $before to $after"

Write-Host "`n=== 15c. The invariant holds across every account ===" -ForegroundColor Cyan
$drift = [int](Sql "SELECT COUNT(*) FROM users u WHERE u.coin_balance <> COALESCE((SELECT SUM(amount) FROM coin_ledger l WHERE l.user_id = u.id), 0);")
Check 'no account drifts from its ledger' ($drift -eq 0) "$drift account(s) disagree"
$neg = [int](Sql "SELECT COUNT(*) FROM coin_ledger WHERE entry_type = 'ACCRUAL' AND amount <= 0;")
Check 'no accrual is zero or negative' ($neg -eq 0) "got $neg"

Write-Host "`n=== 16. A new parcel is not paid retroactively ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)
Sql "UPDATE users SET last_coin_claim_at = NOW() - INTERVAL '10 hours' WHERE email = '$($p.email)';" | Out-Null
$buy = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token).body
$rate = $buy.parcel.coinsPerHour
$r = Invoke-Api GET '/user/balance' -Token $p.token
Check "10 idle hours then buy -> 0 coins (not $([int](10 * $rate)))" ($r.body.coins -eq 0) "got $($r.body.coins)"

Write-Host "`n=== 17. Two parcels stack their rates ===" -ForegroundColor Cyan
# Enough for parcel 1 AND parcel 2, whatever the slope currently is.
$p = New-Player -Wp ((Parcel-Price 1) + (Parcel-Price 2))
$b1 = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token).body
$b2 = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token).body
$r = Invoke-Api GET '/user/balance' -Token $p.token
$sum = $b1.parcel.coinsPerHour + $b2.parcel.coinsPerHour
Check 'totalParcels = 2' ($r.body.totalParcels -eq 2) "got $($r.body.totalParcels)"
Check "coinsPerHour = $sum (sum of both)" ($r.body.coinsPerHour -eq $sum) "got $($r.body.coinsPerHour)"

Write-Host "`n=== 18. No double-spend under concurrent claims ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)   # exactly ONE parcel's worth
$jobs = 1..5 | ForEach-Object {
    $spot = New-Spot | ConvertTo-Json -Compress
    Start-Job -ScriptBlock {
        param($t, $b)
        try {
            $resp = Invoke-WebRequest -Uri 'http://localhost:3000/parcels/claim' -Method POST `
                -Headers @{ Authorization = "Bearer $t" } -Body $b -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 20
            [int]$resp.StatusCode
        } catch { [int]$_.Exception.Response.StatusCode }
    } -ArgumentList $p.token, $spot
}
$codes = $jobs | Wait-Job -Timeout 60 | Receive-Job
$jobs | Remove-Job -Force
$created = @($codes | Where-Object { $_ -eq 201 }).Count
$rejected = @($codes | Where-Object { $_ -eq 400 }).Count
Check 'exactly 1 of 5 concurrent claims succeeded' ($created -eq 1) "got $created (codes: $($codes -join ','))"
Check 'the other 4 were rejected as insufficient' ($rejected -eq 4) "got $rejected"
$r = Invoke-Api GET '/user/balance' -Token $p.token
Check 'only 1 parcel exists' ($r.body.totalParcels -eq 1) "got $($r.body.totalParcels)"
Check 'WP not negative' ($r.body.walkPoints -eq 0) "got $($r.body.walkPoints)"

Write-Host "`n=== 18b. One owner per square, even in a race ===" -ForegroundColor Cyan
# Five DIFFERENT players, each able to afford it, all claim the SAME square at
# once. The unique index must let exactly one through - and the four losers
# must get their Walk Points back, because their transactions rolled back.
$contested = New-Spot | ConvertTo-Json -Compress
$racers = 1..5 | ForEach-Object { New-Player -Wp (Parcel-Price 1) }
$jobs = $racers | ForEach-Object {
    Start-Job -ScriptBlock {
        param($t, $b)
        try {
            $resp = Invoke-WebRequest -Uri 'http://localhost:3000/parcels/claim' -Method POST `
                -Headers @{ Authorization = "Bearer $t" } -Body $b -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 20
            [int]$resp.StatusCode
        } catch { [int]$_.Exception.Response.StatusCode }
    } -ArgumentList $_.token, $contested
}
$codes = $jobs | Wait-Job -Timeout 60 | Receive-Job
$jobs | Remove-Job -Force
Check 'exactly 1 of 5 players won the square' (@($codes | Where-Object { $_ -eq 201 }).Count -eq 1) "codes: $($codes -join ',')"
Check 'the other 4 were told it is taken (409)' (@($codes | Where-Object { $_ -eq 409 }).Count -eq 4) "codes: $($codes -join ',')"
$refunded = @($racers | Where-Object { (Invoke-Api GET '/user/balance' -Token $_.token).body.walkPoints -eq (Parcel-Price 1) }).Count
Check "the 4 losers still have their $(Parcel-Price 1) WP" ($refunded -eq 4) "only $refunded kept their WP"

Write-Host "`n=== 18c. The map: claim, nearby, list ===" -ForegroundColor Cyan
$owner = New-Player -Wp (Parcel-Price 1)0
$spot = New-Spot
$r = Invoke-Api POST '/parcels/claim' $spot -Token $owner.token
Check 'claim returns the cell it resolved' ($null -ne $r.body.parcel.cellX -and $null -ne $r.body.parcel.cellY) 'no cell in response'
Check 'and a readable reference' ($r.body.parcel.cellRef -eq "$($r.body.parcel.cellX):$($r.body.parcel.cellY)") "got $($r.body.parcel.cellRef)"
$cx = $r.body.parcel.cellX; $cy = $r.body.parcel.cellY
$again = Invoke-Api POST '/parcels/claim' $spot -Token $owner.token
Check 'claiming your own square again -> 409' ($again.status -eq 409) "got $($again.status)"
Check 'and says it is already yours' ($again.body.error -match 'already own') "got: $($again.body.error)"
$nb = Invoke-Api GET "/parcels/nearby?lat=$($spot.lat)&lng=$($spot.lng)&radius=100" -Token $owner.token
$hit = @($nb.body.parcels | Where-Object { $_.cellX -eq $cx -and $_.cellY -eq $cy })
Check 'nearby shows the new parcel' ($hit.Count -eq 1) "found $($hit.Count)"
Check 'marked as mine for the owner' ($hit[0].mine -eq $true) "mine=$($hit[0].mine)"
$stranger = New-Player -Wp 100
$nb2 = Invoke-Api GET "/parcels/nearby?lat=$($spot.lat)&lng=$($spot.lng)&radius=100" -Token $stranger.token
$seen = @($nb2.body.parcels | Where-Object { $_.cellX -eq $cx -and $_.cellY -eq $cy })
Check 'a stranger sees it too' ($seen.Count -eq 1) "found $($seen.Count)"
Check 'but not as theirs' ($seen[0].mine -eq $false) "mine=$($seen[0].mine)"
$leaked = @($seen[0].PSObject.Properties.Name | Where-Object { $_ -match 'owner|user|name|email' })
Check 'and learns nothing about who owns it' ($leaked.Count -eq 0) "leaked: $($leaked -join ',')"
$steal = Invoke-Api POST '/parcels/claim' $spot -Token $stranger.token
Check "claiming someone else's square -> 409" ($steal.status -eq 409) "got $($steal.status)"
Check 'and the stranger keeps their WP' ((Invoke-Api GET '/user/balance' -Token $stranger.token).body.walkPoints -eq 100) 'WP was taken'
$vague = Invoke-Api POST '/parcels/claim' (New-Spot -Accuracy 60) -Token $stranger.token
Check 'a 60 m GPS fix is refused (422)' ($vague.status -eq 422) "got $($vague.status)"
Check 'with a reason the player can act on' ($vague.body.error -match 'accurate') "got: $($vague.body.error)"
$mine = Invoke-Api GET '/parcels' -Token $owner.token
Check 'GET /parcels lists what you own' (@($mine.body.parcels | Where-Object { $_.cellX -eq $cx }).Count -eq 1) 'not listed'
$far = Invoke-Api GET "/parcels/nearby?lat=$($spot.lat)&lng=$($spot.lng)&radius=5000" -Token $owner.token
Check 'an oversized radius is refused (400)' ($far.status -eq 400) "got $($far.status)"
$pole = Invoke-Api POST '/parcels/claim' @{ lat = 89.9; lng = 0; accuracyM = 5 } -Token $owner.token
Check 'the North Pole is off the map (400)' ($pole.status -eq 400) "got $($pole.status)"

Write-Host "`n=== 18d. Claiming a neighbouring square (tap to select) ===" -ForegroundColor Cyan
# The reason this exists: at home you are standing on the square you already
# own, so "claim what is under you" could never work there. A claim may now
# name any free square within reach - and the server checks the reach.
$p = New-Player -Wp 300
$spot = New-Spot
$first = Invoke-Api POST '/parcels/claim' $spot -Token $p.token
$cx = $first.body.parcel.cellX; $cy = $first.body.parcel.cellY
Check 'claimed the square underfoot' ($first.status -eq 201) "got $($first.status)"
$again = Invoke-Api POST '/parcels/claim' $spot -Token $p.token
Check 'standing on it again: already yours (409)' ($again.status -eq 409) "got $($again.status)"
$next = @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 5; cellX = $cx + 1; cellY = $cy }
$r = Invoke-Api POST '/parcels/claim' $next -Token $p.token
Check 'the square next door can be claimed from here' ($r.status -eq 201) "got $($r.status): $($r.body.error)"
Check '...and it is the square that was asked for' ($r.body.parcel.cellX -eq ($cx + 1) -and $r.body.parcel.cellY -eq $cy) "got $($r.body.parcel.cellRef)"
$far = @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 5; cellX = $cx + 60; cellY = $cy }
$r = Invoke-Api POST '/parcels/claim' $far -Token $p.token
Check 'a square 60 away is out of reach (422)' ($r.status -eq 422) "got $($r.status)"
Check '...and the message says how far' ($r.body.error -match 'm away') "got: $($r.body.error)"
# Two parcels bought above, from a 300 WP float.
$spentSoFar = (Parcel-Price 1) + (Parcel-Price 2)
Check '...and no WP was spent on it' ((Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints -eq (300 - $spentSoFar)) 'WP changed'
$half = @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 5; cellX = $cx + 2 }
$r = Invoke-Api POST '/parcels/claim' $half -Token $p.token
Check 'cellX without cellY is refused (400)' ($r.status -eq 400) "got $($r.status)"

Write-Host "`n=== 19. Concurrent syncs with the same key pay once ===" -ForegroundColor Cyan
$p = New-Player -AgeHours 4
$key = [guid]::NewGuid().ToString()
$jobs = 1..5 | ForEach-Object {
    Start-Job -ScriptBlock {
        param($t, $k)
        try {
            Invoke-WebRequest -Uri 'http://localhost:3000/steps/sync' -Method POST `
                -Headers @{ Authorization = "Bearer $t"; 'Idempotency-Key' = $k } `
                -Body '{"steps":200}' -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 20 | Out-Null
            'ok'
        } catch { 'err' }
    } -ArgumentList $p.token, $key
}
$jobs | Wait-Job -Timeout 60 | Receive-Job | Out-Null
$jobs | Remove-Job -Force
$r = Invoke-Api GET '/user/balance' -Token $p.token
Check 'five identical concurrent syncs -> 2 WP once' ($r.body.walkPoints -eq ($BONUS + 2)) "got $($r.body.walkPoints)"
$rows = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)');")
Check 'exactly one step_logs row written' ($rows -eq 1) "got $rows"

Write-Host "`n=== 21. Rewarded ads: bonus Walk Points ===" -ForegroundColor Cyan
$p = New-Player
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$t = Invoke-Api POST '/rewards/start' @{ kind = 'WALK_POINTS' } -Token $p.token
Check 'start -> 201 with a ticket' ($t.status -eq 201 -and $t.body.nonce.Length -eq 32) "got $($t.status)"
Check 'ticket names our user id for the ad SDK' ([bool]$t.body.userId) 'no userId'
$c = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'complete grants +5 WP' ($c.body.granted -eq $true -and $c.body.amount -eq 5) "got $($c.body | ConvertTo-Json -Compress)"
$again = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'completing twice is a replay' ($again.body.replayed -eq $true) "got $($again.body.replayed)"
Check '...and pays nothing extra' ((Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints -eq 5) 'paid twice'
$other = New-Player
$steal = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $other.token
Check "another player's ticket is unknown to them (404)" ($steal.status -eq 404) "got $($steal.status)"
$bad = Invoke-Api POST '/rewards/start' @{ kind = 'FREE_MONEY' } -Token $p.token
Check 'unknown reward kind -> 400' ($bad.status -eq 400) "got $($bad.status)"
# One was already watched above; watch the rest of the day's allowance.
for ($i = 0; $i -lt ($RULES.MaxWpAdsPerDay - 1); $i++) {
    $tk = Invoke-Api POST '/rewards/start' @{ kind = 'WALK_POINTS' } -Token $p.token
    Invoke-Api POST '/rewards/complete' @{ nonce = $tk.body.nonce } -Token $p.token | Out-Null
}
$expected = $RULES.MaxWpAdsPerDay * $RULES.AdWalkPoints
$b = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check "$($RULES.MaxWpAdsPerDay) ads -> $expected WP" ($b.walkPoints -eq $expected) "got $($b.walkPoints)"
Check 'none left today' ($b.rewards.walkPoints.adsLeftToday -eq 0) "got $($b.rewards.walkPoints.adsLeftToday)"
$over = Invoke-Api POST '/rewards/start' @{ kind = 'WALK_POINTS' } -Token $p.token
Check 'one more is refused BEFORE it is shown (429)' ($over.status -eq 429) "got $($over.status)"

Write-Host "`n=== 22. Rewarded ads: boosts ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)
$landless = Invoke-Api POST '/rewards/start' @{ kind = 'BOOST' } -Token $p.token
Check 'no land -> no boost ad (409), so nobody watches for nothing' ($landless.status -eq 409) "got $($landless.status)"
Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token | Out-Null
$t = Invoke-Api POST '/rewards/start' @{ kind = 'BOOST' } -Token $p.token
$c = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check "a boost ad grants $($RULES.BoostSecondsPerAd / 60) minutes" ($c.body.amount -eq $RULES.BoostSecondsPerAd) "got $($c.body.amount)"
$b = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check 'the boost is active' ($b.rewards.boost.active -eq $true) "got $($b.rewards.boost.active)"
Check "income shows $($RULES.BoostMultiplier)x" ($b.effectiveCoinsPerHour -eq $RULES.BoostMultiplier * $b.coinsPerHour) "got $($b.effectiveCoinsPerHour) vs $($b.coinsPerHour)"
$t2 = Invoke-Api POST '/rewards/start' @{ kind = 'BOOST' } -Token $p.token
Invoke-Api POST '/rewards/complete' @{ nonce = $t2.body.nonce } -Token $p.token | Out-Null
$b = (Invoke-Api GET '/user/balance' -Token $p.token).body
$twoAds = 2 * $RULES.BoostSecondsPerAd
Check "boosts stack end to end (~$($twoAds / 60) min banked)" ([Math]::Abs($b.rewards.boost.remainingSeconds - $twoAds) -lt 15) "got $($b.rewards.boost.remainingSeconds)"
# Watch however many more it takes to FILL the bank, whatever size it is -
# two ads have already been watched above.
$toFill = [Math]::Ceiling($RULES.BoostBankSeconds / $RULES.BoostSecondsPerAd) - 2
for ($i = 0; $i -lt $toFill; $i++) {
    $tk = Invoke-Api POST '/rewards/start' @{ kind = 'BOOST' } -Token $p.token
    Invoke-Api POST '/rewards/complete' @{ nonce = $tk.body.nonce } -Token $p.token | Out-Null
}
$b = (Invoke-Api GET '/user/balance' -Token $p.token).body
$bank = $RULES.BoostBankSeconds
Check "the bank tops out at $($bank / 3600) hours" ($b.rewards.boost.remainingSeconds -le $bank -and $b.rewards.boost.remainingSeconds -gt $bank - 100) "got $($b.rewards.boost.remainingSeconds)"
# One more, with the bank already full.
#
# TWO different rules can refuse it and at the current setting they coincide:
# MAX_BOOST_ADS_PER_DAY is chosen so that a day's ads fill the bank EXACTLY
# (12 x 15 min = 3 h), so the daily cap (429) and the full bank (409) bite on
# the very same ad. Which one answers first is an implementation detail;
# that the ad is refused is the actual contract, so assert that.
$full = Invoke-Api POST '/rewards/start' @{ kind = 'BOOST' } -Token $p.token
Check 'a full bank refuses another boost ad' ($full.status -eq 409 -or $full.status -eq 429) "got $($full.status)"
$overlaps = [int](Sql "SELECT COUNT(*) FROM boosts a JOIN boosts b ON a.user_id = b.user_id AND a.id < b.id AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at WHERE a.user_id = (SELECT id FROM users WHERE email = '$($p.email)');")
Check 'no two boost windows overlap' ($overlaps -eq 0) "got $overlaps"

Write-Host "`n=== 23. Boosted time really pays double ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)
$rate = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token).body.parcel.coinsPerHour
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
# Two hours unpaid, the second of them boosted: 2h base + 1h extra = 3h of pay.
Sql "UPDATE users SET last_coin_claim_at = NOW() - INTERVAL '2 hours', coin_remainder_micro = 0 WHERE id = '$uid';" | Out-Null
Sql "INSERT INTO boosts (user_id, starts_at, ends_at, multiplier) VALUES ('$uid', NOW() - INTERVAL '1 hour', NOW(), 2);" | Out-Null
$b = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check "2h with 1h boosted at $rate/hr pays $(3 * $rate)" ($b.coins -eq 3 * $rate) "got $($b.coins)"
$bs = [int](Sql "SELECT boosted_seconds FROM coin_ledger WHERE user_id = '$uid' ORDER BY created_at DESC LIMIT 1;")
Check 'the ledger records the boosted hour' ([Math]::Abs($bs - 3600) -lt 5) "got $bs"
$drift = [int](Sql "SELECT COUNT(*) FROM users u WHERE u.coin_balance <> COALESCE((SELECT SUM(amount) FROM coin_ledger l WHERE l.user_id = u.id), 0);")
Check 'still no account drifts from its ledger' ($drift -eq 0) "$drift account(s) disagree"

Write-Host "`n=== 24. Ad verification callback and Google sign-in ===" -ForegroundColor Cyan
$r = Invoke-Api GET '/rewards/ssv?ad_network=1&custom_data=abc&user_id=x&transaction_id=1'
Check 'an unsigned ad callback is refused (400)' ($r.status -eq 400) "got $($r.status)"
$r = Invoke-Api POST '/auth/google' @{ idToken = 'this.is.not-a-real-google-token' }
Check 'a fake Google token is refused, not a crash' ($r.status -eq 401 -or $r.status -eq 503) "got $($r.status)"
$r = Invoke-Api POST '/auth/google' @{ }
Check 'a missing Google token -> 400' ($r.status -eq 400) "got $($r.status)"

Write-Host "`n=== 25. Daily chest and streaks ===" -ForegroundColor Cyan
$p = New-Player
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$tz = Invoke-Api POST '/user/timezone' @{ timeZone = 'Europe/London' } -Token $p.token
Check 'time zone accepted' ($tz.status -eq 200 -and $tz.body.timeZone -eq 'Europe/London') "got $($tz.status)"
$bad = Invoke-Api POST '/user/timezone' @{ timeZone = 'Mars/Olympus_Mons' } -Token $p.token
Check 'unknown time zone -> 400' ($bad.status -eq 400) "got $($bad.status)"
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'a new player has a chest waiting' ($d.daily.available -eq $true -and $d.daily.streak -eq 1) "got $($d.daily | ConvertTo-Json -Compress)"
Check 'four quests offered' (@($d.quests).Count -eq 4) "got $(@($d.quests).Count)"
Check 'badge counts the chest' ($d.claimable -ge 1) "got $($d.claimable)"
$c = Invoke-Api POST '/daily/claim' -Token $p.token
Check 'day 1 chest pays 3 WP' ($c.status -eq 201 -and $c.body.claim.amount -eq 3 -and $c.body.walkPointsBalance -eq 3) "got $($c.body | ConvertTo-Json -Compress)"
$again = Invoke-Api POST '/daily/claim' -Token $p.token
Check 'a second chest the same day -> 409' ($again.status -eq 409) "got $($again.status)"
# Pretend yesterday's chest was day 3 of a streak: today's must be day 4.
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
Sql "UPDATE reward_claims SET local_day = local_day - 1, streak = 3, created_at = NOW() - INTERVAL '10 hours' WHERE user_id = '$uid' AND source = 'DAILY';" | Out-Null
$c2 = Invoke-Api POST '/daily/claim' -Token $p.token
Check 'the streak continues: day 4 pays 6 WP' ($c2.body.streak -eq 4 -and $c2.body.claim.amount -eq 6) "got $($c2.body | ConvertTo-Json -Compress)"
# A gap resets it.
Sql "UPDATE reward_claims SET local_day = local_day - 5, created_at = NOW() - INTERVAL '5 days' WHERE user_id = '$uid' AND source = 'DAILY';" | Out-Null
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'missing days resets the streak to 1' ($d.daily.streak -eq 1 -and $d.daily.available -eq $true) "got $($d.daily | ConvertTo-Json -Compress)"

Write-Host "`n=== 26. Watch an ad to double it ===" -ForegroundColor Cyan
$p = New-Player
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$c = (Invoke-Api POST '/daily/claim' -Token $p.token).body
$t = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $c.claim.id } -Token $p.token
Check 'a double ticket is issued' ($t.status -eq 201) "got $($t.status) $($t.body.error)"
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'the double pays the chest again (+3)' ($g.body.granted -eq $true -and $g.body.amount -eq 3) "got $($g.body | ConvertTo-Json -Compress)"
Check 'balance 6 WP' ((Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints -eq 6) 'wrong balance'
$t2 = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $c.claim.id } -Token $p.token
Check 'a reward can only be doubled once (409)' ($t2.status -eq 409) "got $($t2.status)"
$none = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE' } -Token $p.token
Check 'double without a target -> 400' ($none.status -eq 400) "got $($none.status)"
$other = New-Player
$steal = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $c.claim.id } -Token $other.token
Check "cannot double someone else's reward (404)" ($steal.status -eq 404) "got $($steal.status)"

Write-Host "`n=== 27. Daily quests ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1) -AgeHours 4
$early = Invoke-Api POST '/daily/quests/steps_3k' -Token $p.token
Check 'an unfinished quest cannot be collected (409)' ($early.status -eq 409) "got $($early.status)"
Invoke-Api POST '/steps/sync' @{ steps = 3200 } -Token $p.token | Out-Null
Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token | Out-Null
$d = (Invoke-Api GET '/daily' -Token $p.token).body
$q3 = @($d.quests | Where-Object { $_.key -eq 'steps_3k' })[0]
Check 'walking 3,200 steps finishes the 3,000-step quest' ($q3.ready -eq $true -and $q3.progress -eq 3000) "got $($q3 | ConvertTo-Json -Compress)"
$qc = @($d.quests | Where-Object { $_.key -eq 'claim_1' })[0]
Check 'claiming a parcel finishes that quest' ($qc.ready -eq $true) "got $($qc | ConvertTo-Json -Compress)"
$q8 = @($d.quests | Where-Object { $_.key -eq 'steps_8k' })[0]
Check '8,000-step quest shows progress, not done' ($q8.ready -eq $false -and $q8.progress -eq 3200) "got $($q8 | ConvertTo-Json -Compress)"
$before = (Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints
$r = Invoke-Api POST '/daily/quests/steps_3k' -Token $p.token
Check 'collecting pays the quest reward (+6)' ($r.status -eq 201 -and $r.body.walkPointsBalance -eq $before + 6) "got $($r.body | ConvertTo-Json -Compress)"
$r2 = Invoke-Api POST '/daily/quests/steps_3k' -Token $p.token
Check 'a quest pays once a day (409)' ($r2.status -eq 409) "got $($r2.status)"
$u = Invoke-Api POST '/daily/quests/fly_to_the_moon' -Token $p.token
Check 'unknown quest -> 404' ($u.status -eq 404) "got $($u.status)"

Write-Host "`n=== 28. Weekly step leaderboard by area ===" -ForegroundColor Cyan
$town = "Testville$(Get-Random -Maximum 99999999)"
$a = New-Player -AgeHours 4; $b = New-Player -AgeHours 4; $c = New-Player -AgeHours 4
foreach ($p in @($a, $b, $c)) {
    $r = Invoke-Api POST '/user/area' @{ city = $town; region = "$town-shire"; country = "$town-land" } -Token $p.token
}
Check 'area saved' ($r.status -eq 200 -and $r.body.city -eq $town) "got $($r.status) $($r.body | ConvertTo-Json -Compress)"
$noCountry = Invoke-Api POST '/user/area' @{ city = 'Nowhere' } -Token $a.token
Check 'an area needs a country (400)' ($noCountry.status -eq 400) "got $($noCountry.status)"
Invoke-Api POST '/steps/sync' @{ steps = 3000 } -Token $a.token | Out-Null
Invoke-Api POST '/steps/sync' @{ steps = 2000 } -Token $b.token | Out-Null
Invoke-Api POST '/steps/sync' @{ steps = 1000 } -Token $c.token | Out-Null
$lb = (Invoke-Api GET '/leaderboard?scope=CITY' -Token $b.token).body
Check 'city board names the area' ($lb.areaName -eq "$town, $town-shire") "got $($lb.areaName)"
Check 'three walkers in town' ($lb.walkers -eq 3) "got $($lb.walkers)"
Check 'ranked by steps: 3000, 2000, 1000' (($lb.entries | ForEach-Object { $_.steps }) -join ',' -eq '3000,2000,1000') "got $(($lb.entries | ForEach-Object { $_.steps }) -join ',')"
Check 'the middle walker is 2nd' ($lb.me.rank -eq 2 -and $lb.me.steps -eq 2000) "got $($lb.me | ConvertTo-Json -Compress)"
Check "and is marked as 'you'" (@($lb.entries | Where-Object { $_.you }).Count -eq 1 -and @($lb.entries | Where-Object { $_.you })[0].rank -eq 2) 'wrong you flag'
Check 'too few walkers for prizes yet (needs 5)' ($lb.prizesActive -eq $false -and $lb.minWalkers -eq 5) "got $($lb.prizesActive)"
Check 'prizes: 1st 3x, 2nd 2x, 3rd 2x' ((($lb.prizes | ForEach-Object { $_.multiplier }) -join ',') -eq '3,2,2') 'wrong prizes'
$reg = (Invoke-Api GET '/leaderboard?scope=REGION' -Token $b.token).body
Check 'region board works' ($reg.areaName -eq "$town-shire, $town-land" -and $reg.me.rank -eq 2) "got $($reg.areaName) rank $($reg.me.rank)"
$world = (Invoke-Api GET '/leaderboard?scope=WORLD' -Token $b.token).body
Check 'world board includes you' ($world.me.rank -ge 1 -and $world.areaName -eq 'World') "got $($world.me.rank)"
$lonely = New-Player
$none = (Invoke-Api GET '/leaderboard?scope=CITY' -Token $lonely.token).body
Check 'no area yet -> city board is empty, not an error' ($null -eq $none.areaName -and @($none.entries).Count -eq 0) "got $($none | ConvertTo-Json -Compress -Depth 3)"
$bad = Invoke-Api GET '/leaderboard?scope=GALAXY' -Token $b.token
Check 'unknown board -> 400' ($bad.status -eq 400) "got $($bad.status)"
$leak = @($lb.entries[0].PSObject.Properties.Name | Where-Object { $_ -match 'email|id|lat|lng' })
Check 'entries reveal only name and steps' ($leak.Count -eq 0) "leaked: $($leak -join ',')"

Write-Host "`n=== 29. Check-ins: claiming the area you were sent to ===" -ForegroundColor Cyan
$p = New-Player
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$spot = New-Spot
$target = (Invoke-Api GET "/checkin/areas?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body.target
$at = @{ lat = $target.lat; lng = $target.lng; accuracyM = 8 }

$fuzzy = Invoke-Api POST '/checkin' @{ lat = $target.lat; lng = $target.lng; accuracyM = 200 } -Token $p.token
Check 'a fuzzy GPS fix cannot check in (422)' ($fuzzy.status -eq 422) "got $($fuzzy.status)"

$ci = Invoke-Api POST '/checkin' @{ lat = $target.lat; lng = $target.lng; accuracyM = 8; placeName = 'Test Park' } -Token $p.token
Check 'check in -> 201' ($ci.status -eq 201) "got $($ci.status) $($ci.body.error)"
Check 'a new place pays 4 + 6 bonus = 10 WP' ($ci.body.newPlace -eq $true -and $ci.body.claim.amount -eq 10 -and $ci.body.walkPointsBalance -eq 10) "got $($ci.body | ConvertTo-Json -Compress)"

$again = Invoke-Api POST '/checkin' $at -Token $p.token
Check 'nowhere left to go without an ad (409)' ($again.status -eq 409) "got $($again.status)"

$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'daily status shows the check-in' ($d.checkin.available -eq $false -and $d.checkin.today.placeName -eq 'Test Park') "got $($d.checkin | ConvertTo-Json -Compress -Depth 4)"
Check 'streak 1, one place visited' ($d.checkin.streak -eq 1 -and $d.checkin.placesVisited -eq 1) "got streak $($d.checkin.streak) places $($d.checkin.placesVisited)"

$t = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $ci.body.claim.id } -Token $p.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'an ad doubles a check-in (+10)' ($g.body.granted -eq $true -and $g.body.amount -eq 10) "got $($g.body | ConvertTo-Json -Compress)"

# Rewind yesterday's visit so today's is a repeat of the SAME square: not a
# new place, and the streak runs to 2. The target has to be re-pointed at
# that square by hand, since the roll is random.
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
Sql "UPDATE checkins SET local_day = local_day - 1, created_at = NOW() - INTERVAL '20 hours' WHERE user_id = '$uid';" | Out-Null
Sql "UPDATE reward_claims SET local_day = local_day - 1, created_at = NOW() - INTERVAL '20 hours' WHERE user_id = '$uid' AND source = 'CHECKIN';" | Out-Null
Sql "UPDATE area_targets SET local_day = local_day - 1 WHERE user_id = '$uid';" | Out-Null
Sql "INSERT INTO area_targets (user_id, local_day, place_x, place_y, place_scale, origin_lat, origin_lng, from_ad) VALUES ('$uid', (NOW() AT TIME ZONE 'UTC')::date, $($target.x), $($target.y), 400, $($target.lat), $($target.lng), FALSE);" | Out-Null

$ci2 = Invoke-Api POST '/checkin' $at -Token $p.token
Check 'same place again pays the base 4 WP' ($ci2.status -eq 201 -and $ci2.body.newPlace -eq $false -and $ci2.body.claim.amount -eq 4) "got $($ci2.body | ConvertTo-Json -Compress)"
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'two days in a row -> streak 2' ($d.checkin.streak -eq 2) "got $($d.checkin.streak)"

Write-Host "`n=== 30. Profiles and badges ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1) -AgeHours 4
$me = (Invoke-Api GET '/profile' -Token $p.token).body
Check 'profile loads, level 1, no badges' ($me.level.level -eq 1 -and $me.badgeCount.unlocked -eq 0 -and $me.isYou -eq $true) "got $($me.level.level) / $($me.badgeCount.unlocked)"
Check 'lists every badge with progress' ($me.badgeCount.total -ge 20 -and @($me.badges).Count -eq $me.badgeCount.total) "got $($me.badgeCount.total)"
Invoke-Api POST '/steps/sync' @{ steps = 3000 } -Token $p.token | Out-Null
Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token | Out-Null
$bal = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check 'walking 1,000+ steps and claiming unlocks badges (new-badge dot)' ($bal.unseenBadges -ge 2) "got $($bal.unseenBadges)"
Check 'balance carries the jersey colour' ($bal.jerseyColor -eq '#2F5D50') "got $($bal.jerseyColor)"
$me = (Invoke-Api GET '/profile' -Token $p.token).body
$new = @($me.badges | Where-Object { $_.isNew } | ForEach-Object { $_.key })
Check 'First Steps and Homesteader are new' (($new -contains 'first_steps') -and ($new -contains 'first_claim')) "got $($new -join ',')"
Check 'level 2 at 3,000 steps' ($me.level.level -eq 2) "got $($me.level.level)"
Invoke-Api POST '/profile/badges/seen' -Token $p.token | Out-Null
Check 'seeing them clears the dot' ((Invoke-Api GET '/user/balance' -Token $p.token).body.unseenBadges -eq 0) 'dot not cleared'
$j = Invoke-Api PATCH '/profile' @{ avatar = @{ shirt = 'shirt_ruby' } } -Token $p.token
Check 'the shirt sets the runner colour' ($j.status -eq 200 -and $j.body.jerseyColor -eq '#C0304A') "got $($j.status) $($j.body.jerseyColor)"
$bad = Invoke-Api PATCH '/profile' @{ avatar = @{ shirt = 'shirt_gold' } } -Token $p.token
Check 'a shirt you have not earned is refused' ($bad.body.avatar.shirt -eq 'shirt_ruby') "got $($bad.body.avatar.shirt)"
$viewer = New-Player
$pub = Invoke-Api GET "/profile/$($me.username)" -Token $viewer.token
Check "another player's profile is public" ($pub.status -eq 200 -and $pub.body.isYou -eq $false -and $pub.body.badgeCount.unlocked -ge 2) "got $($pub.status) $($pub.body.badgeCount.unlocked)"
$leak = @($pub.body.PSObject.Properties.Name | Where-Object { $_ -match 'email|id$|area|lat|lng|coins|walkPoints' })
Check 'and reveals no email, location or balance' ($leak.Count -eq 0) "leaked: $($leak -join ',')"
Check 'locked badge progress stays private' (@($pub.body.badges | Where-Object { -not $_.unlocked -and $_.progress -gt 0 }).Count -eq 0) 'progress leaked'
$missing = Invoke-Api GET '/profile/nobody_by_this_name_123' -Token $viewer.token
Check 'unknown player -> 404' ($missing.status -eq 404) "got $($missing.status)"

Write-Host "`n=== 31. Invite a friend ===" -ForegroundColor Cyan
$host1 = New-Player -AgeHours 4
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($host1.email)';" | Out-Null
$ref = (Invoke-Api GET '/referral' -Token $host1.token).body
Check 'you get a 6-character code' ($ref.code.Length -eq 6 -and $ref.code -match '^[A-Z0-9]+$') "got $($ref.code)"
Check 'and it does not change' ((Invoke-Api GET '/referral' -Token $host1.token).body.code -eq $ref.code) 'code changed'
Check 'rewards are 200 for you, 100 for the friend' ($ref.rewardForYou -eq 200 -and $ref.rewardForFriend -eq 100) "got $($ref.rewardForYou)/$($ref.rewardForFriend)"
$self = Invoke-Api POST '/referral/redeem' @{ code = $ref.code } -Token $host1.token
Check 'you cannot use your own code (409)' ($self.status -eq 409) "got $($self.status)"
$unknown = Invoke-Api POST '/referral/redeem' @{ code = 'ZZZZZZ' } -Token $host1.token
Check 'an unknown code -> 404' ($unknown.status -eq 404) "got $($unknown.status)"

$friend = New-Player -AgeHours 4
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($friend.email)';" | Out-Null
$red = Invoke-Api POST '/referral/redeem' @{ code = $ref.code.ToLower() } -Token $friend.token
Check 'the friend redeems (lower case is fine) -> +100 WP' ($red.status -eq 201 -and $red.body.reward -eq 100 -and $red.body.walkPointsBalance -eq 100) "got $($red.status) $($red.body | ConvertTo-Json -Compress)"
Check 'and is told who invited them' ($red.body.invitedBy.Length -gt 0) 'no inviter name'
$twice = Invoke-Api POST '/referral/redeem' @{ code = $ref.code } -Token $friend.token
Check 'only one code per account (409)' ($twice.status -eq 409) "got $($twice.status)"
Check 'the inviter is NOT paid yet' ((Invoke-Api GET '/user/balance' -Token $host1.token).body.walkPoints -eq 0) 'paid too early'
$st = (Invoke-Api GET '/referral' -Token $host1.token).body
Check 'the invite shows as pending' ($st.invited -eq 1 -and $st.qualified -eq 0) "got $($st.invited)/$($st.qualified)"

# Not enough walking yet...
$sync = Invoke-Api POST '/steps/sync' @{ steps = 1000; platform = 'ANDROID'; deviceId = "friend-$($friend.email)" } -Token $friend.token
Check '1,000 steps does not qualify it' ($sync.body.referralBonusPaid -eq 0) "got $($sync.body.referralBonusPaid)"
Check 'inviter still unpaid' ((Invoke-Api GET '/user/balance' -Token $host1.token).body.walkPoints -eq 0) 'paid too early'
# ...3,000 does.
$sync = Invoke-Api POST '/steps/sync' @{ steps = 2000; platform = 'ANDROID'; deviceId = "friend-$($friend.email)" } -Token $friend.token
Check '3,000 steps qualifies the invite (+200 to the inviter)' ($sync.body.referralBonusPaid -eq 200) "got $($sync.body.referralBonusPaid)"
Check 'the inviter is paid exactly once' ((Invoke-Api GET '/user/balance' -Token $host1.token).body.walkPoints -eq 200) 'wrong balance'
$sync = Invoke-Api POST '/steps/sync' @{ steps = 2000; platform = 'ANDROID'; deviceId = "friend-$($friend.email)" } -Token $friend.token
Check 'walking more pays nothing extra' ($sync.body.referralBonusPaid -eq 0 -and (Invoke-Api GET '/user/balance' -Token $host1.token).body.walkPoints -eq 200) 'paid twice'
$st = (Invoke-Api GET '/referral' -Token $host1.token).body
Check 'the invite now counts as qualified' ($st.qualified -eq 1 -and $st.earned -eq 200) "got $($st.qualified)/$($st.earned)"

Write-Host "`n=== 32. Invites cannot be farmed ===" -ForegroundColor Cyan
# Same phone on both sides: qualifies, but pays nothing.
$farmer = New-Player -AgeHours 4
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($farmer.email)';" | Out-Null
$fcode = (Invoke-Api GET '/referral' -Token $farmer.token).body.code
$device = "one-phone-$([guid]::NewGuid())"
Invoke-Api POST '/steps/sync' @{ steps = 100; platform = 'ANDROID'; deviceId = $device } -Token $farmer.token | Out-Null
$alt = New-Player -AgeHours 4
Invoke-Api POST '/referral/redeem' @{ code = $fcode } -Token $alt.token | Out-Null
$sync = Invoke-Api POST '/steps/sync' @{ steps = 3000; platform = 'ANDROID'; deviceId = $device } -Token $alt.token
Check 'the same phone on both sides pays the inviter nothing' ($sync.body.referralBonusPaid -eq 0) "got $($sync.body.referralBonusPaid)"
$bal = (Invoke-Api GET '/user/balance' -Token $farmer.token).body.walkPoints
Check 'so a second account earns them 0 WP' ($bal -eq 1) "got $bal"
# An old account cannot redeem a code.
$old = New-Player
Sql "UPDATE users SET created_at = NOW() - INTERVAL '30 days' WHERE email = '$($old.email)';" | Out-Null
$late = Invoke-Api POST '/referral/redeem' @{ code = $ref.code } -Token $old.token
Check 'codes only work for new accounts (409)' ($late.status -eq 409) "got $($late.status)"
$st = (Invoke-Api GET '/referral' -Token $old.token).body
Check 'and such an account is told it cannot redeem' ($st.canRedeem -eq $false) "got $($st.canRedeem)"

Write-Host "`n=== 33. Avatars, names and titles ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1) -AgeHours 4
$me = (Invoke-Api GET '/profile' -Token $p.token).body
Check 'a new player has a default avatar' ($me.avatar.skin -eq 'skin_2' -and $me.avatar.hat -eq 'hat_none') "got $($me.avatar | ConvertTo-Json -Compress)"
Check 'and the full parts catalogue' (@($me.avatarItems).Count -ge 30) "got $(@($me.avatarItems).Count)"
Check 'skin tones are all unlocked' (@($me.avatarItems | Where-Object { $_.slot -eq 'skin' -and -not $_.unlocked }).Count -eq 0) 'a skin tone was locked'
Check 'ad items are marked buyable' (@($me.avatarItems | Where-Object { $_.buyable }).Count -ge 5) "got $(@($me.avatarItems | Where-Object { $_.buyable }).Count)"
$r = Invoke-Api PATCH '/profile' @{ avatar = @{ skin = 'skin_5'; hair = 'hair_curls'; shirt = 'shirt_ruby' } } -Token $p.token
Check 'you can change free parts' ($r.body.avatar.skin -eq 'skin_5' -and $r.body.avatar.shirt -eq 'shirt_ruby') "got $($r.body.avatar | ConvertTo-Json -Compress)"
Check 'and the runner colour follows the shirt' ($r.body.jerseyColor -eq '#C0304A') "got $($r.body.jerseyColor)"
$locked = Invoke-Api PATCH '/profile' @{ avatar = @{ hat = 'hat_crown' } } -Token $p.token
Check 'a locked part is quietly refused, not applied' ($locked.body.avatar.hat -eq 'hat_none') "got $($locked.body.avatar.hat)"
$bal = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check 'the balance carries the avatar for the map' ($bal.avatar.shirt -eq 'shirt_ruby' -and $bal.jerseyColor -eq '#C0304A') "got $($bal.avatar | ConvertTo-Json -Compress)"

$newName = "renamed$(Get-Random -Maximum 999999)"
$rn = Invoke-Api PATCH '/profile' @{ username = $newName } -Token $p.token
Check 'you can change your name' ($rn.status -eq 200 -and $rn.body.username -eq $newName) "got $($rn.status) $($rn.body.username)"
$again = Invoke-Api PATCH '/profile' @{ username = "$newName x2" } -Token $p.token
Check 'a name with a space is refused (400)' ($again.status -eq 400) "got $($again.status)"
$soon = Invoke-Api PATCH '/profile' @{ username = "other$(Get-Random -Maximum 999)" } -Token $p.token
Check 'and not twice in a month (409)' ($soon.status -eq 409) "got $($soon.status)"
$other = New-Player
$taken = Invoke-Api PATCH '/profile' @{ username = $newName } -Token $other.token
Check 'a taken name is refused (409)' ($taken.status -eq 409) "got $($taken.status)"
$badTitle = Invoke-Api PATCH '/profile' @{ title = 'champion' } -Token $p.token
Check 'you cannot wear a badge you have not earned (409)' ($badTitle.status -eq 409) "got $($badTitle.status)"
Invoke-Api POST '/steps/sync' @{ steps = 1200 } -Token $p.token | Out-Null
$title = Invoke-Api PATCH '/profile' @{ title = 'first_steps' } -Token $p.token
Check 'but you can wear one you have' ($title.status -eq 200 -and $title.body.title -eq 'first_steps') "got $($title.status) $($title.body.title)"

Write-Host "`n=== 34. More rewarded ads: cosmetics, scouting, instant collect ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1)0 -AgeHours 4
# --- a cosmetic, which costs the game nothing ---
$t = Invoke-Api POST '/rewards/start' @{ kind = 'COSMETIC'; cosmeticKey = 'hat_bucket' } -Token $p.token
Check 'an ad can unlock an avatar part' ($t.status -eq 201) "got $($t.status) $($t.body.error)"
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'and it is granted' ($g.body.granted -eq $true) "got $($g.body | ConvertTo-Json -Compress)"
$wear = Invoke-Api PATCH '/profile' @{ avatar = @{ hat = 'hat_bucket' } } -Token $p.token
Check 'the part can then be worn' ($wear.body.avatar.hat -eq 'hat_bucket') "got $($wear.body.avatar.hat)"
$twice = Invoke-Api POST '/rewards/start' @{ kind = 'COSMETIC'; cosmeticKey = 'hat_bucket' } -Token $p.token
Check 'no watching an ad for something you own (409)' ($twice.status -eq 409) "got $($twice.status)"
$notForSale = Invoke-Api POST '/rewards/start' @{ kind = 'COSMETIC'; cosmeticKey = 'hat_crown' } -Token $p.token
Check 'badge items are not for sale by ad (400)' ($notForSale.status -eq 400) "got $($notForSale.status)"

# --- scouting: a wider claim reach for a few minutes ---
$t = Invoke-Api POST '/rewards/start' @{ kind = 'SCOUT' } -Token $p.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'scouting lasts 10 minutes' ([Math]::Abs($g.body.amount - 600) -le 5) "got $($g.body.amount)"
$bal = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check 'the balance says scouting is on, reaching 75 m' ($bal.rewards.scout.active -eq $true -and $bal.rewards.scout.reachM -eq 75) "got $($bal.rewards.scout | ConvertTo-Json -Compress)"
# A square ~55 m away is out of normal reach (40 m) but inside a scout's.
# Near the equator a cell is ~14 m across, so +4 cells is a known distance.
# TWO parcels are claimed below, so top up for both - the welcome bonus used
# to cover the second one by accident when a parcel cost 20 WP.
Sql "UPDATE users SET walk_points_balance = walk_points_balance + $(2 * (Parcel-Price 1)) WHERE email = '$($p.email)';" | Out-Null
$spot = New-Spot
$spot.lat = [Math]::Round((Get-Random -Minimum -1500000 -Maximum 1500000) / 100000.0, 6)
$first = Invoke-Api POST '/parcels/claim' $spot -Token $p.token
$cx = $first.body.parcel.cellX; $cy = $first.body.parcel.cellY
$far = @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 5; cellX = $cx + 4; cellY = $cy }
$r = Invoke-Api POST '/parcels/claim' $far -Token $p.token
Check 'while scouting you can claim further away' ($r.status -eq 201) "got $($r.status): $($r.body.error)"
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
Sql "UPDATE users SET scout_until = NOW() - INTERVAL '1 minute' WHERE id = '$uid';" | Out-Null
$far2 = @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 5; cellX = $cx + 5; cellY = $cy }
$r = Invoke-Api POST '/parcels/claim' $far2 -Token $p.token
Check 'and once it ends, the normal 40 m applies again (422)' ($r.status -eq 422 -and $r.body.error -match '40 m') "got $($r.status): $($r.body.error)"

# --- instant collect: income brought forward, never created ---
Sql "UPDATE users SET coin_remainder_micro = 0, last_coin_claim_at = NOW() WHERE id = '$uid';" | Out-Null
$before = (Invoke-Api GET '/user/balance' -Token $p.token).body
$t = Invoke-Api POST '/rewards/start' @{ kind = 'INSTANT_COLLECT' } -Token $p.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'instant collect pays 2 hours of income' ($g.body.amount -eq 2 * $before.coinsPerHour) "got $($g.body.amount) vs $(2 * $before.coinsPerHour)"
$after = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check 'the coins arrive' ($after.coins -eq $before.coins + 2 * $before.coinsPerHour) "got $($after.coins) from $($before.coins)"
$clock = [double](Sql "SELECT EXTRACT(EPOCH FROM (last_coin_claim_at - NOW()))/3600.0 FROM users WHERE id = '$uid';")
Check 'and the clock moves forward, so it is not paid twice' ([Math]::Abs($clock - 2) -lt 0.05) "clock is $([Math]::Round($clock,3))h ahead"
$drift = [int](Sql "SELECT COUNT(*) FROM users u WHERE u.coin_balance <> COALESCE((SELECT SUM(amount) FROM coin_ledger l WHERE l.user_id = u.id), 0);")
Check 'the ledger still matches every balance' ($drift -eq 0) "$drift account(s) disagree"
$empty = New-Player
$none = Invoke-Api POST '/rewards/start' @{ kind = 'INSTANT_COLLECT' } -Token $empty.token
Check 'with no land there is nothing to collect (409)' ($none.status -eq 409) "got $($none.status)"

Write-Host "`n=== 35. Parcel upgrades (Walk Points + an ad each) ===" -ForegroundColor Cyan
$p = New-Player -Wp 500 -AgeHours 4
$claim = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $p.token).body
$parcelId = $claim.parcel.id
$baseRate = $claim.parcel.baseCoinsPerHour
Check 'a new parcel starts at upgrade level 0' ($claim.parcel.upgradeLevel -eq 0 -and $claim.parcel.nextUpgradeCostWp -eq 25) "got $($claim.parcel | ConvertTo-Json -Compress)"
$before = (Invoke-Api GET '/user/balance' -Token $p.token).body
$t = Invoke-Api POST '/rewards/start' @{ kind = 'UPGRADE'; targetParcelId = $parcelId } -Token $p.token
Check 'an upgrade ticket is issued' ($t.status -eq 201) "got $($t.status) $($t.body.error)"
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'the ad upgrades it to level 1' ($g.body.granted -eq $true -and $g.body.amount -eq 1) "got $($g.body | ConvertTo-Json -Compress)"
$mine = (Invoke-Api GET '/parcels' -Token $p.token).body.parcels[0]
Check 'the parcel earns +1 coin/hour' ($mine.coinsPerHour -eq $baseRate + 1 -and $mine.upgradeLevel -eq 1) "got $($mine | ConvertTo-Json -Compress)"
Check "and the next level costs $($RULES.UpgradeCostL2) WP" ($mine.nextUpgradeCostWp -eq $RULES.UpgradeCostL2) "got $($mine.nextUpgradeCostWp)"
$after = (Invoke-Api GET '/user/balance' -Token $p.token).body
Check "$($RULES.UpgradeCostL1) WP was spent" ($after.walkPoints -eq $before.walkPoints - $RULES.UpgradeCostL1) "got $($after.walkPoints) from $($before.walkPoints)"
Check 'income counts the upgrade' ($after.coinsPerHour -eq $before.coinsPerHour + 1) "got $($after.coinsPerHour)"
# Four levels is the cap.
for ($i = 0; $i -lt 3; $i++) {
    $tk = Invoke-Api POST '/rewards/start' @{ kind = 'UPGRADE'; targetParcelId = $parcelId } -Token $p.token
    Invoke-Api POST '/rewards/complete' @{ nonce = $tk.body.nonce } -Token $p.token | Out-Null
}
$mine = (Invoke-Api GET '/parcels' -Token $p.token).body.parcels[0]
Check 'four upgrades max, +4 coins/hour' ($mine.upgradeLevel -eq 4 -and $mine.coinsPerHour -eq $baseRate + 4 -and $null -eq $mine.nextUpgradeCostWp) "got $($mine | ConvertTo-Json -Compress)"
$full = Invoke-Api POST '/rewards/start' @{ kind = 'UPGRADE'; targetParcelId = $parcelId } -Token $p.token
Check 'a fully upgraded parcel refuses more (409)' ($full.status -eq 409) "got $($full.status)"
$poor = New-Player -Wp (Parcel-Price 1) -AgeHours 4
$theirs = (Invoke-Api POST '/parcels/claim' (New-Spot) -Token $poor.token).body.parcel.id
$broke = Invoke-Api POST '/rewards/start' @{ kind = 'UPGRADE'; targetParcelId = $theirs } -Token $poor.token
Check 'no Walk Points, no ad shown (400)' ($broke.status -eq 400) "got $($broke.status)"
$notMine = Invoke-Api POST '/rewards/start' @{ kind = 'UPGRADE'; targetParcelId = $parcelId } -Token $poor.token
Check "you cannot upgrade someone else's parcel (404)" ($notMine.status -eq 404) "got $($notMine.status)"

Write-Host "`n=== 36. Unlimited areas, one ad each ===" -ForegroundColor Cyan
$p = New-Player
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$spot = New-Spot

# THE LOOP: free area -> claim -> ad buys the next -> claim -> repeat.
#
# The ad is spent when the next DESTINATION is bought, not when the check-in
# is made. That is the change from the old model, where every extra check-in
# carried its own adNonce: you now pay to be SENT somewhere, and arriving is
# free once you are there.
$a1 = (Invoke-Api GET "/checkin/areas?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body.target
$first = Invoke-Api POST '/checkin' @{ lat = $a1.lat; lng = $a1.lng; accuracyM = 8; placeName = 'Home' } -Token $p.token
Check "today's free area is free" ($first.status -eq 201) "got $($first.status): $($first.body.error)"

$second = Invoke-Api POST '/checkin' @{ lat = $a1.lat; lng = $a1.lng; accuracyM = 8 } -Token $p.token
Check 'a second one without an ad is refused (409)' ($second.status -eq 409 -and $second.body.error -match 'ad') "got $($second.status): $($second.body.error)"

$t = Invoke-Api POST '/rewards/start' @{ kind = 'EXTRA_CHECKIN' } -Token $p.token
Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token | Out-Null
$next = Invoke-Api POST '/checkin/areas/next' @{ lat = $a1.lat; lng = $a1.lng; adNonce = $t.body.nonce } -Token $p.token
Check 'an ad buys another area (201)' ($next.status -eq 201) "got $($next.status): $($next.body.error)"
$a2 = $next.body.target

# Standing where the LAST area was is not being in the new one.
$wrong = Invoke-Api POST '/checkin' @{ lat = $a1.lat; lng = $a1.lng; accuracyM = 8 } -Token $p.token
Check 'the old spot does not count for the new area (422)' ($wrong.status -eq 422) "got $($wrong.status): $($wrong.body.error)"

$new = Invoke-Api POST '/checkin' @{ lat = $a2.lat; lng = $a2.lng; accuracyM = 8; placeName = 'Park' } -Token $p.token
Check 'walking to the new area works' ($new.status -eq 201 -and $new.body.newPlace -eq $true) "got $($new.status): $($new.body.error)"

# The same ad ticket cannot buy a third area.
$reuse = Invoke-Api POST '/checkin/areas/next' @{ lat = $a2.lat; lng = $a2.lng; adNonce = $t.body.nonce } -Token $p.token
Check 'the same ad cannot pay twice (409)' ($reuse.status -eq 409) "got $($reuse.status)"

$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'two check-ins counted today' ($d.checkin.countToday -eq 2 -and $d.checkin.extraNeedsAd -eq $true) "got $($d.checkin | ConvertTo-Json -Compress -Depth 4)"
Check 'both places counted, streak still 1' ($d.checkin.placesVisited -eq 2 -and $d.checkin.streak -eq 1) "got places $($d.checkin.placesVisited) streak $($d.checkin.streak)"
Check 'and both paid out' ((Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints -eq 20) 'wrong WP'

Write-Host "`n=== 37. Streak insurance ===" -ForegroundColor Cyan
$p = New-Player
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
Invoke-Api POST '/daily/claim' -Token $p.token | Out-Null
# Pretend that chest was day 5 of a streak, two days ago: yesterday was missed.
Sql "UPDATE reward_claims SET local_day = local_day - 2, streak = 5, created_at = NOW() - INTERVAL '48 hours' WHERE user_id = '$uid' AND source = 'DAILY';" | Out-Null
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'the broken streak can be saved' ($null -ne $d.streakSave.missedDay -and $d.streakSave.savesStreak -eq 6) "got $($d.streakSave | ConvertTo-Json -Compress)"
Check 'and without saving it, the streak is back to 1' ($d.daily.streak -eq 1) "got $($d.daily.streak)"
$t = Invoke-Api POST '/rewards/start' @{ kind = 'STREAK_SAVE' } -Token $p.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'an ad forgives the missed day' ($g.body.granted -eq $true) "got $($g.body | ConvertTo-Json -Compress)"
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'the streak carries on at day 6' ($d.daily.streak -eq 6 -and $d.daily.reward -eq 10) "got streak $($d.daily.streak) reward $($d.daily.reward)"
$c = Invoke-Api POST '/daily/claim' -Token $p.token
Check 'and the chest pays day 6' ($c.body.streak -eq 6) "got $($c.body.streak)"
$again = Invoke-Api POST '/rewards/start' @{ kind = 'STREAK_SAVE' } -Token $p.token
Check 'nothing to save now (409)' ($again.status -eq 409) "got $($again.status)"

Write-Host "`n=== 38. Bonus chest for watching a few ads ===" -ForegroundColor Cyan
$p = New-Player -Wp (Parcel-Price 1) -AgeHours 4
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'the ad streak starts at 0 of 3' ($d.adStreak.adsToday -eq 0 -and $d.adStreak.target -eq 3) "got $($d.adStreak | ConvertTo-Json -Compress)"
$early = Invoke-Api POST '/daily/adstreak' -Token $p.token
Check 'no chest before the third ad (409)' ($early.status -eq 409) "got $($early.status)"
for ($i = 0; $i -lt 3; $i++) {
    $tk = Invoke-Api POST '/rewards/start' @{ kind = 'WALK_POINTS' } -Token $p.token
    Invoke-Api POST '/rewards/complete' @{ nonce = $tk.body.nonce } -Token $p.token | Out-Null
}
$d = (Invoke-Api GET '/daily' -Token $p.token).body
Check 'three ads makes the bonus chest ready' ($d.adStreak.adsToday -ge 3 -and $d.adStreak.ready -eq $true) "got $($d.adStreak | ConvertTo-Json -Compress)"
$bonus = Invoke-Api POST '/daily/adstreak' -Token $p.token
Check 'the bonus chest pays 10 WP' ($bonus.status -eq 201 -and $bonus.body.claim.amount -eq 10) "got $($bonus.status) $($bonus.body | ConvertTo-Json -Compress)"
$twice = Invoke-Api POST '/daily/adstreak' -Token $p.token
Check 'once a day (409)' ($twice.status -eq 409) "got $($twice.status)"
$t = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $bonus.body.claim.id } -Token $p.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token
Check 'and it can be doubled by another ad' ($g.body.granted -eq $true -and $g.body.amount -eq 10) "got $($g.body | ConvertTo-Json -Compress)"

Write-Host "`n=== 39. Treasure boxes ===" -ForegroundColor Cyan
$p = New-Player
Sql "UPDATE users SET walk_points_balance = 0 WHERE email = '$($p.email)';" | Out-Null
$spot = New-Spot
$tr = (Invoke-Api GET "/treasure?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body
Check 'a box appears near you' (@($tr.boxes).Count -eq 1) "got $(@($tr.boxes).Count)"
Check 'two are free each day' ($tr.freePerDay -eq 2 -and $tr.nextNeedsAd -eq $false) "got $($tr | ConvertTo-Json -Compress -Depth 3)"
$box = $tr.boxes[0]
$uid = Sql "SELECT id FROM users WHERE email = '$($p.email)';"
$dLat = ($box.lat - $spot.lat) * 111320
$dLng = ($box.lng - $spot.lng) * 111320 * [Math]::Cos($spot.lat * [Math]::PI / 180)
$dist = [Math]::Sqrt($dLat * $dLat + $dLng * $dLng)
Check 'it is a walk away, not underfoot' ($dist -ge 140 -and $dist -le 420) "got $dist m"
$far = Invoke-Api POST "/treasure/$($box.id)/open" @{ lat = $spot.lat; lng = $spot.lng } -Token $p.token
Check 'you cannot open it from here (422)' ($far.status -eq 422) "got $($far.status): $($far.body.error)"
$open = Invoke-Api POST "/treasure/$($box.id)/open" @{ lat = $box.lat; lng = $box.lng } -Token $p.token
Check 'walking to it opens it' ($open.status -eq 200 -and $open.body.rewardWp -ge 6 -and $open.body.rewardWp -le 14) "got $($open.status) $($open.body | ConvertTo-Json -Compress)"
Check 'and pays Walk Points' ($open.body.walkPointsBalance -eq $open.body.rewardWp) "got $($open.body.walkPointsBalance)"
$twice = Invoke-Api POST "/treasure/$($box.id)/open" @{ lat = $box.lat; lng = $box.lng } -Token $p.token
Check 'a box opens once (404)' ($twice.status -eq 404) "got $($twice.status)"
$dt = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $open.body.claim.id } -Token $p.token
$dg = Invoke-Api POST '/rewards/complete' @{ nonce = $dt.body.nonce } -Token $p.token
Check 'an ad doubles the box reward' ($dg.body.granted -eq $true -and $dg.body.amount -eq $open.body.rewardWp) "got $($dg.body | ConvertTo-Json -Compress)"
Check 'and the Walk Points arrive' ((Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints -eq 2 * $open.body.rewardWp) 'wrong WP'
# Second free box, then ads.
$tr = (Invoke-Api GET "/treasure?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body
Check 'a second free box appears' (@($tr.boxes).Count -eq 1) "got $(@($tr.boxes).Count)"
Sql "UPDATE treasure_boxes SET collected_at = NOW() WHERE user_id = '$uid' AND collected_at IS NULL;" | Out-Null
$tr = (Invoke-Api GET "/treasure?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body
Check 'after two, the next box needs an ad' (@($tr.boxes).Count -eq 0 -and $tr.nextNeedsAd -eq $true) "got $(@($tr.boxes).Count) boxes"
$t = Invoke-Api POST '/rewards/start' @{ kind = 'TREASURE' } -Token $p.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce; lat = $spot.lat; lng = $spot.lng } -Token $p.token
Check 'an ad spawns another box' ($g.body.granted -eq $true) "got $($g.body | ConvertTo-Json -Compress)"
$tr = (Invoke-Api GET "/treasure?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body
Check 'and there it is' (@($tr.boxes).Count -eq 1 -and $tr.boxes[0].fromAd -eq $true) "got $($tr.boxes | ConvertTo-Json -Compress)"

Write-Host "`n=== 20. Rate limiting is wired up ===" -ForegroundColor Cyan
$r = Invoke-Api GET '/user/balance' -Token $p.token
$hasLimitHeader = $r.headers.Keys -contains 'RateLimit' -or $r.headers.Keys -contains 'RateLimit-Limit' -or $r.headers.Keys -contains 'ratelimit'
Check 'API responses carry RateLimit headers' $hasLimitHeader "headers: $($r.headers.Keys -join ',')"

Write-Host "`n=== 40. Today's area: one place to go, and you must be in it ===" -ForegroundColor Cyan
$p = New-Player
$spot = New-Spot
$areas = (Invoke-Api GET "/checkin/areas?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body
Check 'a target is rolled on the first call' ($null -ne $areas.target) 'no target'
Check 'it is NOT the square you are standing in' ($areas.target.here -eq $false) "here=$($areas.target.here)"
Check 'it is a real walk away' ($areas.target.distanceM -gt 50) "got $($areas.target.distanceM) m"
Check 'but still reachable today' ($areas.target.distanceM -lt 1500) "got $($areas.target.distanceM) m"
Check 'a fresh account has not been there' ($areas.target.visited -eq $false) 'already visited'
Check 'somewhere new pays the explorer bonus' ($areas.target.wp -gt 4) "got $($areas.target.wp)"
Check 'nothing claimed yet' ($areas.claimedToday -eq 0) "got $($areas.claimedToday)"

# THE PROPERTY THAT MAKES IT USABLE: asking again must not re-roll, or the
# destination would run away as the player walked towards it.
$again = (Invoke-Api GET "/checkin/areas?lat=$($spot.lat)&lng=$($spot.lng)" -Token $p.token).body
Check 'asking again does NOT move the target' ($again.target.key -eq $areas.target.key) "$($areas.target.key) -> $($again.target.key)"
# ...even from somewhere else entirely.
$moved = (Invoke-Api GET "/checkin/areas?lat=$($spot.lat + 0.01)&lng=$($spot.lng + 0.01)" -Token $p.token).body
Check 'walking does NOT move the target' ($moved.target.key -eq $areas.target.key) "$($areas.target.key) -> $($moved.target.key)"
Check '...but the distance updates as you move' ($moved.target.distanceM -ne $areas.target.distanceM) 'distance did not change'

# THE GATE. Check in from where you started, which is not the target.
$r = Invoke-Api POST '/checkin' @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 10 } -Token $p.token
Check 'checking in before you get there is refused (422)' ($r.status -eq 422) "got $($r.status)"
Check '...and the message says to keep walking' ($r.body.error -match 'not in that area') "got: $($r.body.error)"

# Walk to it. The centre of the square is by definition inside the square.
$dest = @{ lat = $areas.target.lat; lng = $areas.target.lng; accuracyM = 10 }
$arrived = (Invoke-Api GET "/checkin/areas?lat=$($dest.lat)&lng=$($dest.lng)" -Token $p.token).body
Check 'standing on it reads as here' ($arrived.target.here -eq $true) "here=$($arrived.target.here)"

$r = Invoke-Api POST '/checkin' $dest -Token $p.token
Check 'checking in there works (201)' ($r.status -eq 201) "got $($r.status): $($r.body.error)"
Check 'it counts as somewhere new' ($r.body.newPlace -eq $true) "got $($r.body.newPlace)"
Check 'and it can be doubled by an ad' ($r.body.claim.canDouble -eq $true) "got $($r.body.claim.canDouble)"
$claimId = $r.body.claim.id
$wpBefore = (Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints
$t = Invoke-Api POST '/rewards/start' @{ kind = 'DOUBLE'; targetClaimId = $claimId } -Token $p.token
Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token | Out-Null
$wpAfter = (Invoke-Api GET '/user/balance' -Token $p.token).body.walkPoints
Check 'the ad really doubles it' ($wpAfter -eq $wpBefore + $r.body.claim.amount) "got $wpAfter from $wpBefore (+$($r.body.claim.amount))"

# Claimed, so there is nowhere to go until an ad buys the next one.
$spent = (Invoke-Api GET "/checkin/areas?lat=$($dest.lat)&lng=$($dest.lng)" -Token $p.token).body
Check 'the target is gone once claimed' ($null -eq $spent.target) "got $($spent.target.key)"
Check 'one reached today' ($spent.claimedToday -eq 1) "got $($spent.claimedToday)"
Check 'the next one needs an ad' ($spent.nextNeedsAd -eq $true) "got $($spent.nextNeedsAd)"
$r = Invoke-Api POST '/checkin' $dest -Token $p.token
Check 'checking in with nowhere to go is refused (409)' ($r.status -eq 409) "got $($r.status)"

# Buy the next destination.
$t = Invoke-Api POST '/rewards/start' @{ kind = 'EXTRA_CHECKIN' } -Token $p.token
Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $p.token | Out-Null
$next = Invoke-Api POST '/checkin/areas/next' @{ lat = $dest.lat; lng = $dest.lng; adNonce = $t.body.nonce } -Token $p.token
Check 'an ad buys the next area (201)' ($next.status -eq 201) "got $($next.status): $($next.body.error)"
Check 'and it is somewhere else' ($next.body.target.key -ne $areas.target.key) "same square: $($next.body.target.key)"
Check 'marked as bought with an ad' ($next.body.target.fromAd -eq $true) "got $($next.body.target.fromAd)"

# ONE OPEN TARGET AT A TIME - the rule the whole feature rests on.
$t2 = Invoke-Api POST '/rewards/start' @{ kind = 'EXTRA_CHECKIN' } -Token $p.token
Invoke-Api POST '/rewards/complete' @{ nonce = $t2.body.nonce } -Token $p.token | Out-Null
$dup = Invoke-Api POST '/checkin/areas/next' @{ lat = $dest.lat; lng = $dest.lng; adNonce = $t2.body.nonce } -Token $p.token
Check 'a second destination is refused while one is open (409)' ($dup.status -eq 409) "got $($dup.status)"
# ...and the ad that paid for the refusal is still there to use.
$unspent = [int](Sql "SELECT COUNT(*) FROM ad_rewards WHERE user_id = (SELECT id FROM users WHERE email = '$($p.email)') AND kind = 'EXTRA_CHECKIN' AND consumed_at IS NULL;")
Check 'the refused ad ticket survives' ($unspent -ge 1) "got $unspent unspent"

Write-Host "`n=== 41. The doorbell: a neighbour's plot, reached from the map ===" -ForegroundColor Cyan
$owner  = New-Player -Wp (Parcel-Price 1)
$caller = New-Player
$spot = New-Spot
$claim = Invoke-Api POST '/parcels/claim' $spot -Token $owner.token
Check 'the neighbour owns a plot' ($claim.status -eq 201) "got $($claim.status)"

# What the MAP sees - this is where the doorbell gets its parcel id from.
$near = (Invoke-Api GET "/parcels/nearby?lat=$($spot.lat)&lng=$($spot.lng)&radius=100" -Token $caller.token).body
$theirs = $near.parcels | Where-Object { -not $_.mine } | Select-Object -First 1
Check 'nearby carries the plot id, so a tap can ring it' ($theirs.id -match '^[0-9a-f-]{36}$') "got '$($theirs.id)'"
Check 'nearby still names nobody' (-not ($near.parcels[0].PSObject.Properties.Name -contains 'ownerId')) 'an owner id leaked into nearby'
Check 'and it is marked as not yours' ($theirs.mine -eq $false) "got $($theirs.mine)"

$ring = Invoke-Api POST '/pitstops' @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 8; parcelId = $theirs.id } -Token $caller.token
Check 'ringing the doorbell pays (201)' ($ring.status -eq 201) "got $($ring.status): $($ring.body.error)"
Check "a neighbour's door pays more than your own" ($ring.body.claim.amount -gt 2) "got $($ring.body.claim.amount)"
Check 'the first call carries the explorer bonus' ($ring.body.firstEver -eq $true) "got $($ring.body.firstEver)"
Check 'and it knows the plot is not yours' ($ring.body.mine -eq $false) "got $($ring.body.mine)"
Check 'the shared clock starts' ($ring.body.cooldownSeconds -gt 0) "got $($ring.body.cooldownSeconds)"

$again = Invoke-Api POST '/pitstops' @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 8; parcelId = $theirs.id } -Token $caller.token
Check 'the same door twice is refused' ($again.status -eq 429 -or $again.status -eq 409) "got $($again.status)"

# Ringing a door you are nowhere near.
$far = Invoke-Api POST '/pitstops' @{ lat = $spot.lat + 0.5; lng = $spot.lng; accuracyM = 8; parcelId = $theirs.id } -Token $caller.token
Check 'a door 50 km away is not in reach' ($far.status -ne 201) "got $($far.status)"

Write-Host "`n=== 42. Step integrity flags record, and never refuse ===" -ForegroundColor Cyan
$spoof = New-Player
for ($i = 0; $i -lt 4; $i++) {
    Invoke-Api POST '/steps/sync' @{ steps = 1000; platform = 'ANDROID'; deviceId = "$runId-shaker"; source = 'HEALTH_STORE'; mockedLocation = $true } -Token $spoof.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() } | Out-Null
}
$spoofId = Sql "SELECT id FROM users WHERE email = '$($spoof.email)';"
$flagged = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$spoofId' AND integrity_flags <> 0;")
Check 'the identical-batch spoofer is flagged' ($flagged -ge 3) "got $flagged of 4 rows flagged"
$identical = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$spoofId' AND (integrity_flags & 1) <> 0;")
Check 'IDENTICAL_BATCHES specifically fired' ($identical -ge 1) "got $identical"
$mocked = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$spoofId' AND mocked_location;")
Check 'the mocked location is on the record' ($mocked -eq 4) "got $mocked"
$count = [int](Sql "SELECT step_flag_count FROM users WHERE id = '$spoofId';")
Check 'the account carries a running flag count' ($count -ge 3) "got $count"
# ...and it was PAID anyway. The flags are evidence, not a punishment.
$paid = [int](Sql "SELECT COALESCE(SUM(wp_earned),0) FROM step_logs WHERE user_id = '$spoofId';")
Check 'flagged steps are still paid (evidence, not enforcement)' ($paid -eq 40) "got $paid"

$honest = New-Player
foreach ($n in 420, 180, 900, 240, 610) {
    Invoke-Api POST '/steps/sync' @{ steps = $n; platform = 'ANDROID'; deviceId = "$runId-real"; source = 'DEVICE_SENSOR' } -Token $honest.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() } | Out-Null
}
$honestId = Sql "SELECT id FROM users WHERE email = '$($honest.email)';"
$honestFlags = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$honestId' AND integrity_flags <> 0;")
Check 'an honest walker trips nothing at all' ($honestFlags -eq 0) "got $honestFlags flagged rows"

Write-Host "`n=== 43. Anti-spoofing: shaking, teleports, and honest players ===" -ForegroundColor Cyan

# --- THE ATTACK: steps with no ground covered ---------------------------
$shaker = New-Player
for ($i = 0; $i -lt 8; $i++) {
    Invoke-Api POST '/steps/sync' @{ steps = 2000; platform = 'ANDROID'; deviceId = "$runId-shake"; source = 'DEVICE_SENSOR'; distanceM = 3 } -Token $shaker.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() } | Out-Null
}
$shakerId = Sql "SELECT id FROM users WHERE email = '$($shaker.email)';"
$shakerWp = [int](Sql "SELECT COALESCE(SUM(wp_earned),0) FROM step_logs WHERE user_id = '$shakerId';")
# 16,000 shaken steps would be 160 WP unprotected. The cap should hold it
# near the 6,000-step allowance, so ~60-70.
Check "16,000 shaken steps earn far less than 160 WP (got $shakerWp)" ($shakerWp -le 80) "got $shakerWp"
$flagged = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$shakerId' AND (integrity_flags & 64) <> 0;")
Check 'NO_DISPLACEMENT fired' ($flagged -ge 5) "got $flagged flagged rows"
$tier = Sql "SELECT integrity_tier FROM users WHERE id = '$shakerId';"
Check "a persistent shaker is throttled (got $tier)" ($tier -match 'THROTTLED|REVIEW') "got $tier"

# --- AN HONEST WALKER: varied batches, real distances -------------------
$walker = New-Player
foreach ($pair in @(@(420,330), @(1180,910), @(260,195), @(2050,1610), @(760,540), @(1490,1180))) {
    Invoke-Api POST '/steps/sync' @{ steps = $pair[0]; platform = 'ANDROID'; deviceId = "$runId-walk"; source = 'DEVICE_SENSOR'; distanceM = $pair[1] } -Token $walker.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() } | Out-Null
}
$walkerId = Sql "SELECT id FROM users WHERE email = '$($walker.email)';"
$walkerWp = [int](Sql "SELECT COALESCE(SUM(wp_earned),0) FROM step_logs WHERE user_id = '$walkerId';")
Check 'an honest walker is paid in full (61 WP from 6,160 steps)' ($walkerWp -eq 61) "got $walkerWp"
$walkerTier = Sql "SELECT integrity_tier FROM users WHERE id = '$walkerId';"
Check 'and stays CLEAR' ($walkerTier -match 'CLEAR') "got $walkerTier"
$walkerFlags = [int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$walkerId' AND integrity_flags <> 0;")
Check 'with no flags at all' ($walkerFlags -eq 0) "got $walkerFlags"

# --- A TREADMILL: real steps, no displacement, must be paid -------------
$tread = New-Player
Invoke-Api POST '/steps/sync' @{ steps = 6000; platform = 'ANDROID'; deviceId = "$runId-tread"; source = 'DEVICE_SENSOR'; distanceM = 0 } -Token $tread.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() } | Out-Null
$treadId = Sql "SELECT id FROM users WHERE email = '$($tread.email)';"
$treadWp = [int](Sql "SELECT COALESCE(SUM(wp_earned),0) FROM step_logs WHERE user_id = '$treadId';")
Check 'an hour of treadmill is paid in full (60 WP)' ($treadWp -eq 60) "got $treadWp"
Check 'and a single flagged sync does not throttle anybody' ((Sql "SELECT integrity_tier FROM users WHERE id = '$treadId';") -match 'CLEAR') 'treadmill user was throttled'

# --- AN OFFLINE DAY: no trace at all, must be paid in full --------------
$offline = New-Player -AgeHours 10
$r = Invoke-Api POST '/steps/sync' @{ steps = 12000; platform = 'ANDROID'; deviceId = "$runId-off"; source = 'HEALTH_STORE' } -Token $offline.token -ExtraHeaders @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
Check 'a 12,000-step offline catch-up earns the full 120 WP' ($r.body.wpEarned -eq 120) "got $($r.body.wpEarned)"
$offlineId = Sql "SELECT id FROM users WHERE email = '$($offline.email)';"
Check 'and raises no flag - no trace is not evidence' ([int](Sql "SELECT COUNT(*) FROM step_logs WHERE user_id = '$offlineId' AND integrity_flags & 64 <> 0;") -eq 0) 'untraced steps were flagged'

# --- A TELEPORT: the check root cannot defeat ---------------------------
$tp = New-Player -Wp ((Parcel-Price 1) * 3)
$london = @{ lat = 51.5074 + (Get-Random -Minimum -400 -Maximum 400) / 100000.0; lng = -0.1278 + (Get-Random -Minimum -400 -Maximum 400) / 100000.0; accuracyM = 8 }
Invoke-Api POST '/parcels/claim' $london -Token $tp.token | Out-Null
$manchester = @{ lat = 53.4808 + (Get-Random -Minimum -400 -Maximum 400) / 100000.0; lng = -2.2426 + (Get-Random -Minimum -400 -Maximum 400) / 100000.0; accuracyM = 8 }
Invoke-Api POST '/parcels/claim' $manchester -Token $tp.token | Out-Null
$tpId = Sql "SELECT id FROM users WHERE email = '$($tp.email)';"
$teleports = [int](Sql "SELECT COUNT(*) FROM integrity_events WHERE user_id = '$tpId' AND (flags & 128) <> 0;")
Check 'London to Manchester in seconds is recorded as a teleport' ($teleports -ge 1) "got $teleports"
# ...but NOT refused. Losing GPS in a tunnel and re-acquiring it on a train
# looks identical, and that player is not cheating.
$parcels = [int](Sql "SELECT COUNT(*) FROM parcels WHERE owner_id = '$tpId';")
Check 'the claim still went through - evidence, not a refusal' ($parcels -ge 1) "got $parcels parcels"

# --- WALKING NORMALLY IS NOT A TELEPORT --------------------------------
$ok = New-Player -Wp ((Parcel-Price 1) * 3)
$spotA = New-Spot
Invoke-Api POST '/parcels/claim' $spotA -Token $ok.token | Out-Null
# ~30 m away: the next square along.
$spotB = @{ lat = $spotA.lat + 0.00027; lng = $spotA.lng; accuracyM = 8 }
Invoke-Api POST '/parcels/claim' $spotB -Token $ok.token | Out-Null
$okId = Sql "SELECT id FROM users WHERE email = '$($ok.email)';"
Check 'two claims a few metres apart raise nothing' ([int](Sql "SELECT COUNT(*) FROM integrity_events WHERE user_id = '$okId';") -eq 0) 'walking was flagged'

# --- THE MOCK FLAG IS A HINT, NEVER A VERDICT --------------------------
$mock = New-Player -Wp ((Parcel-Price 1) * 2)
$spot = New-Spot
$r = Invoke-Api POST '/parcels/claim' @{ lat = $spot.lat; lng = $spot.lng; accuracyM = 8; mocked = $true } -Token $mock.token
Check 'a mocked position still claims - root can hide the flag anyway' ($r.status -eq 201) "got $($r.status): $($r.body.error)"
$mockId = Sql "SELECT id FROM users WHERE email = '$($mock.email)';"
Check '...but it is on the record' ([int](Sql "SELECT COUNT(*) FROM integrity_events WHERE user_id = '$mockId' AND (flags & 4) <> 0;") -ge 1) 'mock flag not recorded'
Check 'and one mocked fix alone does not throttle' ((Sql "SELECT integrity_tier FROM users WHERE id = '$mockId';") -match 'CLEAR') 'one signal moved the tier'

Write-Host "`n=== 44. Bugs found by playing the game (regressions) ===" -ForegroundColor Cyan

# --- THE THROTTLE HAS TO REACH EVERY FAUCET -----------------------------
# It originally covered steps, pit stops and check-ins only. A throttled
# account still farmed the daily chest, quests, treasure, the ad-streak
# chest and bonus-WP ads at the FULL rate - which is most of the ways Walk
# Points enter the game. It looked like it worked because the three paths
# that were tested were the three that were wired.
$th = New-Player
$thId = Sql "SELECT id FROM users WHERE email = '$($th.email)';"
Sql "UPDATE users SET integrity_tier='THROTTLED', integrity_score=40 WHERE id='$thId';" | Out-Null

$chest = Invoke-Api POST '/daily/claim' -Token $th.token
Check 'a throttled account gets a reduced daily chest' ($chest.body.claim.amount -lt 3) "got $($chest.body.claim.amount) WP"

$t = Invoke-Api POST '/rewards/start' @{ kind = 'WALK_POINTS' } -Token $th.token
$g = Invoke-Api POST '/rewards/complete' @{ nonce = $t.body.nonce } -Token $th.token
Check 'a throttled account gets reduced bonus-WP ads' ($g.body.amount -lt 5) "got $($g.body.amount) WP"

# ...and never nothing, so a false positive still progresses and a farmer
# cannot tell exactly which behaviour stopped working.
Check 'but the chest is never zero' ($chest.body.claim.amount -ge 1) "got $($chest.body.claim.amount)"
Check 'and the ad is never zero' ($g.body.amount -ge 1) "got $($g.body.amount)"

# A CLEAR account is untouched.
$fine = New-Player
$fineChest = Invoke-Api POST '/daily/claim' -Token $fine.token
Check 'an ordinary account still gets the full chest' ($fineChest.body.claim.amount -eq 3) "got $($fineChest.body.claim.amount)"

# --- A PLAYER WHO TRAVELS MUST NOT BE STRANDED --------------------------
# The area target was rolled near wherever the player was and never moved.
# Open the app in another city and today's area was hundreds of kilometres
# away, every check-in refused with "keep walking", and the only escape was
# a rewarded ad. There was no way to give up on it.
$tr = New-Player
$atHome = (Invoke-Api GET '/checkin/areas?lat=51.5074&lng=-0.1278' -Token $tr.token).body
Check 'a target is rolled at home' ($null -ne $atHome.target) 'no target'
$moved = (Invoke-Api GET '/checkin/areas?lat=53.4808&lng=-2.2426' -Token $tr.token).body
Check 'after travelling the target is reachable again' ($moved.target.distanceM -lt 5000) "still $([Math]::Round($moved.target.distanceM/1000)) km away"
Check '...and it is a DIFFERENT square' ($moved.target.key -ne $atHome.target.key) 'the same square came back'
Check '...for free - travelling is not cheating' ($moved.nextNeedsAd -eq $false) 'an ad was demanded'
$why = Sql "SELECT abandoned_reason FROM area_targets WHERE user_id = (SELECT id FROM users WHERE email = '$($tr.email)') AND abandoned_at IS NOT NULL LIMIT 1;"
Check 'the abandonment is recorded as TOO_FAR' ($why -match 'TOO_FAR') "got '$why'"

# --- YESTERDAY'S UNCLAIMED TARGET MUST NOT BLOCK TODAY'S ----------------
# Miss a day and the stale target stayed open, so the free daily roll never
# fired again. Missing a day WHILE travelling compounded the two into an
# account that could never check in again without paying.
$st = New-Player
$stSpot = New-Spot
$day1 = (Invoke-Api GET "/checkin/areas?lat=$($stSpot.lat)&lng=$($stSpot.lng)" -Token $st.token).body
$stId = Sql "SELECT id FROM users WHERE email = '$($st.email)';"
Sql "UPDATE area_targets SET local_day = local_day - 1, assigned_at = NOW() - INTERVAL '30 hours' WHERE user_id = '$stId';" | Out-Null
$day2 = (Invoke-Api GET "/checkin/areas?lat=$($stSpot.lat)&lng=$($stSpot.lng)" -Token $st.token).body
Check "yesterday's unclaimed target does not become today's" ($day2.target.key -ne $day1.target.key) 'the stale target came back'
Check 'and the new day still gets its FREE roll' ($day2.nextNeedsAd -eq $false) 'an ad was demanded on a fresh day'
$staleWhy = Sql "SELECT abandoned_reason FROM area_targets WHERE user_id = '$stId' AND abandoned_at IS NOT NULL LIMIT 1;"
Check 'recorded as STALE_DAY' ($staleWhy -match 'STALE_DAY') "got '$staleWhy'"

# --- ORDINARY WALKING MUST NOT RE-ROLL THE TARGET -----------------------
# The drift threshold has to sit far beyond anything the roll can produce,
# or a player could walk a few hundred metres to fish for a closer target.
$wk = New-Player
$wkSpot = New-Spot
$w1 = (Invoke-Api GET "/checkin/areas?lat=$($wkSpot.lat)&lng=$($wkSpot.lng)" -Token $wk.token).body
# ~900 m away: further than the roll radius, nowhere near the drift limit.
$w2 = (Invoke-Api GET "/checkin/areas?lat=$($wkSpot.lat + 0.008)&lng=$($wkSpot.lng)" -Token $wk.token).body
Check 'walking 900 m does NOT re-roll the target' ($w2.target.key -eq $w1.target.key) "$($w1.target.key) -> $($w2.target.key)"

# --- A PUSH TOKEN WE CANNOT STORE MUST NOT REPORT SUCCESS ---------------
# registerPushToken silently dropped anything that was not an Expo token
# while the route always replied ok:true. The app believed it had
# registered, notifications never arrived, and nothing said why - the exact
# failure push-check.ts exists to diagnose, produced by our own endpoint.
$pu = New-Player
$good = Invoke-Api POST '/user/push' @{ token = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'; platform = 'android' } -Token $pu.token
Check 'a real Expo token registers' ($good.body.ok -eq $true) "got $($good.body.ok)"
$junk = Invoke-Api POST '/user/push' @{ token = 'not-an-expo-token'; platform = 'android' } -Token $pu.token
Check 'a token we cannot store reports ok:false' ($junk.body.ok -eq $false) "got $($junk.body.ok)"
$stored = [int](Sql "SELECT COUNT(*) FROM push_tokens WHERE user_id = (SELECT id FROM users WHERE email = '$($pu.email)');")
Check '...and exactly one token is stored, not two' ($stored -eq 1) "got $stored"

Write-Host "`n=== RESULTS ===" -ForegroundColor Cyan
Write-Host "  Passed: $pass" -ForegroundColor Green
if ($fail -gt 0) { Write-Host "  Failed: $fail" -ForegroundColor Red } else { Write-Host "  Failed: 0" -ForegroundColor Green }
if ($fail -gt 0) { exit 1 }
