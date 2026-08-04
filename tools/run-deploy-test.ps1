$ErrorActionPreference = "Continue"
$log = "$env:TEMP\cdp-deploy.txt"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$proc = Start-Process $edge -ArgumentList "--headless=new","--disable-gpu","--remote-debugging-port=9222","--user-data-dir=$env:TEMP\edge-cdp-deploy","https://Ellves-mty.github.io/kaoyan-helper/" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 6
$nodeOut = & node "C:\Users\Lenovo\kaoyan-helper\tools\test-deploy.js" 2>&1 | Out-String
$nodeOut | Out-File $log
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Content $log
