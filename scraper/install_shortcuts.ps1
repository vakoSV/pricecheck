# install_shortcuts.ps1 - creates the two desktop shortcuts. Run it again if the repo folder moves:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scraper\install_shortcuts.ps1
$repo = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$script = Join-Path $repo "scraper\run_update.ps1"
$shell = New-Object -ComObject WScript.Shell

$items = @(
  @{ Name = "Update prices (full)";  Mode = "full";  Desc = "Full dazoge price update (~90 min): all product pages, then publish the site" },
  @{ Name = "Update prices (quick)"; Mode = "quick"; Desc = "Quick dazoge price update (~5 min): listing pages only, then publish the site" }
)
foreach ($i in $items) {
  $path = Join-Path $desktop ($i.Name + ".lnk")
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $ps
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Mode $($i.Mode)"
  $lnk.WorkingDirectory = $repo
  $lnk.Description = $i.Desc
  $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,238"
  $lnk.Save()
  Write-Host "created $path"
}
