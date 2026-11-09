# run_update.ps1 - started by the desktop shortcuts "Update prices (full)" / "Update prices (quick)".
# Shows progress in this window, keeps the PC awake while it runs, and ends with a result box.
#   -Mode full|quick   which update to run
#   -NoWait            no result box / no "press Enter" (for unattended test runs)
param(
  [ValidateSet("full", "quick")][string]$Mode = "quick",
  [switch]$NoWait
)

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { $Host.UI.RawUI.WindowTitle = "Update prices ($Mode)" } catch {}

# Keep the PC from sleeping during the run (released when the run ends or the window closes).
$awake = $false
try {
  Add-Type -Namespace PriceCheck -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
  [void][PriceCheck.Power]::SetThreadExecutionState([uint32]2147483649)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  $awake = $true
} catch {}

Write-Host ""
Write-Host "  Update prices ($Mode)" -ForegroundColor Cyan
if ($Mode -eq "full") { Write-Host "  Takes about 90 minutes. If it stops, start it again: it continues where it stopped." }
else { Write-Host "  Takes about 5 minutes." }
Write-Host "  Keep this window open. The PC will not go to sleep while it runs."
Write-Host ""

$code = 1
$result = ""
try {
  & node scraper\update.js $Mode
  $code = $LASTEXITCODE
} catch {
  $result = "ERROR: could not start node ($($_.Exception.Message)). Is Node.js installed?"
}
if ($awake) { try { [void][PriceCheck.Power]::SetThreadExecutionState([uint32]2147483648) } catch {} }

$resultFile = Join-Path $repo "work\last_result.txt"
if (-not $result -and (Test-Path $resultFile)) { $result = (Get-Content $resultFile -Raw -Encoding UTF8).Trim() }
if (-not $result) { $result = "ERROR: the update stopped without a result (exit code $code). See work\update.log" }

Write-Host ""
if ($code -eq 0) { Write-Host "  $result" -ForegroundColor Green } else { Write-Host "  $result" -ForegroundColor Red }

if (-not $NoWait) {
  try {
    Add-Type -AssemblyName PresentationFramework
    $icon = if ($code -eq 0) { "Information" } else { "Error" }
    [void][System.Windows.MessageBox]::Show($result, "Update prices ($Mode)", "OK", $icon)
  } catch {}
  Write-Host ""
  Read-Host "  Press Enter to close"
}
exit $code
