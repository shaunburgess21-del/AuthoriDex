# phantom-capture.ps1 — run BEFORE git restore
$ts   = Get-Date -Format 'yyyyMMdd-HHmmss'
$log  = Join-Path (Get-Location) "phantom-capture-$ts.log"
$files = @(
  'client/src/components/PredictTab.tsx',
  'client/src/components/UnderratedOverratedCard.tsx',
  'client/src/components/vote/InductionLeaderboardSlice.tsx',
  'client/src/pages/PredictPage.tsx'
)

function Log($s) { Add-Content -LiteralPath $log -Value $s }

Log "=== phantom capture $ts ==="
Log "git version: $(git --version)"
Log "branch:      $(git rev-parse --abbrev-ref HEAD)"
Log "head sha:    $(git rev-parse HEAD)"
Log ""
Log "=== git status -s ==="
Log (git status -s | Out-String)
Log "=== git diff --stat ==="
Log (git diff --stat -- $files | Out-String)
Log "=== git diff --raw ==="
Log (git diff --raw -- $files | Out-String)
Log "=== git ls-files --eol ==="
Log (git ls-files --eol -- $files | Out-String)
Log "=== git diff (full content) ==="
Log (git diff -- $files | Out-String)

foreach ($f in $files) {
  Log ""
  Log "--- $f ---"
  if (-not (Test-Path -LiteralPath $f)) { Log "MISSING"; continue }
  $info = Get-Item -LiteralPath $f -Force
  Log "Length        : $($info.Length)"
  Log "LastWriteTime : $($info.LastWriteTime.ToString('o'))"
  Log "CreationTime  : $($info.CreationTime.ToString('o'))"
  Log "Attributes    : $($info.Attributes)"
  $bytes = [IO.File]::ReadAllBytes($f)
  $cr = ($bytes | Where-Object { $_ -eq 0x0D }).Count
  $lf = ($bytes | Where-Object { $_ -eq 0x0A }).Count
  Log ("CR={0} LF={1} bytes={2}" -f $cr,$lf,$bytes.Length)
  Log "=== fsutil reparsepoint ==="
  Log (& fsutil reparsepoint query $f 2>&1 | Out-String)
  Log "=== parent dir mtime ==="
  $p = Split-Path -Parent $f
  Log ("{0}  LastWriteTime={1}" -f $p, (Get-Item -LiteralPath $p).LastWriteTime.ToString('o'))
}

Log ""
Log "=== git update-index --really-refresh (post-capture; modifies .git/index stat cache only) ==="
Log (git update-index --really-refresh 2>&1 | Out-String)
Log "=== git status -s after refresh ==="
Log (git status -s | Out-String)

Write-Host "Wrote $log"
