$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repositoryRoot 'app'
$logRoot = Join-Path $repositoryRoot 'data\app'

if (-not (Test-Path -LiteralPath $appRoot -PathType Container)) {
    throw "アプリのディレクトリが見つかりません: $appRoot"
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$stdoutLog = Join-Path $logRoot 'server-startup.log'
$stderrLog = Join-Path $logRoot 'server-startup.error.log'

Start-Process `
    -FilePath $npm `
    -ArgumentList 'start' `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog
