$ErrorActionPreference = 'Stop'
$agentPath = Join-Path $PSScriptRoot 'Kodigo.PrintAgent.exe'
$launcherPath = Join-Path $PSScriptRoot 'Start-Agent.vbs'
$pairingTokenCreated = $false

if (-not (Test-Path -LiteralPath $agentPath)) {
  throw 'Kodigo.PrintAgent.exe is missing. Extract the complete Windows x64 package first.'
}

$pairHashPath = Join-Path $env:LOCALAPPDATA 'Kodigo\PrintAgent\pairing-token.sha256'
if (Test-Path -LiteralPath $pairHashPath) {
  Write-Output 'This Windows account already has a pairing token. Existing Kodigo browser pairing will keep working.'
  Write-Output 'To pair a new browser or replace a lost token, run Kodigo.PrintAgent.exe --rotate-pairing-token.'
} else {
  $pairingOutput = & $agentPath --pair 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Output $pairingOutput
    throw 'Pairing token setup failed.'
  }
  Write-Output $pairingOutput
  $pairingTokenCreated = $true
}

$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'Kodigo Print Agent.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$shortcut.Arguments = ('"{0}"' -f $launcherPath)
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Save()

Start-Process -FilePath $launcherPath
Write-Output 'The agent will start when this Windows user signs in.'
if ($pairingTokenCreated) {
  Write-Output 'Enter the token printed above in Kodigo → Settings → POS hardware.'
} else {
  Write-Output 'Existing browser pairings are preserved. Use --rotate-pairing-token only when you need a new token.'
}
