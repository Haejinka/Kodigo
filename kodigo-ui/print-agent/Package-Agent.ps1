$ErrorActionPreference = 'Stop'
$publishPath = Join-Path $PSScriptRoot '..\print-agent-dist'
$archivePath = Join-Path $PSScriptRoot 'Kodigo-Print-Agent-win-x64.zip'

if (-not (Test-Path -LiteralPath (Join-Path $publishPath 'Kodigo.PrintAgent.exe'))) {
  throw 'The published agent is missing. Run dotnet publish for win-x64 first.'
}

$archiveInputs = @(
  (Join-Path $publishPath 'Kodigo.PrintAgent.exe'),
  (Join-Path $PSScriptRoot 'Install-Agent.ps1'),
  (Join-Path $PSScriptRoot 'Uninstall-Agent.ps1'),
  (Join-Path $PSScriptRoot 'Start-Agent.vbs'),
  (Join-Path $PSScriptRoot 'README.md')
)

Compress-Archive -Path $archiveInputs -DestinationPath $archivePath -CompressionLevel Optimal -Force
Write-Output "Created $archivePath"
