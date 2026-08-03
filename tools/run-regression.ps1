$ErrorActionPreference = "Continue"
$log = "$env:TEMP\cdp-regression-log.txt"
$proc1 = Start-Process node -ArgumentList "server-test.js" -WorkingDirectory "C:\Users\Lenovo\kaoyan-helper\tools" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$proc2 = Start-Process $edge -ArgumentList "--headless=new","--disable-gpu","--remote-debugging-port=9222","--user-data-dir=$env:TEMP\edge-cdp-r","http://localhost:8123/index.html" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
$nodeOut = & node "C:\Users\Lenovo\kaoyan-helper\tools\test-regression.js" 2>&1 | Out-String
$nodeOut | Out-File $log
Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $proc1.Id -Force -ErrorAction SilentlyContinue
