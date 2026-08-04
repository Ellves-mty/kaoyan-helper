$ErrorActionPreference = "Continue"
$testFile = $args[0]
if (-not $testFile) { $testFile = "test-vl.js" }
$testName = [IO.Path]::GetFileNameWithoutExtension($testFile)
$log = "$env:TEMP\cdp-$testName.txt"
$profile = "$env:TEMP\edge-cdp-$testName"

# cleanup: kill listeners on 8123/9222 and stale node processes
foreach ($port in @(8123, 9222)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# clean browser profile so IndexedDB/localStorage start fresh
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue }

Start-Sleep -Milliseconds 800
$proc1 = Start-Process node -ArgumentList "server-test.js" -WorkingDirectory "C:\Users\Lenovo\kaoyan-helper\tools" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$proc2 = Start-Process $edge -ArgumentList "--headless=new","--disable-gpu","--remote-debugging-port=9222","--user-data-dir=$profile","http://localhost:8123/index.html" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
$nodeOut = & node "C:\Users\Lenovo\kaoyan-helper\tools\$testFile" 2>&1 | Out-String
$nodeOut | Out-File $log
Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $proc1.Id -Force -ErrorAction SilentlyContinue
Get-Content $log
