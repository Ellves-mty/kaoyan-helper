$ErrorActionPreference = "Continue"
$log = "$env:TEMP\cdp-deploy.txt"
$profile = "$env:TEMP\edge-cdp-deploy"

# cleanup: kill listeners on 9222 and stale node/edge processes
foreach ($port in @(9222)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$proc = Start-Process $edge -ArgumentList "--headless=new","--disable-gpu","--remote-debugging-port=9222","--user-data-dir=$profile","https://Ellves-mty.github.io/kaoyan-helper/" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 6
$nodeOut = & node "C:\Users\Lenovo\kaoyan-helper\tools\test-deploy.js" 2>&1 | Out-String
$nodeOut | Out-File $log
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Content $log
