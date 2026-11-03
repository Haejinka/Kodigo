$ErrorActionPreference = 'Stop'
$publishPath = Join-Path $PSScriptRoot '..\print-agent-dist'
$setupPath = Join-Path $PSScriptRoot 'Kodigo-Print-Setup-win-x64.exe'

if (-not (Test-Path -LiteralPath (Join-Path $publishPath 'Kodigo.PrintAgent.exe'))) {
  throw 'The published agent is missing. Run dotnet publish for win-x64 first.'
}

Copy-Item -LiteralPath (Join-Path $publishPath 'Kodigo.PrintAgent.exe') -Destination $setupPath -Force
Write-Output "Created $setupPath"
