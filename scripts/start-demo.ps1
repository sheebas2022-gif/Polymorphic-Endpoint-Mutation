param(
    [ValidateRange(1,86400)][int]$WindowSeconds = 30,
    [ValidateRange(1,65535)][int]$ListenPort = 8080
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$localGo = Join-Path $projectRoot '.tools\go\bin\go.exe'
$goCommand = if (Test-Path -LiteralPath $localGo) { $localGo } else { (Get-Command go -ErrorAction Stop).Source }
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$env:GOCACHE = Join-Path $projectRoot '.tools\go-cache'
New-Item -ItemType Directory -Path '.run' -Force | Out-Null
# Fail before starting either process if a development server already owns a port.
foreach ($port in @($ListenPort, 9000)) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $port)
        throw "Port $port is already in use. The demo may already be running."
    } catch [System.Net.Sockets.SocketException] {
        # Connection refused: this local port is available.
    } finally { $client.Dispose() }
}
& $goCommand build -o '.run\gateway-ui.exe' ./gateway
if ($LASTEXITCODE -ne 0) { throw 'Gateway build failed' }
$env:MUTATION_SEED = '0123456789abcdef0123456789abcdef'
$env:DEMO_UI = '1'
$env:WINDOW_SECONDS = [string]$WindowSeconds
$env:LISTEN_ADDR = "127.0.0.1:$ListenPort"
$env:BACKEND_URL = 'http://127.0.0.1:9000'
$backend = Start-Process -FilePath $nodeCommand -ArgumentList 'api-server/server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput '.run\backend.stdout.log' -RedirectStandardError '.run\backend.stderr.log' -PassThru
$gateway = Start-Process -FilePath (Join-Path $projectRoot '.run\gateway-ui.exe') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput '.run\gateway-ui.stdout.log' -RedirectStandardError '.run\gateway-ui.stderr.log' -PassThru
Write-Host "Dashboard: http://127.0.0.1:$ListenPort"
Write-Host "Client website: http://127.0.0.1:$ListenPort/client/"
Write-Host "Routes rotate every $WindowSeconds seconds. Bookings persist in data\bookings.json."
Write-Host "Backend PID: $($backend.Id) | Gateway PID: $($gateway.Id)"
Write-Host 'To stop these processes, run Stop-Process -Id with the two PIDs above.'

Write-Host 'Logs are in .run. The seed above is public demo data only.'
